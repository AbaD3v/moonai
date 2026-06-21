import asyncio
import gc
import json
import os
import sys
from typing import AsyncIterator, Optional

import torch
import torch.nn.functional as F
from transformers import PreTrainedTokenizerFast
from tokenizers import Tokenizer as BaseTokenizer
import transformers
import tokenizers
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from huggingface_hub import hf_hub_download

load_dotenv()

sys.path.append(os.path.dirname(__file__))

from config import MoonAIConfig
from model import MoonAIForCausalLM

print("Transformers version:", transformers.__version__)
print("Tokenizers version:", tokenizers.__version__)
print("Torch version:", torch.__version__)

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"\n🚀 Запуск MoonAI Backend на {device.upper()}...")

MODE = os.getenv("MOON_MODE", "local")

# =====================================================================
# 1. ТОКЕНИЗАТОР (общий для обеих моделей)
# =====================================================================

TOKENIZER_PATH = None
tokenizer = None

try:
    print("⏳ Загружаем токенизатор из AbaD3v/MoonAI700M-V1.2...")
    TOKENIZER_PATH = hf_hub_download(
        repo_id="AbaD3v/MoonAI700M-V1.2",
        filename="tokenizer_moonai700m_chat.json",
    )
    print(f"✓ Токенизатор загружен: {TOKENIZER_PATH}")
except Exception as e:
    print(f"⚠️ Hub недоступен, пробуем локально: {e}")
    TOKENIZER_PATH = os.path.join(os.path.dirname(__file__), "tokenizer_moonai700m_chat.json")

try:
    raw_tokenizer = BaseTokenizer.from_file(TOKENIZER_PATH)
    tokenizer = PreTrainedTokenizerFast(tokenizer_object=raw_tokenizer)
    tokenizer.eos_token = "<|endoftext|>"
    tokenizer.bos_token = "<|begin_of_text|>"
    tokenizer.pad_token = "<|pad|>"
    tokenizer.unk_token = "<|unk|>"
    print("✓ Токенизатор инициализирован.")
    print(f"  vocab={len(tokenizer)}, eos={tokenizer.eos_token_id}, pad={tokenizer.pad_token_id}")
except Exception as e:
    print(f"❌ Ошибка токенизатора: {e}")

# =====================================================================
# 2. КОНФИГ (общий для обеих моделей 700M)
# =====================================================================

config = MoonAIConfig(
    vocab_size=32771,
    block_size=1024,
    n_layer=24,
    n_head=16,
    n_kv_head=16,
    n_embd=1536,
    intermediate_size=4096,
    dropout=0.0,
)

# =====================================================================
# 3. ЗАГРУЗЧИК МОДЕЛЕЙ
# =====================================================================

def download_checkpoint(repo_id: str, label: str) -> Optional[str]:
    try:
        print(f"⏳ [{label}] Скачиваем из {repo_id}...")
        path = hf_hub_download(repo_id=repo_id, filename="moonai_700m_latest.pt")
        print(f"✓ [{label}] {path}")
        return path
    except Exception as e:
        print(f"⚠️ [{label}] Ошибка Hub: {e}")
        fallback = os.path.join(os.path.dirname(__file__), "moonai_700m_latest.pt")
        print(f"🔄 [{label}] Пробуем локально: {fallback}")
        return fallback if os.path.exists(fallback) else None


def load_checkpoint_compatible(path: str):
    try:
        ckpt = torch.load(path, map_location="cpu", weights_only=True)
        print("✓ Checkpoint загружен (weights_only=True).")
        return ckpt
    except TypeError:
        print("⚠️ weights_only не поддерживается, грузим обычно...")
        ckpt = torch.load(path, map_location="cpu")
        print("✓ Checkpoint загружен.")
        return ckpt
    except Exception as e:
        print(f"⚠️ weights_only=True упал: {e}, грузим обычно...")
        ckpt = torch.load(path, map_location="cpu")
        print("✓ Checkpoint загружен.")
        return ckpt


def load_model(repo_id: str, label: str):
    """Скачивает и загружает модель. Возвращает (model, error_message)."""
    path = download_checkpoint(repo_id, label)

    if not path:
        err = f"[{label}] Файл весов не найден."
        print(f"❌ {err}")
        return None, err

    try:
        m = MoonAIForCausalLM(config)

        checkpoint = load_checkpoint_compatible(path)

        if isinstance(checkpoint, dict) and "model" in checkpoint:
            state_dict = checkpoint["model"]
        elif isinstance(checkpoint, dict) and "state_dict" in checkpoint:
            state_dict = checkpoint["state_dict"]
        else:
            state_dict = checkpoint

        cleaned_sd = {
            k.replace("_orig_module.", "").replace("module.", ""): v
            for k, v in state_dict.items()
        }

        missing, unexpected = m.load_state_dict(cleaned_sd, strict=False)
        if missing:
            print(f"⚠️ [{label}] Missing keys: {len(missing)} → {missing[:5]}")
        if unexpected:
            print(f"⚠️ [{label}] Unexpected keys: {len(unexpected)} → {unexpected[:5]}")

        del checkpoint, state_dict, cleaned_sd
        gc.collect()

        if device == "cuda":
            m = m.bfloat16()

        m.to(device)
        m.eval()

        print(f"✅ [{label}] Модель готова.")
        return m, None

    except Exception as e:
        err = f"[{label}] Ошибка загрузки: {str(e)}"
        print(f"❌ {err}")
        return None, err


