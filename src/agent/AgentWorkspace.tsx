import { useState, type ReactNode } from "react";
import { ArrowRight, Bot, Check, PanelLeft, RotateCcw, Wrench } from "lucide-react";
import { OpenAIAgent } from "./OpenAIAgent";

const stages = [
  { title: "Задача", description: "Пользователь задаёт цель. Приложение сохраняет её в контексте запуска." },
  { title: "Выбор действия", description: "В агенте модель выбирает инструмент и его аргументы. Здесь этот выбор заранее задан учебным сценарием." },
  { title: "Выполнение", description: "Программа проверяет аргументы и запускает разрешённую функцию. Вычисление выполняет код, а не языковая модель." },
  { title: "Наблюдение", description: "Результат инструмента возвращается в контекст. Модель получает факты для следующего решения." },
  { title: "Ответ", description: "Агент завершает задачу или выбирает ещё одно действие. В этом примере достаточно одного вызова." },
];

// A deliberately bounded tool: no eval, network, filesystem or arbitrary code.
function multiply(price: number, quantity: number) {
  if (!Number.isInteger(price) || price < 1 || price > 1_000_000 ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 1_000) {
    throw new Error("Цена: целое число от 1 до 1 000 000. Количество: от 1 до 1 000.");
  }
  return price * quantity;
}

