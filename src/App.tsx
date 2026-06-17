import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Bot, User, Sparkles, PanelLeft, Plus,
  Copy, Check, Mic, Sun, Moon, Zap, Upload,
  FileText, X, ChevronDown, CircleStop, Trash2, ChevronRight
} from "lucide-react";

// ─── SpeechRecognition types ──────────────────────────────────────────────────
interface ISpeechRecognitionResult {
  readonly length: number;
  item(index: number): { readonly transcript: string };
  [index: number]: { readonly transcript: string };
}
interface ISpeechRecognitionResultList {
  readonly length: number;
  item(index: number): ISpeechRecognitionResult;
  [index: number]: ISpeechRecognitionResult;
}
interface ISpeechRecognitionEvent extends Event {
  readonly results: ISpeechRecognitionResultList;
}
interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: ISpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Theme = "dark" | "light" | "midnight";
type BackendStatus = "idle" | "connecting" | "online" | "offline";

interface Message {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp: number;
  files?: UploadedFile[];
  modelId?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  lastActive: number;
  modelId?: string;
}

interface UploadedFile {
  name: string;
  size: number;
  type: string;
}

// ─── Model Definitions ────────────────────────────────────────────────────────
interface ModelDef {
  id: string;
  name: string;
  tag: string;
  endpoint: string;
  description: string;
  color: string;
}

const MODELS: ModelDef[] = [
  {
    id: "moonai-700m-v2",
    name: "MoonAI 700M",
    tag: "v2 · latest",
    endpoint: "/chat",
    description: "Последняя версия",
    color: "#6366f1",
  },
  {
    id: "moonai-700m-v1",
    name: "MoonAI 700M",
    tag: "v1 · stable",
    endpoint: "/chat_v1",
    description: "Стабильная версия",
    color: "#a78bfa",
  },
];

// ─── Theme Definitions ────────────────────────────────────────────────────────
const themes: Record<Theme, Record<string, string>> = {
  dark: {
    "--bg-base":       "#0d1117",
    "--bg-surface":    "#161b22",
    "--bg-elevated":   "#1c2128",
    "--border":        "#30363d",
    "--border-focus":  "#6366f1",
    "--text-primary":  "#e6edf3",
    "--text-secondary":"#8b949e",
    "--text-muted":    "#484f58",
    "--accent":        "#6366f1",
    "--accent-hover":  "#818cf8",
    "--accent-dim":    "rgba(99,102,241,0.15)",
    "--user-bubble":   "#6366f1",
    "--green":         "#3fb950",
    "--glass-bg":      "rgba(22,27,34,0.85)",
    "--glass-border":  "rgba(48,54,61,0.6)",
  },
  midnight: {
    "--bg-base":       "#060910",
    "--bg-surface":    "#0b0f1a",
    "--bg-elevated":   "#111827",
    "--border":        "#1e2433",
    "--border-focus":  "#a78bfa",
    "--text-primary":  "#dde6f5",
    "--text-secondary":"#6b7ca4",
    "--text-muted":    "#3a4560",
    "--accent":        "#a78bfa",
    "--accent-hover":  "#c4b5fd",
    "--accent-dim":    "rgba(167,139,250,0.12)",
    "--user-bubble":   "#7c3aed",
    "--green":         "#34d399",
    "--glass-bg":      "rgba(11,15,26,0.88)",
    "--glass-border":  "rgba(30,36,51,0.7)",
  },
  light: {
    "--bg-base":       "#f6f8fa",
    "--bg-surface":    "#ffffff",
    "--bg-elevated":   "#f0f2f5",
    "--border":        "#d0d7de",
    "--border-focus":  "#6366f1",
    "--text-primary":  "#1f2328",
    "--text-secondary":"#57606a",
    "--text-muted":    "#b0b8c1",
    "--accent":        "#6366f1",
    "--accent-hover":  "#4f46e5",
    "--accent-dim":    "rgba(99,102,241,0.1)",
    "--user-bubble":   "#6366f1",
    "--green":         "#1a7f37",
    "--glass-bg":      "rgba(255,255,255,0.88)",
    "--glass-border":  "rgba(208,215,222,0.6)",
  },
};

// ─── Markdown Renderer ────────────────────────────────────────────────────────
function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function CodeBlock({ lang, value }: { lang: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [value]);
  return (
    <div className="moon-code-block">
      <div className="moon-code-header">
        <span className="moon-code-lang">{lang || "text"}</span>
        <button className="moon-code-copy" onClick={handleCopy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? "Скопировано" : "Копировать"}</span>
        </button>
      </div>
      <pre className="moon-code-pre"><code>{value}</code></pre>
    </div>
  );
}