# Загружаем обе модели
print("\n── Загрузка моделей ──────────────────────────────────────────")
model_v12, error_v12 = load_model("AbaD3v/MoonAI700M-V1.2", "V1.2 latest")
model_v11, error_v11 = load_model("AbaD3v/MoonAI700M-V1.1", "V1.1 stable")
print("─────────────────────────────────────────────────────────────")
print(f"  {'✅' if model_v12 else '❌'} MoonAI V1.2 (latest) — /chat")
print(f"  {'✅' if model_v11 else '❌'} MoonAI V1.1 (stable) — /chat_v1")
print()

# =====================================================================
# 4. FASTAPI
# =====================================================================

app = FastAPI(title="MoonAI Backend", version="0.6.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_SYSTEM_PROMPT = "Ты MoonAI — умный ассистент. Отвечай в Markdown-разметке."


class ChatRequest(BaseModel):
    text: str
    system_prompt: Optional[str] = DEFAULT_SYSTEM_PROMPT
    temperature: float = 0.7
    max_tokens: int = 250
    top_k: int = 30
    repetition_penalty: float = 1.25


class HealthResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    status: str
    mode: str
    version: str
    models: dict


# =====================================================================
# 5. ГЕНЕРАТОР ТОКЕНОВ (умный буфер, без артефактов Юникода)
# =====================================================================

async def _generate(
    model,
    error_msg: Optional[str],
    text: str,
    system_prompt: Optional[str],
    temperature: float,
    max_tokens: int,
    top_k: int,
    repetition_penalty: float,
) -> AsyncIterator[str]:

    if model is None:
        yield f"[Ошибка: модель не загружена] {error_msg}"
        return

    safe_temperature = max(0.0, min(float(temperature), 1.5))
    safe_max_tokens = max(1, min(int(max_tokens), 512))
    safe_top_k = max(1, min(int(top_k), 100))
    safe_repetition_penalty = max(1.0, min(float(repetition_penalty), 2.0))
    system_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT

    prompt = f"{system_prompt.strip()}\n\n{text.strip()}"
    input_ids = tokenizer.encode(prompt, add_special_tokens=False)

    if not input_ids:
        yield "[Ошибка]: tokenizer вернул пустой input_ids."
        return

    idx = torch.tensor([input_ids], dtype=torch.long, device=device)

    stop_ids = {0}
    if tokenizer.eos_token_id is not None:
        stop_ids.add(tokenizer.eos_token_id)

    generated_ids = []
    yielded_text = ""

    with torch.no_grad():
        for _ in range(safe_max_tokens):
            idx_cond = idx if idx.size(1) <= config.block_size else idx[:, -config.block_size:]

            output = model(idx_cond)
            logits = output[0] if isinstance(output, tuple) else output
            logits = logits[:, -1, :]

            for token_id in set(idx[0].tolist()):
                if 0 <= token_id < logits.size(-1):
                    if logits[0, token_id] < 0:
                        logits[0, token_id] *= safe_repetition_penalty
                    else:
                        logits[0, token_id] /= safe_repetition_penalty

            if safe_temperature == 0.0:
                idx_next = torch.argmax(logits, dim=-1, keepdim=True)
            else:
                logits = logits / safe_temperature
                values, _ = torch.topk(logits, min(safe_top_k, logits.size(-1)))
                logits = torch.where(
                    logits < values[:, [-1]],
                    torch.full_like(logits, -float("inf")),
                    logits,
                )
                probs = F.softmax(logits, dim=-1)
                idx_next = torch.multinomial(probs, num_samples=1)

            next_token_id = int(idx_next.item())

            if next_token_id in stop_ids:
                break

            idx = torch.cat((idx, idx_next), dim=1)

            generated_ids.append(next_token_id)
            current_full_text = tokenizer.decode(generated_ids)
            new_chunk = current_full_text[len(yielded_text):]

            if "\ufffd" not in new_chunk:
                yield new_chunk
                yielded_text = current_full_text

            await asyncio.sleep(0.001)


# =====================================================================
# 6. SSE ХЕЛПЕР
# =====================================================================

def sse_event(data: str, event: str = "token") -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def make_stream_response(model, error_msg: Optional[str], req: ChatRequest):
    async def event_generator():
        try:
            async for token in _generate(
                model=model,
                error_msg=error_msg,
                text=req.text,
                system_prompt=req.system_prompt,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
                top_k=req.top_k,
                repetition_penalty=req.repetition_penalty,
            ):
                yield sse_event(token)
            yield "event: done\ndata: {}\n\n"
        except asyncio.CancelledError:
            pass
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# =====================================================================
# 7. РОУТЫ
# =====================================================================

@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok" if (model_v12 or model_v11) else "error",
        mode=MODE,
        version="0.6.0",
        models={
            "v1.2": {"ready": model_v12 is not None, "endpoint": "/chat",    "error": error_v12},
            "v1.1": {"ready": model_v11 is not None, "endpoint": "/chat_v1", "error": error_v11},
        },
    )


@app.get("/")
async def root():
    return {
        "name": "MoonAI Backend",
        "version": "0.6.0",
        "models": {
            "v1.2": {"ready": model_v12 is not None, "endpoint": "/chat"},
            "v1.1": {"ready": model_v11 is not None, "endpoint": "/chat_v1"},
        },
    }


@app.post("/chat")
async def chat_v12(req: ChatRequest):
    """MoonAI V1.2 — latest"""
    return make_stream_response(model_v12, error_v12, req)


@app.post("/chat_v1")
async def chat_v11(req: ChatRequest):
    """MoonAI V1.1 — stable"""
    return make_stream_response(model_v11, error_v11, req)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False, log_level="warning")