export function AgentWorkspace({ hidden, onToggleSidebar, sidebarOpen, themeControl }: {
  hidden: boolean;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  themeControl: ReactNode;
}) {
  const [provider, setProvider] = useState<"demo" | "openai">("openai");
  const [price, setPrice] = useState("1200");
  const [quantity, setQuantity] = useState("3");
  const [step, setStep] = useState(-1);
  const [run, setRun] = useState<{ price: number; quantity: number } | null>(null);
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState("");
  const format = (value: number) => value.toLocaleString("ru-RU");

  function start() {
    const next = { price: Number(price), quantity: Number(quantity) };
    try {
      // Validate without executing the tool; execution happens at stage 3.
      if (!Number.isInteger(next.price) || next.price < 1 || next.price > 1_000_000 ||
          !Number.isInteger(next.quantity) || next.quantity < 1 || next.quantity > 1_000) {
        throw new Error("Цена: целое число от 1 до 1 000 000. Количество: от 1 до 1 000.");
      }
      setRun(next);
      setResult(null);
      setError("");
      setStep(0);
    } catch (e) { setError(e instanceof Error ? e.message : "Проверь числа."); }
  }

  function advance() {
    if (!run || step < 0 || step >= stages.length - 1) return;
    if (step === 1) {
      try { setResult(multiply(run.price, run.quantity)); }
      catch (e) { setError(e instanceof Error ? e.message : "Ошибка инструмента."); return; }
    }
    setStep(step + 1);
  }

  function reset() { setStep(-1); setRun(null); setResult(null); setError(""); }

  const entries = run ? [
    `Сколько стоят ${run.quantity} шт. по ${format(run.price)} ₸?`,
    JSON.stringify({ tool: "multiply", arguments: { price: run.price, quantity: run.quantity } }, null, 2),
    result === null ? "" : `multiply(${run.price}, ${run.quantity}) → ${result}`,
    JSON.stringify({ tool: "multiply", result }, null, 2),
    result === null ? "" : `Итого: ${format(result)} ₸. ${run.quantity} × ${format(run.price)} = ${format(result)}.`,
  ] : [];

  return (
    <section className="moon-main moon-agent" style={hidden ? { display: "none" } : undefined} aria-label="Moon Agent">
      <header className="moon-header">
        <div className="moon-header-left">
          <button type="button" className="moon-icon-btn" onClick={onToggleSidebar} aria-label={sidebarOpen ? "Скрыть панель" : "Показать панель"}><PanelLeft size={19} /></button>
          <span>Moon Agent</span>
        </div>
        <div className="moon-header-right">{themeControl}</div>
      </header>
      <main className="moon-agent-content">
        <div className="moon-agent-intro">
          <span className="moon-agent-label"><Bot size={15} /> ЛАБОРАТОРИЯ</span>
          <h1>От ответа к действию</h1>
          <p>Посмотри, как задача превращается в вызов инструмента, а результат — в ответ.</p>
        </div>

        <div className="moon-mode-switch moon-agent-provider" role="group" aria-label="Источник действий">
          <button type="button" aria-pressed={provider === "openai"} onClick={() => setProvider("openai")}>OpenAI API</button>
          <button type="button" aria-pressed={provider === "demo"} onClick={() => setProvider("demo")}>Разбор без ключа</button>
        </div>
        <OpenAIAgent active={provider === "openai" && !hidden} />
        <div hidden={provider !== "demo"}>
        <div className="moon-agent-notice"><strong>Учебный сценарий</strong><span>Модель не вызывается. Действие и финальный текст заданы кодом; инструмент считает по-настоящему.</span></div>

        <ol className="moon-agent-stages" aria-label="Этапы цикла">
          {stages.map((stage, i) => <li key={stage.title} className={i === step ? "current" : i < step ? "complete" : ""} aria-current={i === step ? "step" : undefined}>
            <span>{i < step ? <Check size={14} /> : i + 1}</span>{stage.title}
          </li>)}
        </ol>

        <div className="moon-agent-grid">
          <section className="moon-agent-example" aria-labelledby="agent-example-title">
            <h2 id="agent-example-title">Пример: стоимость покупки</h2>
            <p>Начни с одного инструмента и одной проверяемой задачи.</p>
            <form onSubmit={e => { e.preventDefault(); start(); }}>
              <label>Цена за штуку, ₸<input type="number" min="1" max="1000000" step="1" required value={price} disabled={step >= 0} onChange={e => setPrice(e.target.value)} /></label>
              <label>Количество<input type="number" min="1" max="1000" step="1" required value={quantity} disabled={step >= 0} onChange={e => setQuantity(e.target.value)} /></label>
              {step < 0 && <button className="moon-agent-primary" type="submit">Начать разбор <ArrowRight size={16} /></button>}
            </form>
            {step >= 0 && <div className="moon-agent-actions">
              {step < 4 && <button className="moon-agent-primary" type="button" onClick={advance}>Следующий шаг <ArrowRight size={16} /></button>}
              <button className="moon-agent-secondary" type="button" onClick={reset}><RotateCcw size={14} /> Сбросить</button>
            </div>}
            {error && <p role="alert">{error}</p>}
            <div className="moon-agent-tool"><Wrench size={16} /><div><strong>multiply</strong><p>Принимает цену и количество. Возвращает их произведение.</p></div></div>
          </section>

          <section className="moon-agent-log" aria-labelledby="agent-log-title">
            <h2 id="agent-log-title">Журнал выполнения</h2>
            <p>Входные данные, вызовы и результаты — не скрытые рассуждения модели.</p>
            <div aria-live="polite" aria-atomic="false">
              {step < 0 ? <div className="moon-agent-empty">Нажми «Начать разбор», чтобы пройти цикл по шагам.</div> : stages.slice(0, step + 1).map((stage, i) => <article key={stage.title} className="moon-agent-entry">
                <h3><span>0{i + 1}</span> {stage.title}</h3>
                <p>{stage.description}</p>
                <pre>{entries[i]}</pre>
              </article>)}
              {step === 4 && <p className="moon-agent-done"><Check size={16} /> Цикл завершён. Выполнен 1 вызов инструмента.</p>}
            </div>
          </section>
        </div>

        <section className="moon-agent-next">
          <h2>Как перейти к настоящему агенту?</h2>
          <p>Выбери «OpenAI API». Сервер передаст задачу и описание калькулятора модели OpenAI. Она выберет действие, получит результат инструмента и решит, что делать дальше.</p>
          <p>Ключ и название модели настраиваются на сервере. Твоя MoonAI остаётся в отдельном режиме чата.</p>
        </section>
        </div>
      </main>
    </section>
  );
}
