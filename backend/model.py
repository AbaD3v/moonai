"""
MoonAI Model Architecture (150M parameters)
============================================
Самописная архитектура трансформера для генерации текста.
Используется в режиме MODE=local.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


# =====================================================================
# --- КОНФИГ ---
# =====================================================================

class MoonAIConfig:
    """Гиперпараметры MoonAI (150M)"""
    vocab_size: int = 32768
    block_size: int = 1024
    n_embd: int = 768
    n_head: int = 12
    n_layer: int = 12
    dropout: float = 0.1


# =====================================================================
# --- КОМПОНЕНТЫ АРХИТЕКТУРЫ ---
# =====================================================================

class CausalSelfAttention(nn.Module):
    """Multi-head self-attention с маской каузальности"""
    
    def __init__(self, config):
        super().__init__()
        assert config.n_embd % config.n_head == 0
        self.c_attn = nn.Linear(config.n_embd, 3 * config.n_embd, bias=False)
        self.c_proj = nn.Linear(config.n_embd, config.n_embd, bias=False)
        self.n_head = config.n_head
        self.n_embd = config.n_embd
        self.dropout = config.dropout

    def forward(self, x):
        B, T, C = x.size()
        qkv = self.c_attn(x)
        q, k, v = qkv.split(self.n_embd, dim=2)
        k = k.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        q = q.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        v = v.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        y = F.scaled_dot_product_attention(q, k, v, attn_mask=None, dropout_p=self.dropout, is_causal=True)
        y = y.transpose(1, 2).contiguous().view(B, T, C)
        return self.c_proj(y)


class MLP(nn.Module):
    """Feedforward network (2 линейных слоя с GELU активацией)"""
    
    def __init__(self, config):
        super().__init__()
        self.c_fc = nn.Linear(config.n_embd, 4 * config.n_embd, bias=False)
        self.gelu = nn.GELU()
        self.c_proj = nn.Linear(4 * config.n_embd, config.n_embd, bias=False)

    def forward(self, x):
        return self.c_proj(self.gelu(self.c_fc(x)))


class Block(nn.Module):
    """Трансформер блок: LayerNorm -> Attention -> Residual + LayerNorm -> MLP -> Residual"""
    
    def __init__(self, config):
        super().__init__()
        self.ln_1 = nn.LayerNorm(config.n_embd)
        self.attn = CausalSelfAttention(config)
        self.ln_2 = nn.LayerNorm(config.n_embd)
        self.mlp = MLP(config)

    def forward(self, x):
        x = x + self.attn(self.ln_1(x))
        x = x + self.mlp(self.ln_2(x))
        return x


class MoonAI(nn.Module):
    """
    Основная архитектура MoonAI (150M параметров)
    
    Компоненты:
    - Token embeddings (wte)
    - Position embeddings (wpe)
    - 12 трансформер блоков
    - Linear layer для логитов (lm_head)
    """
    
    def __init__(self, config):
        super().__init__()
        self.config = config
        self.transformer = nn.ModuleDict(dict(
            wte = nn.Embedding(config.vocab_size, config.n_embd),
            wpe = nn.Embedding(config.block_size, config.n_embd),
            drop = nn.Dropout(config.dropout),
            h = nn.ModuleList([Block(config) for _ in range(config.n_layer)]),
            ln_f = nn.LayerNorm(config.n_embd),
        ))
        self.lm_head = nn.Linear(config.n_embd, config.vocab_size, bias=False)
        # Weight tying: используем то же распределение для wte и lm_head
        self.transformer.wte.weight = self.lm_head.weight
        self.apply(self._init_weights)

    def _init_weights(self, module):
        """Инициализация весов (normal distribution)"""
        if isinstance(module, nn.Linear):
            torch.nn.init.normal_(module.weight, mean=0.0, std=0.02)
        elif isinstance(module, nn.Embedding):
            torch.nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def forward(self, idx, targets=None):
        """
        Args:
            idx: (batch, seq_len) — индексы токенов
            targets: (batch, seq_len) опционально для расчета loss
        
        Returns:
            logits: (batch, seq_len, vocab_size)
            loss: скалярный тензор если targets переданы, иначе None
        """
        device = idx.device
        b, t = idx.size()
        pos = torch.arange(0, t, dtype=torch.long, device=device)
        
        # Embeddings + positional
        x = self.transformer.drop(self.transformer.wte(idx) + self.transformer.wpe(pos))
        
        # Пропускаем через трансформер блоки
        for block in self.transformer.h:
            x = block(x)
        
        # Финальная нормализация
        x = self.transformer.ln_f(x)

        if targets is not None:
            # РЕЖИМ ОБУЧЕНИЯ: считаем loss предсказания следующего токена
            logits = self.lm_head(x)
            # Сдвигаем логиты и таргеты на 1 шаг (предсказываем следующий)
            shift_logits = logits[..., :-1, :].contiguous()
            shift_labels = targets[..., 1:].contiguous()
            # Честный лосс
            loss = F.cross_entropy(shift_logits.view(-1, shift_logits.size(-1)), shift_labels.view(-1))
        else:
            # РЕЖИМ ИНФЕРЕНСА: используем только последний логит
            logits = self.lm_head(x[:, [-1], :])
            loss = None
        
        return logits, loss