function SimpleMarkdown({ content }: { content: string }) {
  const parts = useMemo(() => {
    const codeRe = /```([^\n`]*)\n([\s\S]*?)```|\[code(?:=([^\]]*))?]([\s\S]*?)\[\/code\]/g;
    const out: Array<{ type: "text" | "code"; value: string; lang?: string }> = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = codeRe.exec(content)) !== null) {
      if (m.index > last) out.push({ type: "text", value: content.slice(last, m.index) });
      if (m[0].startsWith("```")) {
        const rawLang = (m[1] || "text").trim();
        out.push({ type: "code", lang: rawLang.split(/\s+/)[0] || "text", value: m[2].trim() });
      } else {
        out.push({ type: "code", lang: (m[3] || "text").trim() || "text", value: m[4].trim() });
      }
      last = codeRe.lastIndex;
    }
    if (last < content.length) out.push({ type: "text", value: content.slice(last) });
    return out;
  }, [content]);

  const formatInline = useCallback((text: string) => {
    const safe = escapeHtml(text);
    return safe
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[b\](.*?)\[\/b\]/gi, "<strong>$1</strong>")
      .replace(/(?<!\*)\*((?!\*)[^\*\n]+?)\*(?!\*)/g, "<em>$1</em>")
      .replace(/_((?!_)[^_\n]+?)_/g, "<em>$1</em>")
      .replace(/\[i\](.*?)\[\/i\]/gi, "<em>$1</em>")
      .replace(/\[s\](.*?)\[\/s\]/gi, "<del>$1</del>")
      .replace(/\[u\](.*?)\[\/u\]/gi, '<u>$1</u>')
      .replace(/`([^`\n]+)`/g, '<code class="moon-inline-code">$1</code>')
      .replace(/\[code\](.*?)\[\/code\]/gi, '<code class="moon-inline-code">$1</code>')
      .replace(/\[color=([^\]]+)\](.*?)\[\/color\]/gi, '<span style="color: $1">$2</span>')
      .replace(/\[url=([^\]]+)\](.*?)\[\/url\]/gi, '<a class="moon-link" href="$1" target="_blank" rel="noopener noreferrer">$2</a>')
      .replace(/\[url\](.*?)\[\/url\]/gi, '<a class="moon-link" href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }, []);

  const isTableSeparator = (line: string) =>
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  const isTableLine = (line: string) => {
    if (!line.includes("|")) return false;
    return line.split("|").filter(Boolean).map(c => c.trim()).length > 1;
  };
  const parseTableCells = (line: string) => line.split("|").filter(Boolean).map(c => c.trim());

  const renderTable = (rows: string[], key: string) => {
    const cleanRows = rows.filter(r => !isTableSeparator(r));
    if (cleanRows.length === 0) return null;
    return (
      <div key={key} className="moon-table">
        {cleanRows.map((row, i) => (
          <div key={i} className={`moon-table-row ${i === 0 ? "head" : ""}`}>
            {parseTableCells(row).map((cell, j) => (
              <span key={j} className="moon-table-cell" dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />
            ))}
          </div>
        ))}
      </div>
    );
  };

  const renderLine = (line: string, i: number) => {
    const rawLine = line.trim();
    if (!rawLine) return <div key={i} className="moon-md-spacer" />;
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return <hr key={i} className="moon-hr" />;
    const hMatch = rawLine.match(/^(?:\*\*)?(#{1,3})\s+(.+?)(?:\*\*)?$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const text = hMatch[2].replace(/^\*\*/, "").replace(/\*\*$/, "").trim();
      const Tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      const cls = level === 1 ? "moon-h1" : level === 2 ? "moon-h2" : "moon-h3";
      return <Tag key={i} className={cls} dangerouslySetInnerHTML={{ __html: formatInline(text) }} />;
    }
    return <p key={i} className="moon-para" dangerouslySetInnerHTML={{ __html: formatInline(line) || "&nbsp;" }} />;
  };

  const renderLines = (lines: string[]) => {
    const nodes: React.ReactNode[] = [];
    let bulletItems: string[] = [];
    let orderedItems: string[] = [];
    let tableRows: string[] = [];

    const flushBullets = () => {
      if (!bulletItems.length) return;
      nodes.push(
        <ul key={`ul-${nodes.length}`} className="moon-list">
          {bulletItems.map((item, idx) => (
            <li key={idx} className="moon-list-item" dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
          ))}
        </ul>
      );
      bulletItems = [];
    };
    const flushOrdered = () => {
      if (!orderedItems.length) return;
      nodes.push(
        <ol key={`ol-${nodes.length}`} className="moon-olist">
          {orderedItems.map((item, idx) => (
            <li key={idx} className="moon-olist-item" dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
          ))}
        </ol>
      );
      orderedItems = [];
    };
    const flushTable = () => {
      if (!tableRows.length) return;
      nodes.push(renderTable(tableRows, `table-${nodes.length}`));
      tableRows = [];
    };
    const flushAll = () => { flushTable(); flushBullets(); flushOrdered(); };

    lines.forEach((line, i) => {
      const bulletMatch = line.match(/^[-*+]\s+(.*)/);
      const orderedMatch = line.match(/^\d+\.\s+(.*)/);
      if (isTableLine(line) || isTableSeparator(line)) {
        flushBullets(); flushOrdered(); tableRows.push(line); return;
      }
      if (bulletMatch) { flushTable(); flushOrdered(); bulletItems.push(bulletMatch[1]); return; }
      if (orderedMatch) { flushTable(); flushBullets(); orderedItems.push(orderedMatch[1]); return; }
      flushAll();
      nodes.push(renderLine(line, i));
    });
    flushAll();
    return nodes;
  };

  return (
    <div className="moon-md">
      {parts.map((part, i) =>
        part.type === "code"
          ? <CodeBlock key={i} lang={part.lang!} value={part.value} />
          : <div key={i}>{renderLines(part.value.split("\n"))}</div>
      )}
    </div>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="moon-typing">
      <span /><span /><span />
    </div>
  );
}

// ─── Voice Wave ───────────────────────────────────────────────────────────────
function VoiceWave() {
  return (
    <div className="moon-wave">
      {[...Array(5)].map((_, i) => (
        <span key={i} style={{ animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

// ─── Model Selector ───────────────────────────────────────────────────────────
function ModelSelector({ selected, onChange }: { selected: string; onChange: (id: string) => void }) {
  return (
    <div className="moon-model-selector">
      <span className="moon-model-label">Модель:</span>
      <div className="moon-model-chips">
        {MODELS.map((m) => (
          <button
            key={m.id}
            className={`moon-model-chip ${selected === m.id ? "active" : ""}`}
            onClick={() => onChange(m.id)}
            style={{ "--chip-color": m.color } as React.CSSProperties}
          >
            <span className="moon-model-chip-dot" />
            <span className="moon-model-chip-name">{m.name}</span>
            <span className="moon-model-chip-tag">{m.tag}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Theme Toggle ─────────────────────────────────────────────────────────────
function ThemeToggle({ current, onChange }: { current: Theme; onChange: (t: Theme) => void }) {
  const [open, setOpen] = useState(false);
  const options: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: "dark",     label: "Dark",     icon: <Moon size={13} /> },
    { id: "midnight", label: "Midnight", icon: <Zap size={13} /> },
    { id: "light",    label: "Light",    icon: <Sun size={13} /> },
  ];
  return (
    <div className="moon-theme-toggle">
      <button className="moon-theme-btn" onClick={() => setOpen(!open)}>
        {options.find(o => o.id === current)?.icon}
        <span>{options.find(o => o.id === current)?.label}</span>
        <ChevronDown size={12} style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            className="moon-theme-dropdown"
          >
            {options.map(o => (
              <button
                key={o.id}
                className={`moon-theme-option ${current === o.id ? "active" : ""}`}
                onClick={() => { onChange(o.id); setOpen(false); }}
              >
                {o.icon}<span>{o.label}</span>
                {current === o.id && <Check size={11} style={{ marginLeft: "auto" }} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────
function DropZone({ onFiles, onClose }: { onFiles: (files: UploadedFile[]) => void; onClose: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<UploadedFile[]>([]);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).map(f => ({ name: f.name, size: f.size, type: f.type }));
    setDropped(files);
    onFiles(files);
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="moon-dropzone-overlay"
    >
      <button className="moon-dropzone-close" onClick={onClose}><X size={16} /></button>
      <div
        className={`moon-dropzone-area ${dragging ? "dragging" : ""}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <Upload size={32} className="moon-dropzone-icon" />
        <p className="moon-dropzone-title">Перетащи файлы сюда</p>
        <p className="moon-dropzone-sub">или нажми, чтобы выбрать</p>
        {dropped.length > 0 && (
          <div className="moon-dropzone-files">
            {dropped.map((f, i) => (
              <div key={i} className="moon-file-chip"><FileText size={12} /><span>{f.name}</span></div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Storage helpers ──────────────────────────────────────────────────────────
const STORAGE_KEY = "moonai_sessions";
const THEME_KEY   = "moonai_theme";
const MODEL_KEY   = "moonai_model";
const NEW_CHAT_TITLE = "Новый чат";
const DEFAULT_API_URL = "https://abad3v-moonai-backend-730m.hf.space";
const API_URL = ((import.meta.env.VITE_MOONAI_API_URL as string | undefined) ?? DEFAULT_API_URL).replace(/\/$/, "");

const suggestedPrompts = [
  "Объясни этот код простыми словами",
  "Составь план проекта на неделю",
  "Помоги улучшить промпт",
  "Напиши Python-скрипт для парсинга текста",
];

const backendLabels: Record<BackendStatus, { label: string; sidebar: string }> = {
  idle:       { label: "HF ready",   sidebar: "HF SPACE READY"   },
  connecting: { label: "HF waking",  sidebar: "HF SPACE WAKING"  },
  online:     { label: "HF online",  sidebar: "HF SPACE ONLINE"  },
  offline:    { label: "HF offline", sidebar: "HF SPACE OFFLINE" },
};

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as ChatSession[]) : [];
    return parsed.map(session => ({
      ...session,
      messages: session.messages.filter(m => m.id !== "welcome"),
    }));
  } catch { return []; }
}
function saveSessions(sessions: ChatSession[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch {}
}
function makeSession(id: string): ChatSession {
  return { id, title: NEW_CHAT_TITLE, lastActive: Date.now(), messages: [] };
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = loadSessions();
    return saved.length ? saved : [makeSession("default")];
  });
  const [activeId, setActiveId] = useState<string>(() => loadSessions()[0]?.id ?? "default");
  const [selectedModel, setSelectedModel] = useState<string>(() =>
    localStorage.getItem(MODEL_KEY) ?? MODELS[0].id
  );

  const activeSession = sessions.find(s => s.id === activeId) ?? sessions[0];
  const messages = activeSession?.messages ?? [];

  const [input, setInput] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth > 760);
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showDrop, setShowDrop] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("idle");
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) ?? "dark");
  const [userScrolled, setUserScrolled] = useState(false);
  const [sidebarOverlay, setSidebarOverlay] = useState(false);

  const scrollRef    = useRef<HTMLDivElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const abortRef     = useRef<AbortController | null>(null);
  const backendState = backendLabels[backendStatus];

  // Mobile sidebar overlay detection
  useEffect(() => {
    const check = () => setSidebarOverlay(window.innerWidth <= 760);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => { saveSessions(sessions); }, [sessions]);
  useEffect(() => { localStorage.setItem(THEME_KEY, theme); }, [theme]);
  useEffect(() => { localStorage.setItem(MODEL_KEY, selectedModel); }, [selectedModel]);

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(themes[theme]).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [theme]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setUserScrolled(el.scrollHeight - el.scrollTop - el.clientHeight > 80);
  }, []);

  useEffect(() => {
    if (!userScrolled && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isTyping, userScrolled]);

  const updateSession = useCallback((id: string, patch: Partial<ChatSession>) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }, []);
  const updateMessages = useCallback((id: string, msgs: Message[]) => {
    updateSession(id, { messages: msgs, lastActive: Date.now() });
  }, [updateSession]);

  const useSuggestion = useCallback((text: string) => {
    setInput(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const newChat = useCallback(() => {
    const id = Date.now().toString();
    setSessions(prev => [makeSession(id), ...prev]);
    setActiveId(id);
    if (sidebarOverlay) setIsSidebarOpen(false);
  }, [sidebarOverlay]);

  const deleteSession = useCallback((id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (next.length === 0) {
        const fresh = makeSession("default");
        setActiveId("default");
        return [fresh];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }, [activeId]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsTyping(false);
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isTyping) return;

    const sessionId = activeId;
    const model = MODELS.find(m => m.id === selectedModel) ?? MODELS[0];

    const userMsg: Message = {
      id: Date.now().toString(),
      text,
      sender: "user",
      timestamp: Date.now(),
      files: pendingFiles.length ? pendingFiles : undefined,
    };

    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const title = s.title === NEW_CHAT_TITLE
        ? (text.length > 30 ? text.slice(0, 30) + "…" : text)
        : s.title;
      return { ...s, title, messages: [...s.messages, userMsg], lastActive: Date.now() };
    }));

    setInput("");
    setPendingFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setUserScrolled(false);
    setIsTyping(true);

    const msgId = Date.now().toString() + "_bot";
    setSessions(prev => prev.map(s =>
      s.id === sessionId
        ? { ...s, messages: [...s.messages, { id: msgId, text: "", sender: "bot", timestamp: Date.now(), modelId: model.id }] }
        : s
    ));

    const abort = new AbortController();
    abortRef.current = abort;
    setBackendStatus("connecting");

    try {
      const res = await fetch(`${API_URL}${model.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, max_tokens: 200, temperature: 0.35 }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) throw new Error(`HTTP Error ${res.status}`);
      setBackendStatus("online");

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          let eventType = "token";
          let dataContent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataContent = line.slice(6).trim();
          }
          if (eventType === "done") break;
          if (eventType === "error") {
            const errObj = JSON.parse(dataContent);
            throw new Error(errObj.message || "Ошибка генерации на стороне бэкенда");
          }
          if (eventType === "token" && dataContent) {
            try {
              const cleanToken = JSON.parse(dataContent);
              setSessions(prev => prev.map(s =>
                s.id === sessionId
                  ? { ...s, messages: s.messages.map(m => m.id === msgId ? { ...m, text: m.text + cleanToken } : m) }
                  : s
              ));
            } catch (e) {
              console.warn("Token parse error:", e);
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setBackendStatus("idle");
        setSessions(prev => prev.map(s =>
          s.id === sessionId
            ? { ...s, messages: s.messages.map(m => m.id === msgId ? { ...m, text: m.text + " ◼" } : m) }
            : s
        ));
      } else {
        setBackendStatus("offline");
        const errMsg = err instanceof Error ? err.message : "Неизвестная ошибка сети";
        setSessions(prev => prev.map(s =>
          s.id === sessionId
            ? { ...s, messages: s.messages.map(m =>
                m.id === msgId
                  ? { ...m, text: `🔴 **Ошибка подключения к MoonAI Engine:** ${errMsg}` }
                  : m
              ) }
            : s
        ));
      }
    } finally {
      setIsTyping(false);
      abortRef.current = null;
    }
  }, [input, isTyping, activeId, pendingFiles, selectedModel]);

  const toggleVoice = useCallback(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) return;
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    const r = new SR() as ISpeechRecognition;
    r.lang = "ru-RU";
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e: ISpeechRecognitionEvent) => {
      const t = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join("");
      setInput(t);
    };
    r.onend = () => setIsListening(false);
    r.start();
    recognitionRef.current = r;
    setIsListening(true);
  }, [isListening]);

  const currentModel = MODELS.find(m => m.id === selectedModel) ?? MODELS[0];

  return (
    <>
      <style>{CSS}</style>
      <div className={`moon-app theme-${theme}`}>

        {/* Sidebar backdrop on mobile */}
        <AnimatePresence>
          {isSidebarOpen && sidebarOverlay && (
            <motion.div
              className="moon-sidebar-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* SIDEBAR */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.aside
              className="moon-sidebar"
              initial={{ x: -280, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -280, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
            >
              <div className="moon-sidebar-top">
                <div className="moon-sidebar-brand">
                  <div className="moon-sidebar-logo"><Sparkles size={14} /></div>
                  <span>MoonAI</span>
                </div>
                <button className="moon-new-chat" onClick={newChat}>
                  <Plus size={15} /> Новый чат
                </button>
              </div>

              <div className="moon-sessions">
                <p className="moon-sessions-label">История</p>
                {sessions.map(sess => (
                  <motion.div
                    key={sess.id}
                    className={`moon-session-item ${sess.id === activeId ? "active" : ""}`}
                    onClick={() => { setActiveId(sess.id); if (sidebarOverlay) setIsSidebarOpen(false); }}
                    whileHover={{ x: 3 }}
                    transition={{ duration: 0.12 }}
                  >
                    <ChevronRight size={11} className="moon-session-arrow" />
                    <span className="moon-session-title">{sess.title}</span>
                    <button
                      className="moon-session-del"
                      onClick={e => { e.stopPropagation(); deleteSession(sess.id); }}
                    >
                      <X size={11} />
                    </button>
                  </motion.div>
                ))}
              </div>

              <div className="moon-sidebar-foot">
                <div className={`moon-engine-status ${backendStatus}`}>
                  <div className="moon-engine-dot" />
                  <span>{backendState.sidebar}</span>
                </div>
                <span className="moon-version">v0.5.0</span>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* MAIN */}
        <div className="moon-main">

          {/* HEADER */}
          <header className="moon-header">
            <div className="moon-header-left">
              <button className="moon-icon-btn" onClick={() => setIsSidebarOpen(v => !v)} aria-label="Toggle sidebar">
                <PanelLeft size={19} />
              </button>
              <div className="moon-logo">
                <div className="moon-logo-icon"><Sparkles size={15} /></div>
                <span className="moon-logo-text">MoonAI</span>
              </div>
              {/* Active model badge in header */}
              <div className="moon-header-model-badge" style={{ "--chip-color": currentModel.color } as React.CSSProperties}>
                <span className="moon-header-model-dot" />
                <span>{currentModel.name} <em>{currentModel.tag}</em></span>
              </div>
            </div>
            <div className="moon-header-right">
              <ThemeToggle current={theme} onChange={setTheme} />
              <div className={`moon-live-badge ${backendStatus}`}>
                <div className="moon-live-dot" />
                <span className="moon-live-label">{backendState.label}</span>
              </div>
              <button
                className="moon-icon-btn danger"
                onClick={() => updateMessages(activeId, [])}
                title="Очистить чат"
              >
                <Trash2 size={17} />
              </button>
            </div>
          </header>

          {/* MESSAGES */}
          <main ref={scrollRef} className="moon-messages" onScroll={handleScroll}>
            <div className="moon-messages-inner">
              {messages.length === 0 && (
                <motion.section
                  className="moon-empty-state"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  <div className="moon-empty-glow" />
                  <div className="moon-empty-icon"><Sparkles size={24} /></div>
                  <h1>MoonAI готов</h1>
                  <p>Задай вопрос, попроси разобрать код или начни с одного из быстрых промптов.</p>
                  <div className="moon-suggestion-grid">
                    {suggestedPrompts.map((prompt) => (
                      <motion.button
                        key={prompt}
                        className="moon-suggestion"
                        onClick={() => useSuggestion(prompt)}
                        whileHover={{ y: -2, scale: 1.01 }}
                        whileTap={{ scale: 0.98 }}
                        transition={{ duration: 0.12 }}
                      >
                        {prompt}
                      </motion.button>
                    ))}
                  </div>
                  <div className={`moon-empty-status ${backendStatus}`}>
                    <span />{backendState.sidebar}
                  </div>
                </motion.section>
              )}

              <AnimatePresence initial={false}>
                {messages.map((msg) => {
                  const msgModel = MODELS.find(m => m.id === msg.modelId);
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 14, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                      className={`moon-msg-row ${msg.sender}`}
                    >
                      <div className={`moon-avatar ${msg.sender}`}>
                        {msg.sender === "user" ? <User size={15} /> : <Bot size={17} />}
                      </div>
                      <div className={`moon-bubble ${msg.sender}`}>
                        {msg.sender === "bot" && msgModel && (
                          <div className="moon-bubble-model-tag" style={{ "--chip-color": msgModel.color } as React.CSSProperties}>
                            <span className="moon-bubble-model-dot" />
                            {msgModel.name} <em>{msgModel.tag}</em>
                          </div>
                        )}
                        <SimpleMarkdown content={msg.text} />
                        {msg.files && (
                          <div className="moon-file-list">
                            {msg.files.map((f, i) => (
                              <div key={i} className="moon-file-chip"><FileText size={11} />{f.name}</div>
                            ))}
                          </div>
                        )}
                        {isTyping && msg.id === messages[messages.length - 1]?.id && msg.sender === "bot" && (
                          <TypingIndicator />
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {isTyping && messages[messages.length - 1]?.sender === "user" && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="moon-msg-row bot"
                >
                  <div className="moon-avatar bot"><Bot size={17} /></div>
                  <div className="moon-bubble bot"><TypingIndicator /></div>
                </motion.div>
              )}
            </div>

            <AnimatePresence>
              {userScrolled && (
                <motion.button
                  className="moon-scroll-btn"
                  initial={{ opacity: 0, scale: 0.8, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 8 }}
                  onClick={() => {
                    setUserScrolled(false);
                    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
                  }}
                >
                  <ChevronDown size={15} />
                  <span>Вниз</span>
                </motion.button>
              )}
            </AnimatePresence>
          </main>

          {/* FOOTER */}
          <footer className="moon-footer">
            <div className="moon-input-wrap">
              <AnimatePresence>
                {showDrop && (
                  <DropZone
                    onFiles={f => { setPendingFiles(f); setShowDrop(false); }}
                    onClose={() => setShowDrop(false)}
                  />
                )}
              </AnimatePresence>

              {pendingFiles.length > 0 && (
                <div className="moon-pending-files">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="moon-file-chip">
                      <FileText size={11} />{f.name}
                      <button onClick={() => setPendingFiles(p => p.filter((_, j) => j !== i))}>
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Model selector above input */}
              <ModelSelector selected={selectedModel} onChange={setSelectedModel} />

              <div className={`moon-input-box ${isListening ? "listening" : ""}`}>
                <button
                  className="moon-input-side-btn disabled"
                  disabled
                  title="Загрузка файлов пока не подключена"
                >
                  <Upload size={16} />
                </button>

                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={e => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  placeholder={`Напиши ${currentModel.name}…`}
                  className="moon-textarea"
                />

                <button
                  className={`moon-input-side-btn ${isListening ? "active-voice" : ""}`}
                  onClick={toggleVoice}
                  title="Голосовой ввод"
                >
                  {isListening ? <VoiceWave /> : <Mic size={16} />}
                </button>

                <button
                  className="moon-send-btn"
                  onClick={isTyping ? handleStop : handleSend}
                  disabled={!isTyping && !input.trim()}
                >
                  {isTyping
                    ? <CircleStop className="moon-stop-icon" />
                    : <Send className="moon-send-icon" size={21} />
                  }
                </button>
              </div>

              <p className="moon-footer-hint">Enter — отправить · Shift+Enter — новая строка</p>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --radius-sm: 10px;
    --radius-md: 16px;
    --radius-lg: 22px;
    --radius-xl: 28px;
    --transition: 0.18s ease;
    --font: 'Geist', system-ui, sans-serif;
    --font-mono: 'Geist Mono', 'Fira Code', monospace;
  }

  html, body, #root { height: 100%; overflow: hidden; }

  .moon-app {
    display: flex;
    height: 100vh;
    overflow: hidden;
    font-family: var(--font);
    background: var(--bg-base);
    color: var(--text-primary);
    transition: background 0.35s ease, color 0.35s ease;
  }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 8px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

  /* ── Sidebar backdrop ── */
  .moon-sidebar-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.45);
    backdrop-filter: blur(2px);
    z-index: 18;
  }

  /* ── Sidebar ── */
  .moon-sidebar {
    width: 265px;
    flex-shrink: 0;
    background: var(--glass-bg);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border-right: 1px solid var(--glass-border);
    display: flex;
    flex-direction: column;
    z-index: 20;
    overflow: hidden;
  }
  .moon-sidebar-top {
    padding: 16px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .moon-sidebar-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px;
  }
  .moon-sidebar-logo {
    width: 26px; height: 26px;
    border-radius: 8px;
    background: var(--accent-dim);
    border: 1px solid var(--accent);
    display: flex; align-items: center; justify-content: center;
    color: var(--accent);
    flex-shrink: 0;
  }
  .moon-sidebar-brand span {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.3px;
    color: var(--text-primary);
  }
  .moon-new-chat {
    display: flex; align-items: center; justify-content: center; gap: 7px;
    width: 100%;
    background: var(--accent);
    color: #fff;
    border: none; cursor: pointer;
    padding: 10px 16px;
    border-radius: var(--radius-sm);
    font-size: 13px; font-weight: 600;
    font-family: var(--font);
    transition: background var(--transition), transform 0.1s, box-shadow 0.2s;
    box-shadow: 0 4px 14px var(--accent-dim);
  }
  .moon-new-chat:hover { background: var(--accent-hover); box-shadow: 0 6px 20px var(--accent-dim); }
  .moon-new-chat:active { transform: scale(0.97); }

  .moon-sessions { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
  .moon-sessions-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--text-muted);
    padding: 12px 8px 7px;
  }
  .moon-session-item {
    display: flex; align-items: center; gap: 7px;
    padding: 8px 9px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    border: 1px solid transparent;
    transition: all var(--transition);
    position: relative;
  }
  .moon-session-item:hover { background: var(--accent-dim); border-color: var(--border); }
  .moon-session-item.active { background: var(--accent-dim); border-color: var(--accent); }
  .moon-session-arrow {
    color: var(--text-muted);
    flex-shrink: 0;
    transition: color var(--transition);
  }
  .moon-session-item.active .moon-session-arrow { color: var(--accent); }
  .moon-session-title {
    font-size: 13px; color: var(--text-secondary);
    flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .moon-session-item.active .moon-session-title { color: var(--text-primary); font-weight: 500; }
  .moon-session-del {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); opacity: 0;
    padding: 3px; border-radius: 5px;
    transition: opacity var(--transition), color var(--transition);
    display: flex; flex-shrink: 0;
  }
  .moon-session-item:hover .moon-session-del { opacity: 1; }
  .moon-session-del:hover { color: #f87171; }

  .moon-sidebar-foot {
    padding: 13px 16px;
    border-top: 1px solid var(--glass-border);
    display: flex; align-items: center; justify-content: space-between;
  }
  .moon-engine-status {
    display: flex; align-items: center; gap: 6px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--green); font-family: var(--font-mono);
  }
  .moon-engine-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--green); box-shadow: 0 0 7px var(--green);
    animation: pulse 2s infinite;
  }
  .moon-engine-status.connecting { color: #fbbf24; }
  .moon-engine-status.connecting .moon-engine-dot { background: #fbbf24; box-shadow: 0 0 7px #fbbf24; }
  .moon-engine-status.offline { color: #f87171; }
  .moon-engine-status.offline .moon-engine-dot { background: #f87171; box-shadow: 0 0 7px #f87171; }
  .moon-version { font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); }

  /* ── Main ── */
  .moon-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

  /* ── Header ── */
  .moon-header {
    height: 56px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 18px;
    background: var(--glass-bg);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border-bottom: 1px solid var(--glass-border);
    z-index: 10;
    gap: 10px;
  }
  .moon-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .moon-header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

  .moon-logo { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .moon-logo-icon {
    width: 30px; height: 30px; border-radius: 9px;
    background: var(--accent-dim); border: 1px solid var(--accent);
    display: flex; align-items: center; justify-content: center;
    color: var(--accent);
  }
  .moon-logo-text { font-size: 16px; font-weight: 700; letter-spacing: -0.4px; }

  /* Active model badge in header */
  .moon-header-model-badge {
    display: flex; align-items: center; gap: 5px;
    padding: 4px 10px;
    background: color-mix(in srgb, var(--chip-color, var(--accent)) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--chip-color, var(--accent)) 30%, transparent);
    border-radius: 999px;
    font-size: 11px; font-weight: 500;
    color: var(--chip-color, var(--accent));
    white-space: nowrap;
    overflow: hidden;
    max-width: 160px;
    text-overflow: ellipsis;
  }
  .moon-header-model-badge em { font-style: normal; opacity: 0.65; margin-left: 3px; }
  .moon-header-model-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--chip-color, var(--accent));
    flex-shrink: 0;
    animation: pulse 2s infinite;
  }

  .moon-icon-btn {
    background: none; border: none; cursor: pointer;
    color: var(--text-secondary); padding: 7px; border-radius: var(--radius-sm);
    display: flex; align-items: center; justify-content: center;
    transition: all var(--transition); flex-shrink: 0;
  }
  .moon-icon-btn:hover { background: var(--accent-dim); color: var(--text-primary); }
  .moon-icon-btn.danger:hover { color: #f87171; background: rgba(248,113,113,0.1); }

  .moon-live-badge {
    display: flex; align-items: center; gap: 5px;
    padding: 5px 11px;
    background: rgba(59,190,80,0.08);
    border: 1px solid rgba(59,190,80,0.2);
    border-radius: 999px;
    font-size: 11px; font-weight: 700;
    color: var(--green); letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .moon-live-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--green); box-shadow: 0 0 7px var(--green);
    animation: pulse 2s infinite; flex-shrink: 0;
  }
  .moon-live-badge.connecting { background: rgba(251,191,36,0.08); border-color: rgba(251,191,36,0.24); color: #fbbf24; }
  .moon-live-badge.connecting .moon-live-dot { background: #fbbf24; box-shadow: 0 0 7px #fbbf24; }
  .moon-live-badge.offline { background: rgba(248,113,113,0.08); border-color: rgba(248,113,113,0.24); color: #f87171; }
  .moon-live-badge.offline .moon-live-dot { background: #f87171; box-shadow: 0 0 7px #f87171; }

  /* ── Theme toggle ── */
  .moon-theme-toggle { position: relative; }
  .moon-theme-btn {
    display: flex; align-items: center; gap: 6px;
    background: var(--bg-elevated); border: 1px solid var(--border);
    color: var(--text-secondary); cursor: pointer;
    padding: 6px 10px; border-radius: var(--radius-sm);
    font-size: 12px; font-weight: 500; font-family: var(--font);
    transition: all var(--transition);
  }
  .moon-theme-btn:hover { border-color: var(--accent); color: var(--text-primary); }
  .moon-theme-dropdown {
    position: absolute; top: calc(100% + 7px); right: 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden; z-index: 50;
    box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    min-width: 135px;
  }
  .moon-theme-option {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 13px; width: 100%; text-align: left;
    background: none; border: none; cursor: pointer;
    color: var(--text-secondary); font-size: 13px; font-family: var(--font);
    transition: all var(--transition);
  }
  .moon-theme-option:hover { background: var(--accent-dim); color: var(--text-primary); }
  .moon-theme-option.active { color: var(--accent); font-weight: 600; }

  /* ── Messages ── */
  .moon-messages {
    flex: 1; overflow-y: auto; position: relative;
    padding: 28px 20px;
  }
  .moon-messages-inner {
    max-width: 780px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 22px;
    padding-bottom: 8px;
  }

  /* ── Empty state ── */
  .moon-empty-state {
    min-height: calc(100vh - 240px);
    display: flex; flex-direction: column;
    justify-content: center; align-items: center;
    text-align: center; gap: 16px;
    position: relative;
  }
  .moon-empty-glow {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -60%);
    width: 320px; height: 320px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--accent-dim) 0%, transparent 70%);
    pointer-events: none;
  }
  .moon-empty-icon {
    width: 52px; height: 52px; border-radius: 16px;
    display: flex; align-items: center; justify-content: center;
    color: var(--accent); background: var(--accent-dim);
    border: 1px solid var(--accent);
    box-shadow: 0 0 28px var(--accent-dim);
    position: relative;
  }
  .moon-empty-state h1 { font-size: 26px; font-weight: 700; color: var(--text-primary); }
  .moon-empty-state p {
    max-width: 520px; color: var(--text-secondary);
    font-size: 14.5px; line-height: 1.65;
  }
  .moon-suggestion-grid {
    width: min(100%, 620px);
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px; margin-top: 4px;
  }
  .moon-suggestion {
    min-height: 50px; text-align: left;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-size: 13px; font-weight: 500; font-family: var(--font);
    cursor: pointer; transition: all var(--transition);
    line-height: 1.4;
  }
  .moon-suggestion:hover {
    color: var(--text-primary); border-color: var(--accent);
    background: var(--accent-dim);
    box-shadow: 0 4px 16px var(--accent-dim);
  }
  .moon-empty-status {
    display: inline-flex; align-items: center; gap: 7px;
    color: var(--green); font-size: 11px; font-weight: 700;
    font-family: var(--font-mono); letter-spacing: 0.08em;
  }
  .moon-empty-status span {
    width: 6px; height: 6px; border-radius: 50%;
    background: currentColor; box-shadow: 0 0 7px currentColor;
  }
  .moon-empty-status.connecting { color: #fbbf24; }
  .moon-empty-status.offline { color: #f87171; }

  /* ── Messages ── */
  .moon-msg-row { display: flex; gap: 12px; align-items: flex-start; }
  .moon-msg-row.user { flex-direction: row-reverse; }

  .moon-avatar {
    width: 34px; height: 34px; border-radius: 11px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .moon-avatar.bot { background: var(--bg-elevated); border: 1px solid var(--border); color: var(--accent); }
  .moon-avatar.user { background: var(--user-bubble); color: #fff; }

  .moon-bubble {
    max-width: 78%;
    padding: 13px 17px;
    font-size: 14.5px; line-height: 1.65;
    border-radius: var(--radius-xl);
  }
  .moon-bubble.bot {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-top-left-radius: 5px;
    color: var(--text-primary);
  }
  .moon-bubble.user {
    background: var(--user-bubble);
    color: #fff;
    border-top-right-radius: 5px;
  }

  /* Model tag inside bubble */
  .moon-bubble-model-tag {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
    color: var(--chip-color, var(--accent));
    margin-bottom: 8px;
    opacity: 0.8;
  }
  .moon-bubble-model-tag em { font-style: normal; opacity: 0.65; }
  .moon-bubble-model-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--chip-color, var(--accent)); flex-shrink: 0;
  }

  /* ── Model selector ── */
  .moon-model-selector {
    display: flex; align-items: center; gap: 10px;
    padding: 0 4px 10px;
    flex-wrap: wrap;
  }
  .moon-model-label {
    font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--text-muted);
    white-space: nowrap;
  }
  .moon-model-chips {
    display: flex; gap: 6px; flex-wrap: wrap;
  }
  .moon-model-chip {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 12px; font-weight: 500;
    font-family: var(--font);
    cursor: pointer;
    transition: all 0.18s ease;
    white-space: nowrap;
  }
  .moon-model-chip:hover {
    border-color: var(--chip-color, var(--accent));
    color: var(--chip-color, var(--accent));
    background: color-mix(in srgb, var(--chip-color, var(--accent)) 8%, transparent);
  }
  .moon-model-chip.active {
    border-color: var(--chip-color, var(--accent));
    background: color-mix(in srgb, var(--chip-color, var(--accent)) 12%, transparent);
    color: var(--chip-color, var(--accent));
    font-weight: 600;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--chip-color, var(--accent)) 20%, transparent);
  }
  .moon-model-chip-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: currentColor; flex-shrink: 0;
    opacity: 0.7;
  }
  .moon-model-chip.active .moon-model-chip-dot { opacity: 1; animation: pulse 2s infinite; }
  .moon-model-chip-name { font-weight: 600; }
  .moon-model-chip-tag {
    font-size: 10px; opacity: 0.6; font-weight: 400;
    font-family: var(--font-mono);
  }

  /* ── Typing indicator ── */
  .moon-typing { display: flex; gap: 5px; padding: 4px 0; align-items: center; }
  .moon-typing span {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    background: var(--accent);
    animation: typing-bounce 1.2s infinite ease-in-out;
  }
  .moon-typing span:nth-child(1) { animation-delay: 0s; }
  .moon-typing span:nth-child(2) { animation-delay: 0.2s; }
  .moon-typing span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes typing-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
    30% { transform: translateY(-6px); opacity: 1; }
  }

  /* ── Scroll-to-bottom ── */
  .moon-scroll-btn {
    position: sticky; bottom: 6px;
    align-self: center;
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    height: 32px; padding: 0 12px 0 9px;
    background: var(--bg-elevated);
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 999px; cursor: pointer;
    transition: all var(--transition);
    box-shadow: 0 8px 24px rgba(0,0,0,0.25), 0 0 0 3px var(--accent-dim);
    z-index: 5; font-family: var(--font); font-size: 12px; font-weight: 700;
  }
  .moon-scroll-btn:hover { background: var(--accent); color: #fff; transform: translateY(-1px); }

  /* ── Footer ── */
  .moon-footer {
    padding: 14px 18px 18px;
    background: linear-gradient(to top, var(--bg-base) 65%, transparent);
    flex-shrink: 0;
  }
  .moon-input-wrap { max-width: 780px; margin: 0 auto; position: relative; }
  .moon-input-box {
    display: flex; align-items: flex-end; gap: 5px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    padding: 6px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .moon-input-box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-dim);
  }
  .moon-input-box.listening {
    border-color: #f87171;
    box-shadow: 0 0 0 3px rgba(248,113,113,0.15);
  }
  .moon-textarea {
    flex: 1; background: none; border: none; outline: none; resize: none;
    color: var(--text-primary); font-family: var(--font); font-size: 14px;
    line-height: 1.6; padding: 8px 6px;
    max-height: 200px; overflow-y: auto;
  }
  .moon-textarea::placeholder { color: var(--text-muted); }

  .moon-input-side-btn {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); padding: 8px;
    display: flex; align-items: center; justify-content: center;
    border-radius: var(--radius-sm); transition: all var(--transition);
    flex-shrink: 0; align-self: flex-end; margin-bottom: 1px;
  }
  .moon-input-side-btn:hover { color: var(--accent); background: var(--accent-dim); }
  .moon-input-side-btn.active-voice { color: #f87171; background: rgba(248,113,113,0.1); }
  .moon-input-side-btn.disabled,
  .moon-input-side-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .moon-input-side-btn.disabled:hover,
  .moon-input-side-btn:disabled:hover { color: var(--text-muted); background: none; }

  .moon-send-btn {
    width: 40px; height: 40px; border-radius: 50%;
    border: none; cursor: pointer; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, var(--accent), var(--accent-hover));
    color: #fff; align-self: flex-end;
    transition: transform var(--transition), filter var(--transition), box-shadow var(--transition);
    box-shadow: 0 8px 20px var(--accent-dim);
  }
  .moon-send-btn:hover:not(:disabled) {
    filter: brightness(1.1); transform: translateY(-1px) scale(1.04);
    box-shadow: 0 12px 26px var(--accent-dim);
  }
  .moon-send-btn:active:not(:disabled) { transform: scale(0.96); }
  .moon-send-btn:disabled {
    background: var(--bg-elevated); color: var(--text-muted);
    cursor: default; box-shadow: none; border: 1px solid var(--border);
  }
  .moon-send-icon {
    width: 21px; height: 21px; min-width: 21px;
    display: block; stroke-width: 2.6;
    transform: translateX(1px) translateY(-1px);
  }
  .moon-stop-icon { width: 18px; height: 18px; background: white; border-radius: 4px; }

  .moon-footer-hint {
    text-align: center; font-size: 11px;
    color: var(--text-muted); margin-top: 9px; letter-spacing: 0.03em;
  }

  /* ── Voice wave ── */
  .moon-wave { display: flex; gap: 2px; align-items: center; height: 18px; }
  .moon-wave span {
    display: block; width: 3px; border-radius: 3px;
    background: #f87171; height: 8px;
    animation: wave 0.8s ease-in-out infinite;
  }
  @keyframes wave {
    0%, 100% { height: 4px; }
    50% { height: 16px; }
  }

  /* ── Drop zone ── */
  .moon-dropzone-overlay {
    position: absolute; bottom: calc(100% + 10px); left: 0; right: 0;
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 16px; z-index: 30;
    box-shadow: 0 12px 40px rgba(0,0,0,0.25);
  }
  .moon-dropzone-close {
    position: absolute; top: 10px; right: 10px;
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); display: flex; border-radius: 6px; padding: 4px;
    transition: color var(--transition);
  }
  .moon-dropzone-close:hover { color: var(--text-primary); }
  .moon-dropzone-area {
    border: 2px dashed var(--border); border-radius: var(--radius-md);
    padding: 28px 20px; text-align: center; cursor: pointer; transition: all 0.2s;
  }
  .moon-dropzone-area.dragging { border-color: var(--accent); background: var(--accent-dim); }
  .moon-dropzone-icon { color: var(--text-muted); margin: 0 auto 10px; display: block; }
  .moon-dropzone-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .moon-dropzone-sub { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
  .moon-dropzone-files { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 12px; }

  /* ── File chips ── */
  .moon-file-chip {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--bg-elevated); border: 1px solid var(--border);
    border-radius: 6px; padding: 3px 9px;
    font-size: 11px; color: var(--text-secondary); font-family: var(--font-mono);
  }
  .moon-file-chip button {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); display: flex; padding: 0 0 0 4px;
    transition: color var(--transition);
  }
  .moon-file-chip button:hover { color: #f87171; }
  .moon-pending-files { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 4px 10px; }
  .moon-file-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }

  /* ── Code blocks ── */
  .moon-code-block {
    border-radius: var(--radius-md); overflow: hidden;
    border: 1px solid var(--border); margin: 8px 0;
    font-family: var(--font-mono);
  }
  .moon-code-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 7px 14px; background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
  }
  .moon-code-lang {
    font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--accent);
  }
  .moon-code-copy {
    display: flex; align-items: center; gap: 5px;
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); font-size: 11px; font-family: var(--font);
    padding: 3px 8px; border-radius: 6px; transition: all var(--transition);
  }
  .moon-code-copy:hover { color: var(--accent); background: var(--accent-dim); }
  .moon-code-pre {
    background: var(--bg-base); padding: 16px; overflow-x: auto;
    font-size: 13px; line-height: 1.65; color: var(--accent-hover);
  }

  /* ── Markdown ── */
  .moon-md { display: flex; flex-direction: column; gap: 2px; }
  .moon-h1 { font-size: 18px; font-weight: 700; color: var(--text-primary); margin: 10px 0 6px; }
  .moon-h2 { font-size: 15px; font-weight: 700; color: var(--text-primary); margin: 8px 0 4px; }
  .moon-h3 { font-size: 13px; font-weight: 700; color: var(--accent); margin: 6px 0 3px; }
  .moon-para { font-size: 14.5px; line-height: 1.65; color: inherit; }
  .moon-inline-code {
    background: var(--accent-dim); color: var(--accent);
    border-radius: 5px; padding: 1px 6px;
    font-family: var(--font-mono); font-size: 12.5px;
  }
  .moon-link { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; transition: color var(--transition); }
  .moon-link:hover { color: var(--accent-hover); }
  .moon-hr { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
  .moon-list { margin: 8px 0; padding: 0; list-style: none; }
  .moon-list-item {
    position: relative; font-size: 14.5px; line-height: 1.65;
    margin: 5px 0; padding-left: 20px; color: inherit;
  }
  .moon-list-item::before { content: "•"; position: absolute; left: 0; color: var(--accent); font-weight: 700; }
  .moon-olist { margin: 8px 0; padding: 0; list-style: none; counter-reset: moon-counter; }
  .moon-olist-item {
    position: relative; counter-increment: moon-counter;
    font-size: 14.5px; line-height: 1.65; margin: 5px 0; padding-left: 28px; color: inherit;
  }
  .moon-olist-item::before {
    content: counter(moon-counter) "."; position: absolute; left: 0; top: 0;
    min-width: 20px; color: var(--accent); font-weight: 700;
  }
  .moon-md-spacer { height: 7px; }
  .moon-table {
    display: block; width: 100%; overflow-x: auto;
    border: 1px solid var(--border); border-radius: var(--radius-sm); margin: 8px 0;
  }
  .moon-table-row { display: flex; border-bottom: 1px solid var(--border); }
  .moon-table-row:last-child { border-bottom: none; }
  .moon-table-row.head { background: var(--bg-elevated); font-weight: 700; }
  .moon-table-cell {
    flex: 1; padding: 6px 10px; font-size: 13px;
    color: var(--text-secondary); border-right: 1px solid var(--border);
  }
  .moon-table-cell:last-child { border-right: none; }

  /* ── Animations ── */
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Mobile ── */
  @media (max-width: 760px) {
    .moon-app { position: relative; }
    .moon-sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      width: min(80vw, 270px);
      box-shadow: 20px 0 50px rgba(0,0,0,0.35);
      z-index: 22;
    }
    .moon-main { width: 100%; }
    .moon-header { height: 52px; padding: 0 12px; gap: 7px; }
    .moon-header-left { gap: 7px; min-width: 0; }
    .moon-header-right { gap: 6px; }
    .moon-logo-text { font-size: 15px; }
    .moon-header-model-badge { max-width: 100px; font-size: 10px; padding: 3px 8px; }
    .moon-theme-btn { width: 34px; height: 34px; padding: 0; justify-content: center; }
    .moon-theme-btn span, .moon-theme-btn svg:last-child { display: none; }
    .moon-live-badge { padding: 6px 8px; }
    .moon-live-label { display: none; }
    .moon-messages { padding: 16px 12px; }
    .moon-messages-inner { max-width: none; gap: 16px; }
    .moon-empty-state { min-height: calc(100vh - 210px); gap: 13px; }
    .moon-empty-state h1 { font-size: 22px; }
    .moon-empty-state p { font-size: 13.5px; }
    .moon-empty-glow { width: 220px; height: 220px; }
    .moon-suggestion-grid { grid-template-columns: 1fr; gap: 7px; }
    .moon-msg-row { gap: 9px; }
    .moon-avatar { width: 30px; height: 30px; border-radius: 9px; }
    .moon-bubble {
      max-width: calc(100% - 39px);
      padding: 11px 13px;
      font-size: 14px;
      border-radius: 16px;
    }
    .moon-footer { padding: 10px 12px 14px; }
    .moon-input-box { border-radius: 18px; padding: 5px; }
    .moon-send-btn { width: 38px; height: 38px; }
    .moon-send-icon { width: 19px; height: 19px; min-width: 19px; }
    .moon-stop-icon { width: 16px; height: 16px; }
    .moon-scroll-btn { height: 30px; padding: 0 10px; font-size: 11px; }
    .moon-footer-hint { display: none; }
    .moon-model-selector { gap: 7px; padding-bottom: 8px; }
    .moon-model-chip { padding: 4px 10px; font-size: 11px; }
    .moon-model-chip-tag { display: none; }
  }

  /* Safe area for notched phones */
  @supports (padding-bottom: env(safe-area-inset-bottom)) {
    .moon-footer {
      padding-bottom: max(18px, env(safe-area-inset-bottom));
    }
  }
`;