import asyncio
import json
import os
import sys
from typing import AsyncIterator, Optional

import torch
import torch.nn.functional as F
from transformers import PreTrainedTokenizerFast
from tokenizers import Tokenizer as BaseTokenizer
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from huggingface_hub import hf_hub_download

load_dotenv()

# =====================================================================
# 1. ПОДКЛЮЧЕНИЕ АРХИТЕКТУРЫ И АВТОСКАН ВЕСОВ С HUB
# =====================================================================
sys.path.append(os.path.dirname(__file__))

from config import MoonAIConfig
from model import MoonAIForCausalLM

device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"\n🚀 Загрузка MoonAI 700M на целевом устройстве: {device.upper()}...")

TOKENIZER_PATH = os.path.join(os.path.dirname(__file__), "tokenizer_moonai700m_chat.json")

# 📥 Скачиваем веса с Hugging Face Hub (Model Repository), обходя лимит Спейса в 1 ГБ
try:
    print("⏳ Подтягиваем свежий чекпоинт весов из Hugging Face Hub...")
    CHECKPOINT_PATH = hf_hub_download(
        repo_id="AbaD3v/moonai-730m",  # Твой репозиторий моделей на HF
        filename="moonai_700m_latest.pt"
    )
    print(f"✓ Веса успешно загружены в кэш контейнера: {CHECKPOINT_PATH}")
except Exception as e:
    print(f"⚠️ Не удалось загрузить веса из Hub: {e}")
    print("🔄 Пробуем проверить локальный путь...")
    CHECKPOINT_PATH = os.path.join(os.path.dirname(__file__), "moonai_700m_latest.pt")

model_loaded = False
tokenizer = None
model = None
error_message = None

MODE = os.getenv("MOON_MODE", "local") 

try:
    if os.path.exists(TOKENIZER_PATH) and os.path.exists(CHECKPOINT_PATH):
        # 1. Загрузка токенизатора
        raw_tokenizer = BaseTokenizer.from_file(TOKENIZER_PATH)
        tokenizer = PreTrainedTokenizerFast(tokenizer_object=raw_tokenizer)
        print(f"✓ Токенизатор успешно инициализирован.")
        
        # 2. Инициализация геометрии 700М модели
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
        model = MoonAIForCausalLM(config)
        print(f"✓ Структура слоев MoonAI (700M) собрана.")
        
        # 3. Безопасная накатка чекпоинта
        torch.serialization.add_safe_globals([MoonAIConfig])
        checkpoint = torch.load(CHECKPOINT_PATH, map_location="cpu", weights_only=True)
        state_dict = checkpoint["model"] if isinstance(checkpoint, dict) and "model" in checkpoint else checkpoint
        
        # Очищаем префиксы распределенного компилятора TPU
        cleaned_sd = {k.replace("_orig_module.", "").replace("module.", ""): v for k, v in state_dict.items()}
        model.load_state_dict(cleaned_sd, strict=True)
        
        # Оптимизация памяти под GPU, если HF выдаст нам инстанс с T4
        if device == 'cuda':
            model = model.bfloat16()
            
        model.to(device)
        model.eval()
        
        model_loaded = True
        print("\n🧠 Веб-движок MoonAI 700M полностью готов к работе!\n")
    else:
        missing_files = []
        if not os.path.exists(TOKENIZER_PATH): missing_files.append(TOKENIZER_PATH)
        if not os.path.exists(CHECKPOINT_PATH): missing_files.append(CHECKPOINT_PATH)
        error_message = f"⚠️ Критические файлы не обнаружены:\n" + "\n".join(missing_files)
        print(f"\n{error_message}\n")
except Exception as e:
    error_message = f"❌ Ошибка сборки инференса: {str(e)}"
    print(f"\n{error_message}\n")

# =====================================================================
# 2. ИНИЦИАЛИЗАЦИЯ API СЕРВЕРА FASTAPI
# =====================================================================
app = FastAPI(title="MoonAI Backend 700M", version="0.5.0")

# Настраиваем CORS-политику для твоего Tauri-приложения и веб-версии
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

class HealthResponse(BaseModel):
    status: str
    mode: str
    version: str
    model_ready: bool

# =====================================================================
# 3. АСИНХРОННЫЙ ИНФЕРЕНС (TOP-K + ШТРАФ ЗА ПОВТОРЕНИЯ)
# =====================================================================
async def _local_generate(text: str, temperature: float, max_tokens: int) -> AsyncIterator[str]:
    """Генератор токенов в реальном времени с фильтрацией бреда."""
    if not model_loaded:
        yield f"[Ошибка инициализации весов на сервере]: {error_message}"
        return

    # Формируем структуру контекста
    prompt = f"Вопрос: {text.strip()}\nОтвет: "
    input_ids = tokenizer.encode(prompt, add_special_tokens=False)
    idx = torch.tensor([input_ids], dtype=torch.long, device=device)
    
    repetition_penalty = 1.15
    top_k = 40
    
    with torch.no_grad():
        for _ in range(max_tokens):
            # Контролируем границы контекстного окна
            idx_cond = idx if idx.size(1) <= config.block_size else idx[:, -config.block_size:]
            
            logits, _ = model(idx_cond)
            logits = logits[:, -1, :]  # Забираем логиты последнего токена
            
            # Штрафуем токены, которые модель уже использовала
            for token_id in set(idx[0].tolist()):
                if logits[0, token_id] < 0:
                    logits[0, token_id] *= repetition_penalty
                else:
                    logits[0, token_id] /= repetition_penalty
            
            if temperature == 0.0:
                # Настройки для точных ответов (Greedy)
                idx_next = torch.argmax(logits, dim=-1, keepdim=True)
            else:
                # Температурное сэмплирование + Top-K отсечение хвоста вероятностей
                logits = logits / temperature
                v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                logits[logits < v[:, [-1]]] = -float('Inf')
                
                probs = F.softmax(logits, dim=-1)
                idx_next = torch.multinomial(probs, num_samples=1)
            
            next_token_id = idx_next.item()
            
            # Ловим токен завершения текста <|endoftext|>
            if next_token_id == 0 or (tokenizer.eos_token_id and next_token_id == tokenizer.eos_token_id):
                break
                
            idx = torch.cat((idx, idx_next), dim=1)
            
            # Декодируем и отправляем чанк токена наружу
            new_token_str = tokenizer.decode([next_token_id])
            yield new_token_str
            
            # Сдаем квант времени планировщику FastAPI (SSE стриминг без фризов бэкенда)
            await asyncio.sleep(0.001)

# =====================================================================
# 4. SSE ФОРМАТИРОВАНИЕ И РОУТЫ СЕРВЕРА
# =====================================================================
def sse_event(data: str, event: str = "token") -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        mode=MODE,
        version="0.5.0",
        model_ready=model_loaded,
    )

@app.post("/chat")
async def chat_stream(req: ChatRequest):
    async def event_generator():
        try:
            async for token in _local_generate(text=req.text, temperature=req.temperature, max_tokens=req.max_tokens):
                yield sse_event(token)
            yield f"event: done\ndata: {{}}\n\n"
        except asyncio.CancelledError:
            pass  # Перехват обрыва связи со стороны фронтенда (нажата кнопка Stop / закрыта вкладка)
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

if __name__ == "__main__":
    # На HF Spaces приложение обязано слушать хост 0.0.0.0
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False, log_level="warning")