export const tools = [{
  type: 'function', name: 'calculate',
  description: 'Выполняет одну арифметическую операцию над двумя числами. Используй для вычислений.',
  strict: true,
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
      a: { type: 'number' }, b: { type: 'number' },
    },
    required: ['operation', 'a', 'b'],
  },
}];

export function executeTool(name, args) {
  if (name !== 'calculate') throw new Error('Неизвестный инструмент.');
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).sort().join(',') !== 'a,b,operation' ||
      !['add', 'subtract', 'multiply', 'divide'].includes(args.operation) ||
      ![args.a, args.b].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e12)) {
    throw new Error('Неверные аргументы calculate: нужны operation и два числа по модулю не больше 10¹².');
  }
  if (args.operation === 'divide' && args.b === 0) throw new Error('Деление на ноль.');
  const result = { add: () => args.a + args.b, subtract: () => args.a - args.b,
    multiply: () => args.a * args.b, divide: () => args.a / args.b }[args.operation]();
  if (!Number.isFinite(result)) throw new Error('Результат вне допустимого диапазона.');
  return { result };
}

export async function runAgent({ goal, model, createResponse, emit, signal }) {
  const input = [{ role: 'user', content: goal }];
  let calls = 0;
  for (let step = 1; step <= 5; step++) {
    signal.throwIfAborted();
    emit({ type: 'model', text: `Запрос к модели · шаг ${step}/5` });
    const response = await createResponse({
      model, input, tools, store: false,
      include: ['reasoning.encrypted_content'],
      parallel_tool_calls: false, max_output_tokens: 2048,
      instructions: 'Ты Moon Agent, учебный помощник. Отвечай на языке пользователя. Для арифметики используй calculate. Не выдумывай результаты инструментов. У тебя нет доступа к файлам и интернету. Если данных недостаточно, попроси уточнение. После результата дай краткий ответ. Не раскрывай внутренние рассуждения.',
    }, signal);
    signal.throwIfAborted();
    if (response.status !== 'completed' || !Array.isArray(response.output)) {
      throw new Error('Модель не завершила ответ. Попробуй сократить задачу или выбрать другую модель.');
    }
    // Preserve all output items, including reasoning state, for Responses continuation.
    input.push(...response.output);
    const toolCalls = response.output.filter(item => item.type === 'function_call');
    if (!toolCalls.length) {
      const answer = response.output.filter(item => item.type === 'message')
        .flatMap(item => item.content ?? [])
        .map(item => item.type === 'output_text' ? item.text : item.type === 'refusal' ? item.refusal : '')
        .filter(Boolean).join('\n');
      if (!answer) throw new Error('Модель вернула пустой ответ.');
      emit({ type: 'final', text: answer });
      return;
    }
    for (const call of toolCalls) {
      signal.throwIfAborted();
      if (++calls > 8) throw new Error('Достигнут лимит: 8 вызовов инструментов.');
      emit({ type: 'tool_call', text: `${call.name}\n${call.arguments}` });
      let output;
      try { output = executeTool(call.name, JSON.parse(call.arguments)); }
      catch (error) { output = { error: error.message }; }
      emit({ type: 'tool_result', text: JSON.stringify(output) });
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
    }
  }
  throw new Error('Достигнут лимит: 5 обращений к модели. Уточни или сократи задачу.');
}

export function openAITransport(apiKey, fetchImpl = fetch) {
  return async (body, signal) => {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // Do not forward provider payloads, which may contain credentials or request data.
      const explanations = { 401: 'Проверь OPENAI_API_KEY.', 403: 'Нет доступа к API или модели.',
        404: 'Проверь OPENAI_MODEL и доступ проекта.', 429: 'Лимит запросов или квота исчерпаны.',
        400: 'Модель отклонила запрос. Проверь поддержку Responses API и function calling.' };
      throw new Error(`OpenAI: HTTP ${response.status}. ${explanations[response.status] ?? 'Сервис временно недоступен.'}`);
    }
    return response.json();
  };
}
