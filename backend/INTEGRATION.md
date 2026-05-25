# MoonAI Backend — Локальная интеграция модели

## 📦 Структура файлов

```
backend/
├── main.py                      # FastAPI сервер с SSE стримингом
├── model.py                     # Архитектура MoonAI (150M параметров)
├── .env                         # Конфиг (MOON_MODE=local)
├── tokenizer.json               # 👈 НУЖНО ПОМЕСТИТЬ СЮДА
└── moonai_v2_chat_epoch_1.pt    # 👈 НУЖНО ПОМЕСТИТЬ СЮДА
```

## 🚀 Быстрый старт

### 1. Подготовь файлы модели

Положи рядом с `main.py` два файла:
- **`tokenizer.json`** — твой токенизер (32K vocab)
- **`moonai_v2_chat_epoch_1.pt`** — веса модели (checkpoint)

### 2. Установи зависимости

```bash
# Базовые для FastAPI
pip install fastapi uvicorn httpx python-dotenv

# PyTorch + трансформеры
pip install torch torchvision torchaudio
pip install transformers tokenizers

# Если нужна CUDA поддержка, переустанови torch:
# pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

### 3. Запусти сервер

```bash
cd backend
python main.py
```

Ты должен увидеть:

```
🚀 Загрузка MoonAI на CUDA...
✓ Токенизер загружен из tokenizer.json
✓ Архитектура MoonAI (150M) инициализирована
✓ Веса загружены из moonai_v2_chat_epoch_1.pt
✓ Модель переведена на CUDA

🧠 MoonAI успешно подключена к серверу!

╔══════════════════════════════════╗
║   MoonAI Backend  v0.4.0        ║
║   Mode: local                    ║
║   http://127.0.0.1:8000         ║
╚══════════════════════════════════╝
```

### 4. Проверь здоровье сервера

```bash
curl https://abad3v-moonai-v1-0-150m.hf.space/health
```

Должно вернуть:
```json
{
  "status": "ok",
  "mode": "local",
  "version": "0.4.0",
  "model_ready": true
}
```

### 5. Отправь тестовый запрос

```bash
curl -X POST https://abad3v-moonai-v1-0-150m.hf.space/chat \
  -H "Content-Type: application/json" \
  -d '{"text":"Привет, MoonAI!"}' \
  -N
```

## 🔧 Как работает генерация

### Процесс

1. **Форматирование промпта**:
   ```
   Вопрос: <твой текст>
   Ответ: 
   ```

2. **Токенизация** → `tokenizer.encode(prompt)`

3. **Forward pass** в цикле:
   - Берём последний токен из контекста
   - Forward pass модели
   - Получаем логиты для следующего токена
   - Применяем температуру, Top-K, repetition penalty
   - Сэмплируем токен (или greedy выбор)
   - **Декодируем и отправляем на фронт через SSE**

4. **Остановка** при:
   - Токене `EOS` (конец ответа)
   - Достижении `max_tokens`

### Параметры генерации

Отправляй в `/chat`:

```json
{
  "text": "Твой вопрос",
  "system_prompt": "Ты MoonAI — умный ассистент.",
  "temperature": 0.7,           // 0.0 = greedy, >0 = sampling
  "max_tokens": 1024
}
```

## 📝 Параметры модели

Из `model.py`:

```python
class MoonAIConfig:
    vocab_size = 32768   # Размер словаря токенизера
    block_size = 1024    # Максимальная длина контекста
    n_embd = 768         # Размер эмбеддинга
    n_head = 12          # Количество голов внимания
    n_layer = 12         # Количество трансформер блоков
    dropout = 0.1        # (устанавливается в 0.0 при инференсе)
```

**Всего параметров**: ~150M

## 🐛 Что-то не работает?

### Ошибка: "tokenizer.json not found"
→ Положи файл рядом с `main.py`

### Ошибка: "moonai_v2_chat_epoch_1.pt not found"
→ Положи файл рядом с `main.py`

### CUDA Out of Memory
→ Используется слишком много памяти. Либо уменьши `max_tokens`, либо используй CPU (поменяй `device = 'cpu'` в коде)

### Сервер зависает при генерации
→ Это нормально для GPU, если модель работает. Проверь `nvidia-smi`

### Текст не стримится
→ Убедись, что фронт использует `EventSource()` или `fetch(..., { signal: abortController.signal })`

## 🎯 Режимы работы

В `.env` можно менять `MOON_MODE`:

| Режим | Что происходит |
|-------|---|
| `mock` | Заглушка для тестирования. Отвечает случайные фразы. |
| `api`  | Шлёт запрос на облачный сервер. Нужны `MODEL_API_URL` и `MODEL_API_KEY`. |
| `local` | Использует локальную MoonAI модель. **Это текущий режим.** |

## 📚 Дополнительно

### Как обновить модель?
1. Переобучи в PyTorch с той же архитектурой
2. Сохрани: `torch.save(model.state_dict(), "moonai_v2_chat_epoch_X.pt")`
3. Положи файл в `backend/`
4. Перезагрузи сервер

### Как менять архитектуру?
1. Редактируй `model.py` (классы `MoonAIConfig`, блоки, слои)
2. Обнови `MoonAIConfig()` в `main.py` если менял параметры
3. Перезагрузи сервер

### Оптимизации для production
- Используй `torch.compile()` для ускорения
- Настрой batch processing
- Добавь кэширование KV-кэша между запросами
- Используй `torch.quantization` для уменьшения памяти

---

**Версия**: 0.4.0  
**Язык**: Russian (но код англоязычный)  
**Дата**: 2026-05-17
