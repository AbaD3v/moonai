import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { runAgent, openAITransport } from './agent.mjs';

export function createAgentServer({ apiKey = '', model = '', transport } = {}) {
  let busy = false;
  const configured = Boolean(apiKey.trim() && model.trim());
  return createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    const allowedHosts = new Set([`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`, '127.0.0.1:1420', 'localhost:1420']);
    // Local development only. No wildcard CORS or public key-bearing proxy.
    if (!allowedHosts.has(req.headers.host)) return json(403, { error: 'Недопустимый Host.' });
    if (req.headers.origin && !['http://127.0.0.1:1420', 'http://localhost:1420'].includes(req.headers.origin)) {
      return json(403, { error: 'Недопустимый Origin.' });
    }
    if (req.method === 'GET' && req.url === '/api/agent/status') {
      return json(200, { configured, model: model || null });
    }
    if (req.method !== 'POST' || req.url !== '/api/agent/run') return json(404, { error: 'Маршрут не найден.' });
    if (!configured) return json(503, { error: 'Добавь OPENAI_API_KEY и OPENAI_MODEL в .env и перезапусти сервер агента.' });
    if (busy) return json(429, { error: 'Другой запуск ещё выполняется. Подожди его завершения.' });
    if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Нужен JSON.' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Превышено время запуска: 90 секунд.')), 90_000);
    res.on('close', () => controller.abort());
    busy = true;
    const emit = event => { if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
    try {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 16_384) return json(413, { error: 'Задача слишком длинная.' });
      }
      let goal;
      try { goal = JSON.parse(body).goal; } catch { return json(400, { error: 'Неверный JSON.' }); }
      if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000) return json(400, { error: 'Задача должна содержать от 1 до 4000 символов.' });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      emit({ type: 'start', text: `OpenAI · ${model}` });
      await runAgent({ goal: goal.trim(), model, createResponse: transport ?? openAITransport(apiKey), emit, signal: controller.signal });
    } catch (error) {
      if (!res.destroyed) {
        if (res.headersSent) emit({ type: 'error', text: controller.signal.aborted ? 'Запуск остановлен или превысил 90 секунд.' : error.message });
        else json(500, { error: 'Не удалось запустить агента.' });
      }
    } finally { clearTimeout(timer); busy = false; res.end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createAgentServer({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL })
    .listen(3001, '127.0.0.1', () => console.log('Moon Agent: http://127.0.0.1:3001 (только локальная разработка)'));
}
