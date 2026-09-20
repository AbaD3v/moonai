import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleStop, RefreshCw } from "lucide-react";

type AgentEvent = { type: string; text: string };
const labels: Record<string, string> = { start: "Запуск", model: "Модель выбирает действие", tool_call: "Вызов инструмента", tool_result: "Результат инструмента", final: "Ответ", error: "Ошибка" };

export function OpenAIAgent({ active }: { active: boolean }) {
  const [goal, setGoal] = useState("Рассчитай стоимость 3 билетов по 1200 ₸ и добавь 10% сервисного сбора.");
  const [status, setStatus] = useState<{ configured: boolean; model: string | null; providerLabel: string; setupMessage: string } | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!active) return;
    const request = new AbortController();
    setConnectionError("");
    fetch('/api/agent/status', { signal: request.signal })
      .then(async res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(setStatus)
      .catch(() => { if (!request.signal.aborted) { setStatus(null); setConnectionError('Сервер агента недоступен. Запусти npm run agent:dev и обнови статус.'); } });
    return () => request.abort();
  }, [active, refresh]);
  useEffect(() => () => controller.current?.abort(), []);

  async function start() {
    if (controller.current || !goal.trim()) return;
    const request = new AbortController();
    controller.current = request;
    setRunning(true);
    setEvents([]);
    const add = (event: AgentEvent) => setEvents(previous => [...previous, event]);
    try {
      const res = await fetch('/api/agent/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal }), signal: request.signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Сервер агента: HTTP ${res.status}`);
      }
      if (!res.body) throw new Error('Сервер не вернул журнал.');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      const consume = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as AgentEvent;
        if (typeof event.text !== 'string' || !labels[event.type]) throw new Error('Неверный формат события.');
        if (event.type === 'final' || event.type === 'error') finished = true;
        add(event);
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        lines.forEach(consume);
        if (done) { consume(buffer); break; }
      }
      if (!finished) throw new Error('Соединение прервалось до завершения ответа.');
    } catch (error) {
      add({ type: 'error', text: request.signal.aborted ? 'Остановлено пользователем.' : error instanceof Error ? error.message : 'Не удалось выполнить задачу.' });
    } finally { controller.current = null; setRunning(false); }
  }

  return <div hidden={!active}>
    <div className="moon-agent-notice">
      <strong>{status ? `${status.providerLabel} · ${status.model || 'модель не выбрана'}` : 'Настройка API'}</strong>
      <span>{connectionError || (status?.configured ? 'Настройки найдены. Доступ к модели проверится при запуске.' : status ? status.setupMessage : 'Проверяем сервер агента…')}</span>
      <button type="button" className="moon-agent-secondary" disabled={running} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={14} /> Обновить статус</button>
    </div>
    <div className="moon-agent-grid moon-agent-live-grid">
      <section className="moon-agent-example">
        <h2>Задача для агента</h2>
        <p>Модель сама выбирает действия. Доступен калькулятор: сложение, вычитание, умножение и деление.</p>
        <form onSubmit={e => { e.preventDefault(); void start(); }}>
          <label>Что нужно сделать?<textarea className="moon-agent-goal" rows={5} maxLength={4000} value={goal} onChange={e => setGoal(e.target.value)} disabled={running} required /></label>
          <button type="submit" className="moon-agent-primary" disabled={running || !status?.configured || !goal.trim()}>Запустить{status ? ` с ${status.providerLabel}` : ''} <ArrowRight size={16} /></button>
        </form>
        {running && <button className="moon-agent-secondary" type="button" onClick={() => controller.current?.abort()}><CircleStop size={16} /> Остановить</button>}
        <p className="moon-agent-limits">До 5 обращений к модели · до 90 секунд. Каждый запуск — отдельная задача. Запросы расходуют квоту API твоего проекта.</p>
      </section>
      <section className="moon-agent-log">
        <h2>Журнал агента</h2>
        <p>Реальные события сервера: вызовы, результаты и финальный ответ.</p>
        <div aria-live="polite" aria-busy={running}>
          {!events.length && <div className="moon-agent-empty">После запуска здесь появится ход выполнения.</div>}
          {events.map((event, i) => <article className="moon-agent-entry" key={i}><h3>{labels[event.type]}</h3><pre>{event.text}</pre></article>)}
          {running && <p>Агент выполняет задачу…</p>}
        </div>
      </section>
    </div>
  </div>;
}
