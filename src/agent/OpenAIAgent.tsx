import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleStop, RefreshCw } from "lucide-react";

type AgentEvent = { type: string; text: string; action_id?: string };
const labels: Record<string, string> = { start: "Запуск", model: "Модель выбирает действие", tool_call: "Вызов инструмента", tool_result: "Результат инструмента", action_required: "Нужен ответ", final: "Ответ", error: "Ошибка" };

export function OpenAIAgent({ active }: { active: boolean }) {
  const [goal, setGoal] = useState("Рассчитай стоимость 3 билетов по 1200 ₸ и добавь 10% сервисного сбора.");
  const [status, setStatus] = useState<{ configured: boolean; model: string | null; providerLabel: string; setupMessage: string } | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [pendingAction, setPendingAction] = useState<AgentEvent | null>(null);
  const [actionAnswers, setActionAnswers] = useState<Record<string, string>>({});
  const [actionAnswer, setActionAnswer] = useState("");
  const [actionError, setActionError] = useState("");
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
    setPendingAction(null);
    setActionAnswers({});
    setActionAnswer("");
    setActionError("");
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
        if (typeof event.text !== 'string' || !labels[event.type] || (event.type === 'action_required' && typeof event.action_id !== 'string')) throw new Error('Неверный формат события.');
        if (event.type === 'final' || event.type === 'error') finished = true;
        if (event.type === 'action_required') {
          setPendingAction(event);
          setActionAnswer("");
          setActionError("");
        }
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

  async function answerAction(event: AgentEvent) {
    if (!event.action_id || !actionAnswer.trim()) return;
    setActionError("");
    try {
      const res = await fetch('/api/agent/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action_id: event.action_id, answer: actionAnswer }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Сервер агента: HTTP ${res.status}`);
      setActionAnswers(previous => ({ ...previous, [event.action_id!]: actionAnswer }));
      setPendingAction(null);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Не удалось отправить ответ.'); }
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
          {events.map((event, i) => <article className="moon-agent-entry" key={i}><h3>{labels[event.type]}</h3><pre>{event.text}</pre>
            {event.type === 'action_required' && event.action_id && (pendingAction?.action_id === event.action_id || actionAnswers[event.action_id]) && (
              actionAnswers[event.action_id] ? <pre className="text-emerald-400">Ответ пользователя: {actionAnswers[event.action_id]}</pre> :
              <form className="mt-3 flex flex-col gap-2" onSubmit={e => { e.preventDefault(); void answerAction(event); }}>
                <textarea className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400" rows={3} value={actionAnswer} onChange={e => setActionAnswer(e.target.value)} placeholder="Введите ответ" disabled={Boolean(actionAnswers[event.action_id])} />
                <button className="self-start rounded-md bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={!actionAnswer.trim() || Boolean(actionAnswers[event.action_id])}>Ответить</button>
                {actionError && <p className="text-sm text-red-400" role="alert">{actionError}</p>}
              </form>
            )}
          </article>)}
          {running && <p>Агент выполняет задачу…</p>}
        </div>
      </section>
    </div>
  </div>;
}
