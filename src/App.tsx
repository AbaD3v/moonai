import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Bot, User, Sparkles, PanelLeft, Plus, Trash2,
  Copy, Check, Mic, Sun, Moon, Zap, Upload,
  FileText, X, ChevronDown, CircleStop
} from "lucide-react";

// SpeechRecognition types (not always present in lib.dom.d.ts)
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



type Theme = "dark" | "light" | "midnight";
type BackendStatus = "idle" | "connecting" | "online" | "offline";

interface Message {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp: number;
  files?: UploadedFile[];
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  lastActive: number;
}

interface UploadedFile {
  name: string;
  size: number;
  type: string;
}

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
    "--glass-bg":      "rgba(22,27,34,0.75)",
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
    "--glass-bg":      "rgba(11,15,26,0.8)",
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
    "--glass-bg":      "rgba(255,255,255,0.8)",
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
        <button className="moon-code-copy" onClick={handleCopy} title="Копировать">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? "Скопировано" : "Копировать"}</span>
        </button>
      </div>
      <pre className="moon-code-pre">
        <code>{value}</code>
      </pre>
    </div>
  );
}

function SimpleMarkdown({ content }: { content: string }) {
  const parts = useMemo(() => {
    // Поддерживает ```python, ```tsx id="...", ```bash и другие fence-заголовки,
    // а также [code=lang]...[/code] и [code]...[/code]
    const codeRe = /```([^\n`]*)\n([\s\S]*?)```|\[code(?:=([^\]]*))?]([\s\S]*?)\[\/code\]/g;
    const out: Array<{ type: "text" | "code"; value: string; lang?: string }> = [];
    let last = 0;
    let m: RegExpExecArray | null;

    while ((m = codeRe.exec(content)) !== null) {
      if (m.index > last) {
        out.push({ type: "text", value: content.slice(last, m.index) });
      }

      let lang: string;
      let value: string;

      if (m[0].startsWith("```")) {
        // ```lang\n...\n```
        const rawLang = (m[1] || "text").trim();
        lang = rawLang.split(/\s+/)[0] || "text";
        value = m[2].trim();
      } else if (m[0].startsWith("[code")) {
        // [code] или [code=python]
        lang = (m[3] || "text").trim() || "text";
        value = m[4].trim();
      } else {
        // Fallback for other patterns
        lang = "text";
        value = "";
      }

      out.push({ type: "code", lang, value });
      last = codeRe.lastIndex;
    }

    if (last < content.length) {
      out.push({ type: "text", value: content.slice(last) });
    }

    return out;
  }, [content]);

  const formatInline = useCallback((text: string) => {
    const safe = escapeHtml(text);
    return safe
      // Markdown bold **text** и BB-code [b]text[/b]
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[b\](.*?)\[\/b\]/gi, "<strong>$1</strong>")
      // Markdown italic *text* / _text_ и BB-code [i]
      .replace(/(?<!\*)\*((?!\*)[^\*\n]+?)\*(?!\*)/g, "<em>$1</em>")
      .replace(/_((?!_)[^_\n]+?)_/g, "<em>$1</em>")
      .replace(/\[i\](.*?)\[\/i\]/gi, "<em>$1</em>")
      // Strikethrough [s]text[/s]
      .replace(/\[s\](.*?)\[\/s\]/gi, "<del>$1</del>")
      // Underline [u]text[/u]
      .replace(/\[u\](.*?)\[\/u\]/gi, '<u>$1</u>')
      // Inline code: backtick и [code] без переносов строк
      .replace(/`([^`\n]+)`/g, '<code class="moon-inline-code">$1</code>')
      .replace(/\[code\](.*?)\[\/code\]/gi, '<code class="moon-inline-code">$1</code>')
      // BB-code [color=red]text[/color]
      .replace(/\[color=([^\]]+)\](.*?)\[\/color\]/gi, '<span style="color: $1">$2</span>')
      // BB-code [url=...]text[/url] и [url]...[/url]
      .replace(/\[url=([^\]]+)\](.*?)\[\/url\]/gi, '<a class="moon-link" href="$1" target="_blank" rel="noopener noreferrer">$2</a>')
      .replace(/\[url\](.*?)\[\/url\]/gi, '<a class="moon-link" href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }, []);

  const isTableSeparator = (line: string) =>
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

  const isTableLine = (line: string) => {
    if (!line.includes("|")) return false;
    const cells = line.split("|").filter(Boolean).map((c) => c.trim());
    return cells.length > 1;
  };

  const parseTableCells = (line: string) =>
    line.split("|").filter(Boolean).map((c) => c.trim());

  const renderTable = (rows: string[], key: string) => {
    const cleanRows = rows.filter((row) => !isTableSeparator(row));

    if (cleanRows.length === 0) return null;

    return (
      <div key={key} className="moon-table">
        {cleanRows.map((row, i) => {
          const cells = parseTableCells(row);
          return (
            <div key={i} className={`moon-table-row ${i === 0 ? "head" : ""}`}>
              {cells.map((cell, j) => (
                <span
                  key={j}
                  className="moon-table-cell"
                  dangerouslySetInnerHTML={{ __html: formatInline(cell) }}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  const renderLine = (line: string, i: number) => {
    const rawLine = line.trim();

    if (!rawLine) {
      return <div key={i} className="moon-md-spacer" />;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      return <hr key={i} className="moon-hr" />;
    }

    const hMatch = rawLine.match(/^(?:\*\*)?(#{1,3})\s+(.+?)(?:\*\*)?$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const text = hMatch[2].replace(/^\*\*/, "").replace(/\*\*$/, "").trim();
      const Tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      const cls = level === 1 ? "moon-h1" : level === 2 ? "moon-h2" : "moon-h3";

      return (
        <Tag
          key={i}
          className={cls}
          dangerouslySetInnerHTML={{ __html: formatInline(text) }}
        />
      );
    }

    const html = formatInline(line);
    return (
      <p key={i} className="moon-para" dangerouslySetInnerHTML={{ __html: html || "&nbsp;" }} />
    );
  };

  const renderLines = (lines: string[]) => {
    const nodes: React.ReactNode[] = [];
    let bulletItems: string[] = [];
    let orderedItems: string[] = [];
    let tableRows: string[] = [];

    const flushBullets = () => {
      if (bulletItems.length === 0) return;

      nodes.push(
        <ul key={`ul-${nodes.length}`} className="moon-list">
          {bulletItems.map((item, idx) => (
            <li
              key={idx}
              className="moon-list-item"
              dangerouslySetInnerHTML={{ __html: formatInline(item) }}
            />
          ))}
        </ul>
      );

      bulletItems = [];
    };

    const flushOrdered = () => {
      if (orderedItems.length === 0) return;

      nodes.push(
        <ol key={`ol-${nodes.length}`} className="moon-olist">
          {orderedItems.map((item, idx) => (
            <li
              key={idx}
              className="moon-olist-item"
              dangerouslySetInnerHTML={{ __html: formatInline(item) }}
            />
          ))}
        </ol>
      );

      orderedItems = [];
    };

    const flushTable = () => {
      if (tableRows.length === 0) return;
      nodes.push(renderTable(tableRows, `table-${nodes.length}`));
      tableRows = [];
    };

    const flushAll = () => {
      flushTable();
      flushBullets();
      flushOrdered();
    };

    lines.forEach((line, i) => {
      const bulletMatch = line.match(/^[-*+]\s+(.*)/);
      const orderedMatch = line.match(/^\d+\.\s+(.*)/);

      if (isTableLine(line) || isTableSeparator(line)) {
        flushBullets();
        flushOrdered();
        tableRows.push(line);
        return;
      }

      if (bulletMatch) {
        flushTable();
        flushOrdered();
        bulletItems.push(bulletMatch[1]);
        return;
      }

      if (orderedMatch) {
        flushTable();
        flushBullets();
        orderedItems.push(orderedMatch[1]);
        return;
      }

      flushAll();
      nodes.push(renderLine(line, i));
    });

    flushAll();

    return nodes;
  };

  return (
    <div className="moon-md">
      {parts.map((part, i) =>
        part.type === "code" ? (
          <CodeBlock key={i} lang={part.lang!} value={part.value} />
        ) : (
          <div key={i}>{renderLines(part.value.split("\n"))}</div>
        )
      )}
    </div>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="moon-typing">
      <span />
      <span />
      <span />
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

// ─── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({
  onFiles,
  onClose,
}: {
  onFiles: (files: UploadedFile[]) => void;
  onClose: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<UploadedFile[]>([]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type,
    }));
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
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <Upload size={32} className="moon-dropzone-icon" />
        <p className="moon-dropzone-title">Перетащи файлы сюда</p>
        <p className="moon-dropzone-sub">или нажми, чтобы выбрать</p>
        {dropped.length > 0 && (
          <div className="moon-dropzone-files">
            {dropped.map((f, i) => (
              <div key={i} className="moon-file-chip">
                <FileText size={12} />
                <span>{f.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
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
        <ChevronDown size={12} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="moon-theme-dropdown"
          >
            {options.map(o => (
              <button
                key={o.id}
                className={`moon-theme-option ${current === o.id ? "active" : ""}`}
                onClick={() => { onChange(o.id); setOpen(false); }}
              >
                {o.icon}
                <span>{o.label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const STORAGE_KEY = "moonai_sessions";
const THEME_KEY   = "moonai_theme";
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
  idle: { label: "HF ready", sidebar: "HF SPACE READY" },
  connecting: { label: "HF waking", sidebar: "HF SPACE WAKING" },
  online: { label: "HF online", sidebar: "HF SPACE ONLINE" },
  offline: { label: "HF offline", sidebar: "HF SPACE OFFLINE" },
};

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as ChatSession[]) : [];
    return parsed.map((session) => ({
      ...session,
      messages: session.messages.filter((message) => message.id !== "welcome"),
    }));
  } catch { return []; }
}

function saveSessions(sessions: ChatSession[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch {}
}

function makeSession(id: string): ChatSession {
  return {
    id,
    title: NEW_CHAT_TITLE,
    lastActive: Date.now(),
    messages: [],
  };
}

// ─── Notifications ────────────────────────────────────────────────────────────
// Uses Web Notifications API (works in Tauri WebView natively).
// If @tauri-apps/plugin-notification is installed later, swap this out.
/*async function sendAppNotification(title: string, body: string) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    } else if (Notification.permission !== "denied") {
      const perm = await Notification.requestPermission();
      if (perm === "granted") new Notification(title, { body });
    }
  } catch {
    // Silently fail in environments that block notifications
  }
}*/

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  // Sessions & messages
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = loadSessions();
    return saved.length ? saved : [makeSession("default")];
  });
  const [activeId, setActiveId] = useState<string>(() => loadSessions()[0]?.id ?? "default");

  const activeSession = sessions.find(s => s.id === activeId) ?? sessions[0];
  const messages = activeSession?.messages ?? [];

  // UI state
  const [input, setInput] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth > 760);
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showDrop, setShowDrop] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("idle");
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem(THEME_KEY) as Theme) ?? "dark";
  });
  const [userScrolled, setUserScrolled] = useState(false);

  const scrollRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const backendState = backendLabels[backendStatus];

  // Persist
  useEffect(() => { saveSessions(sessions); }, [sessions]);
  useEffect(() => { localStorage.setItem(THEME_KEY, theme); }, [theme]);

  // Apply CSS variables
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(themes[theme]).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [theme]);

  // Smart autoscroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setUserScrolled(!atBottom);
  }, []);

  useEffect(() => {
    if (!userScrolled && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isTyping, userScrolled]);

  // Update session helper
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

  // New chat
  const newChat = useCallback(() => {
    const id = Date.now().toString();
    const sess = makeSession(id);
    setSessions(prev => [sess, ...prev]);
    setActiveId(id);
  }, []);

  // Delete session
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

  // Abort controller ref for cancelling in-flight requests
  const abortRef = useRef<AbortController | null>(null);

  // Stop generation
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsTyping(false);
  }, []);

  // Real SSE streaming
  // Реальный асинхронный стриминг через SSE
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isTyping) return;

    const sessionId = activeId;
    const userMsg: Message = {
      id: Date.now().toString(),
      text,
      sender: "user",
      timestamp: Date.now(),
      files: pendingFiles.length ? pendingFiles : undefined,
    };

    // 1. Добавляем сообщение юзера и сбрасываем инпут
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const title = s.title === NEW_CHAT_TITLE ? (text.length > 30 ? text.slice(0, 30) + "..." : text) : s.title;
      return { ...s, title, messages: [...s.messages, userMsg], lastActive: Date.now() };
    }));

    setInput("");
    setPendingFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setUserScrolled(false);
    setIsTyping(true);

    // 2. Создаем пустой контейнер под ответ MoonAI 700M
    const msgId = Date.now().toString() + "_bot";
    setSessions(prev => prev.map(s =>
      s.id === sessionId
        ? { ...s, messages: [...s.messages, { id: msgId, text: "", sender: "bot", timestamp: Date.now() }], lastActive: Date.now() }
        : s
    ));

    const abort = new AbortController();
    abortRef.current = abort;
    setBackendStatus("connecting");

    try {
      // Шлем запрос на наш FastAPI /chat эндпоинт
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, max_tokens: 500, temperature: 0.7 }), // Передаем параметры инференса
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

        // Декодируем прилетевший чанк и складываем в буфер
        buffer += decoder.decode(value, { stream: true });
        
        // SSE пакеты разделяются двумя переносами строк (\n\n)
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? ""; // Хвост оставляем в буфере

        for (const part of parts) {
          const lines = part.split("\n");
          let eventType = "token";
          let dataContent = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataContent = line.slice(6).trim();
            }
          }

          if (eventType === "done") {
            break;
          }

          if (eventType === "error") {
            const errObj = JSON.parse(dataContent);
            throw new Error(errObj.message || "Ошибка генерации на стороне бэкенда");
          }

          if (eventType === "token" && dataContent) {
            try {
              // Наш FastAPI бэкенд оборачивает токен в json.dumps(), поэтому снимаем кавычки через JSON.parse
              const cleanToken = JSON.parse(dataContent);
              
              setSessions(prev => prev.map(s =>
                s.id === sessionId
                  ? {
                      ...s,
                      messages: s.messages.map(m =>
                        m.id === msgId ? { ...m, text: m.text + cleanToken } : m
                      ),
                    }
                  : s
              ));
            } catch (e) {
              // Если прилетел сырой управляющий символ — просто берем как текст
              console.warn("Ошибка парсинга токена:", e);
            }
          }
        }
      }

    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setBackendStatus("idle");
        // Если юзер нажал на кнопку Стоп — аккуратно завершаем строку
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
            ? {
                ...s,
                messages: s.messages.map(m =>
                  m.id === msgId
                    ? { ...m, text: `🔴 **Ошибка подключения к MoonAI Engine:** ${errMsg}. Убедись, что бэкенд запущен.` }
                    : m
                ),
              }
            : s
        ));
      }
    } finally {
      setIsTyping(false);
      abortRef.current = null;
    }
  }, [input, isTyping, activeId, pendingFiles]);

  // Voice
  const toggleVoice = useCallback(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
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

  return (
    <>
      <style>{CSS}</style>
      <div className={`moon-app theme-${theme}`}>

        {/* SIDEBAR */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.aside
              className="moon-sidebar"
              initial={{ x: -280, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -280, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              <div className="moon-sidebar-top">
                <button className="moon-new-chat" onClick={newChat}>
                  <Plus size={16} /> Новый чат
                </button>
              </div>

              <div className="moon-sessions">
                <p className="moon-sessions-label">История</p>
                {sessions.map(sess => (
                  <motion.div
                    key={sess.id}
                    className={`moon-session-item ${sess.id === activeId ? "active" : ""}`}
                    onClick={() => setActiveId(sess.id)}
                    whileHover={{ x: 2 }}
                  >
                    <span className="moon-session-dot" />
                    <span className="moon-session-title">{sess.title}</span>
                    <button
                      className="moon-session-del"
                      onClick={(e) => { e.stopPropagation(); deleteSession(sess.id); }}
                    >
                      <X size={12} />
                    </button>
                  </motion.div>
                ))}
              </div>

              <div className="moon-sidebar-foot">
                <div className={`moon-engine-status ${backendStatus}`}>
                  <div className="moon-engine-dot" />
                  <span>{backendState.sidebar}</span>
                </div>
                <span className="moon-version">v0.4.0</span>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* MAIN */}
        <div className="moon-main">

          {/* HEADER */}
          <header className="moon-header">
            <div className="moon-header-left">
              <button className="moon-icon-btn" onClick={() => setIsSidebarOpen(v => !v)}>
                <PanelLeft size={20} />
              </button>
              <div className="moon-logo">
                <div className="moon-logo-icon"><Sparkles size={16} /></div>
                <span className="moon-logo-text">MoonAI</span>
              </div>
            </div>
            <div className="moon-header-right">
              <ThemeToggle current={theme} onChange={setTheme} />
              <div className={`moon-live-badge ${backendStatus}`}>
                <div className="moon-live-dot" />
                <span>{backendState.label}</span>
              </div>
              <button
                className="moon-icon-btn danger"
                onClick={() => updateMessages(activeId, [])}
                title="Очистить чат"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </header>

          {/* MESSAGES */}
          <main ref={scrollRef} className="moon-messages" onScroll={handleScroll}>
            <div className="moon-messages-inner">
              {messages.length === 0 && (
                <motion.section
                  className="moon-empty-state"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="moon-empty-icon"><Sparkles size={22} /></div>
                  <h1>MoonAI готов</h1>
                  <p>Задай вопрос, попроси разобрать код или начни с одного из быстрых промптов.</p>
                  <div className="moon-suggestion-grid">
                    {suggestedPrompts.map((prompt) => (
                      <button key={prompt} className="moon-suggestion" onClick={() => useSuggestion(prompt)}>
                        {prompt}
                      </button>
                    ))}
                  </div>
                  <div className={`moon-empty-status ${backendStatus}`}>
                    <span />
                    {backendState.sidebar}
                  </div>
                </motion.section>
              )}

              <AnimatePresence initial={false}>
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className={`moon-msg-row ${msg.sender}`}
                  >
                    <div className={`moon-avatar ${msg.sender}`}>
                      {msg.sender === "user" ? <User size={16} /> : <Bot size={18} />}
                    </div>
                    <div className={`moon-bubble ${msg.sender}`}>
                      <SimpleMarkdown content={msg.text} />
                      {msg.files && (
                        <div className="moon-file-list">
                          {msg.files.map((f, i) => (
                            <div key={i} className="moon-file-chip">
                              <FileText size={11} />{f.name}
                            </div>
                          ))}
                        </div>
                      )}
                      {isTyping &&
                        msg.id === messages[messages.length - 1]?.id &&
                        msg.sender === "bot" && (
                          <TypingIndicator />
                        )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {isTyping && messages[messages.length - 1]?.sender === "user" && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="moon-msg-row bot"
                >
                  <div className="moon-avatar bot"><Bot size={18} /></div>
                  <div className="moon-bubble bot">
                    <TypingIndicator />
                  </div>
                </motion.div>
              )}
            </div>

            {/* Scroll-to-bottom button */}
            <AnimatePresence>
              {userScrolled && (
                <motion.button
                  className="moon-scroll-btn"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => {
                    setUserScrolled(false);
                    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
                  }}
                >
                  <ChevronDown size={16} />
                  <span>Вниз</span>
                </motion.button>
              )}
            </AnimatePresence>
          </main>

          {/* INPUT */}
          <footer className="moon-footer">
            <div className="moon-input-wrap">

              {/* Drop zone */}
              <AnimatePresence>
                {showDrop && (
                  <DropZone
                    onFiles={(f) => { setPendingFiles(f); setShowDrop(false); }}
                    onClose={() => setShowDrop(false)}
                  />
                )}
              </AnimatePresence>

              {/* Pending files */}
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

              <div className={`moon-input-box ${isListening ? "listening" : ""}`}>
                {/* Upload button */}
                <button
                  className="moon-input-side-btn disabled"
                  disabled
                  title="Загрузка файлов в HF Space пока не подключена"
                >
                  <Upload size={17} />
                </button>

                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  placeholder="Напиши MoonAI..."
                  className="moon-textarea"
                />

                {/* Voice button */}
                <button
                  className={`moon-input-side-btn ${isListening ? "active-voice" : ""}`}
                  onClick={toggleVoice}
                  title="Голосовой ввод"
                >
                  {isListening ? <VoiceWave /> : <Mic size={17} />}
                </button>

                {/* Send / Stop button */}
                <button
                  className="moon-send-btn"
                  onClick={isTyping ? handleStop : handleSend}
                  disabled={!isTyping && !input.trim()}
                >
                  {isTyping
                    ? <CircleStop className="moon-stop-icon" />
                    : <Send className="moon-send-icon" size={23} />
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
    transition: background 0.3s ease, color 0.3s ease;
  }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 8px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

  /* ── Sidebar ── */
  .moon-sidebar {
    width: 270px;
    flex-shrink: 0;
    background: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border-right: 1px solid var(--glass-border);
    display: flex;
    flex-direction: column;
    z-index: 20;
  }
  .moon-sidebar-top { padding: 18px 16px 12px; }
  .moon-new-chat {
    display: flex; align-items: center; gap: 8px;
    width: 100%;
    background: var(--accent);
    color: #fff;
    border: none; cursor: pointer;
    padding: 11px 16px;
    border-radius: var(--radius-md);
    font-size: 13px; font-weight: 600;
    font-family: var(--font);
    transition: background var(--transition), transform 0.1s;
  }
  .moon-new-chat:hover { background: var(--accent-hover); }
  .moon-new-chat:active { transform: scale(0.97); }

  .moon-sessions { flex: 1; overflow-y: auto; padding: 0 10px 8px; }
  .moon-sessions-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--text-muted);
    padding: 12px 8px 8px;
  }
  .moon-session-item {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    border: 1px solid transparent;
    transition: all var(--transition);
    position: relative;
  }
  .moon-session-item:hover { background: var(--accent-dim); border-color: var(--border); }
  .moon-session-item.active { background: var(--accent-dim); border-color: var(--accent); }
  .moon-session-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--text-muted); flex-shrink: 0;
  }
  .moon-session-item.active .moon-session-dot { background: var(--accent); }
  .moon-session-title {
    font-size: 13px; color: var(--text-secondary);
    flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .moon-session-item.active .moon-session-title { color: var(--text-primary); }
  .moon-session-del {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); opacity: 0;
    padding: 2px; border-radius: 4px;
    transition: opacity var(--transition), color var(--transition);
    display: flex;
  }
  .moon-session-item:hover .moon-session-del { opacity: 1; }
  .moon-session-del:hover { color: #f87171; }

  .moon-sidebar-foot {
    padding: 14px 18px;
    border-top: 1px solid var(--glass-border);
    background: var(--glass-bg);
    display: flex; align-items: center; justify-content: space-between;
  }
  .moon-engine-status {
    display: flex; align-items: center; gap: 7px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--green); font-family: var(--font-mono);
  }
  .moon-engine-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 8px var(--green);
    animation: pulse 2s infinite;
  }
  .moon-engine-status.connecting,
  .moon-live-badge.connecting {
    color: #fbbf24;
  }
  .moon-engine-status.connecting .moon-engine-dot,
  .moon-live-badge.connecting .moon-live-dot {
    background: #fbbf24;
    box-shadow: 0 0 8px #fbbf24;
  }
  .moon-engine-status.offline,
  .moon-live-badge.offline {
    color: #f87171;
  }
  .moon-engine-status.offline .moon-engine-dot,
  .moon-live-badge.offline .moon-live-dot {
    background: #f87171;
    box-shadow: 0 0 8px #f87171;
  }
  .moon-version { font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); }

  /* ── Main ── */
  .moon-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

  /* ── Header ── */
  .moon-header {
    height: 58px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 20px;
    background: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border-bottom: 1px solid var(--glass-border);
    z-index: 10;
  }
  .moon-header-left, .moon-header-right {
    display: flex; align-items: center; gap: 10px;
  }
  .moon-logo { display: flex; align-items: center; gap: 9px; }
  .moon-logo-icon {
    width: 32px; height: 32px; border-radius: 10px;
    background: var(--accent-dim); border: 1px solid var(--accent);
    display: flex; align-items: center; justify-content: center;
    color: var(--accent);
  }
  .moon-logo-text { font-size: 17px; font-weight: 700; letter-spacing: -0.5px; }
  .moon-icon-btn {
    background: none; border: none; cursor: pointer;
    color: var(--text-secondary); padding: 7px; border-radius: var(--radius-sm);
    display: flex; align-items: center; justify-content: center;
    transition: all var(--transition);
  }
  .moon-icon-btn:hover { background: var(--accent-dim); color: var(--text-primary); }
  .moon-icon-btn.danger:hover { color: #f87171; background: rgba(248,113,113,0.1); }
  .moon-live-badge {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 12px;
    background: rgba(59,190,80,0.08);
    border: 1px solid rgba(59,190,80,0.2);
    border-radius: 999px;
    font-size: 11px; font-weight: 700;
    color: var(--green); letter-spacing: 0.05em;
  }
  .moon-live-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--green); box-shadow: 0 0 8px var(--green);
    animation: pulse 2s infinite;
  }
  .moon-live-badge.connecting {
    background: rgba(251,191,36,0.08);
    border-color: rgba(251,191,36,0.24);
  }
  .moon-live-badge.offline {
    background: rgba(248,113,113,0.08);
    border-color: rgba(248,113,113,0.24);
  }

  /* ── Theme toggle ── */
  .moon-theme-toggle { position: relative; }
  .moon-theme-btn {
    display: flex; align-items: center; gap: 6px;
    background: var(--bg-elevated); border: 1px solid var(--border);
    color: var(--text-secondary); cursor: pointer;
    padding: 6px 11px; border-radius: var(--radius-sm);
    font-size: 12px; font-weight: 500; font-family: var(--font);
    transition: all var(--transition);
  }
  .moon-theme-btn:hover { border-color: var(--accent); color: var(--text-primary); }
  .moon-theme-dropdown {
    position: absolute; top: calc(100% + 8px); right: 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden; z-index: 50;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    min-width: 130px;
  }
  .moon-theme-option {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px; width: 100%; text-align: left;
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
    max-width: 800px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 24px;
    padding-bottom: 8px;
  }
  .moon-empty-state {
    min-height: calc(100vh - 240px);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    gap: 16px;
  }
  .moon-empty-icon {
    width: 48px; height: 48px; border-radius: 16px;
    display: flex; align-items: center; justify-content: center;
    color: var(--accent);
    background: var(--accent-dim);
    border: 1px solid var(--accent);
  }
  .moon-empty-state h1 {
    font-size: 28px;
    line-height: 1.15;
    font-weight: 700;
    color: var(--text-primary);
  }
  .moon-empty-state p {
    max-width: 540px;
    color: var(--text-secondary);
    font-size: 15px;
    line-height: 1.6;
  }
  .moon-suggestion-grid {
    width: min(100%, 640px);
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 6px;
  }
  .moon-suggestion {
    min-height: 48px;
    text-align: left;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    font-family: var(--font);
    cursor: pointer;
    transition: all var(--transition);
  }
  .moon-suggestion:hover {
    color: var(--text-primary);
    border-color: var(--accent);
    background: var(--accent-dim);
    transform: translateY(-1px);
  }
  .moon-empty-status {
    display: inline-flex; align-items: center; gap: 8px;
    color: var(--green);
    font-size: 11px;
    font-weight: 700;
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
  }
  .moon-empty-status span {
    width: 7px; height: 7px; border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 8px currentColor;
  }
  .moon-empty-status.connecting { color: #fbbf24; }
  .moon-empty-status.offline { color: #f87171; }
  .moon-msg-row {
    display: flex; gap: 14px; align-items: flex-start;
  }
  .moon-msg-row.user { flex-direction: row-reverse; }

  .moon-avatar {
    width: 36px; height: 36px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .moon-avatar.bot {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--accent);
  }
  .moon-avatar.user {
    background: var(--user-bubble);
    color: #fff;
  }

  .moon-bubble {
    max-width: 78%;
    padding: 14px 18px;
    font-size: 14.5px; line-height: 1.65;
    border-radius: var(--radius-xl);
  }
  .moon-bubble.bot {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-top-left-radius: 6px;
    color: var(--text-primary);
  }
  .moon-bubble.user {
    background: var(--user-bubble);
    color: #fff;
    border-top-right-radius: 6px;
  }

  /* ── Typing indicator ── */
  .moon-typing {
    display: flex; gap: 5px; padding: 4px 0; align-items: center;
  }
  .moon-typing span {
    display: inline-block;
    width: 7px; height: 7px; border-radius: 50%;
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
    position: sticky;
    bottom: 6px;
    align-self: center;
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    height: 34px;
    padding: 0 12px 0 10px;
    background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
    border: 1px solid var(--accent);
    color: var(--accent-hover);
    border-radius: 999px;
    cursor: pointer;
    transition: transform var(--transition), background var(--transition), color var(--transition), box-shadow var(--transition);
    box-shadow: 0 10px 28px rgba(0,0,0,0.3), 0 0 0 3px var(--accent-dim);
    z-index: 5;
    font-family: var(--font);
    font-size: 12px;
    font-weight: 700;
  }
  .moon-scroll-btn:hover {
    background: var(--accent);
    color: #fff;
    transform: translateY(-1px);
  }

  /* ── Footer ── */
  .moon-footer {
    padding: 16px 20px 20px;
    background: linear-gradient(to top, var(--bg-base) 70%, transparent);
    flex-shrink: 0;
  }
  .moon-input-wrap { max-width: 800px; margin: 0 auto; position: relative; }
  .moon-input-box {
    display: flex; align-items: flex-end; gap: 6px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    padding: 7px;
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
    flex-shrink: 0; align-self: flex-end; margin-bottom: 2px;
  }
  .moon-input-side-btn:hover { color: var(--accent); background: var(--accent-dim); }
  .moon-input-side-btn.active-voice { color: #f87171; background: rgba(248,113,113,0.1); }
  .moon-input-side-btn.disabled,
  .moon-input-side-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .moon-input-side-btn.disabled:hover,
  .moon-input-side-btn:disabled:hover {
    color: var(--text-muted);
    background: none;
  }

  .moon-send-btn {
    width: 42px; height: 42px; border-radius: 50%;
    border: none; cursor: pointer; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, var(--accent), var(--accent-hover));
    color: #fff;
    transition: transform var(--transition), filter var(--transition), box-shadow var(--transition), background var(--transition);
    align-self: flex-end;
    margin-bottom: 0;
    box-shadow: 0 10px 22px var(--accent-dim);
  }
  .moon-send-btn:hover:not(:disabled) {
    filter: brightness(1.08);
    transform: translateY(-1px) scale(1.03);
    box-shadow: 0 14px 28px var(--accent-dim);
  }
  .moon-send-icon {
    width: 23px;
    height: 23px;
    min-width: 23px;
    flex: 0 0 23px;
    display: block;
    stroke-width: 2.7;
    transform: translateX(1px) translateY(-1px);
  }
  .moon-send-btn:active:not(:disabled) {
    transform: scale(0.96);
  }
  .moon-send-btn:disabled {
    background: var(--bg-elevated);
    color: var(--text-muted);
    cursor: default;
    box-shadow: none;
    border: 1px solid var(--border);
  }
  .moon-send-spin {
    width: 18px; height: 18px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  .moon-stop-icon {
    width: 19px; height: 19px;
    background: white;
    border-radius: 5px;
  }

  .moon-footer-hint {
    text-align: center; font-size: 11px;
    color: var(--text-muted); margin-top: 10px;
    letter-spacing: 0.03em;
  }

  /* ── Voice wave ── */
  .moon-wave {
    display: flex; gap: 2px; align-items: center; height: 18px;
  }
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
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px; z-index: 30;
    box-shadow: 0 8px 32px rgba(0,0,0,0.25);
  }
  .moon-dropzone-close {
    position: absolute; top: 10px; right: 10px;
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); display: flex;
    border-radius: 6px; padding: 4px;
    transition: color var(--transition);
  }
  .moon-dropzone-close:hover { color: var(--text-primary); }
  .moon-dropzone-area {
    border: 2px dashed var(--border);
    border-radius: var(--radius-md);
    padding: 28px 20px;
    text-align: center; cursor: pointer;
    transition: all 0.2s;
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
    font-size: 11px; color: var(--text-secondary);
    font-family: var(--font-mono);
  }
  .moon-file-chip button {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); display: flex; padding: 0 0 0 4px;
    transition: color var(--transition);
  }
  .moon-file-chip button:hover { color: #f87171; }
  .moon-pending-files {
    display: flex; flex-wrap: wrap; gap: 6px;
    padding: 0 4px 10px;
  }
  .moon-file-list {
    display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px;
  }

  /* ── Code blocks ── */
  .moon-code-block {
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid var(--border);
    margin: 8px 0;
    font-family: var(--font-mono);
  }
  .moon-code-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 7px 14px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
  }
  .moon-code-lang {
    font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--accent);
  }
  .moon-code-copy {
    display: flex; align-items: center; gap: 5px;
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); font-size: 11px;
    font-family: var(--font);
    padding: 3px 8px; border-radius: 6px;
    transition: all var(--transition);
  }
  .moon-code-copy:hover { color: var(--accent); background: var(--accent-dim); }
  .moon-code-pre {
    background: var(--bg-base);
    padding: 16px;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.65;
    color: var(--accent-hover);
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
  .moon-link {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
    transition: color var(--transition);
    cursor: pointer;
  }
  .moon-link:hover { color: var(--accent-hover); }
  .moon-hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 12px 0;
  }
  .moon-list {
    margin: 8px 0;
    padding: 0;
    list-style: none;
  }
  .moon-list-item {
    position: relative;
    font-size: 14.5px;
    line-height: 1.65;
    margin: 5px 0;
    padding-left: 20px;
    color: inherit;
  }
  .moon-list-item::before {
    content: "•";
    position: absolute;
    left: 0;
    color: var(--accent);
    font-weight: 700;
  }
  .moon-olist {
    margin: 8px 0;
    padding: 0;
    list-style: none;
    counter-reset: moon-counter;
  }
  .moon-olist-item {
    position: relative;
    counter-increment: moon-counter;
    font-size: 14.5px;
    line-height: 1.65;
    margin: 5px 0;
    padding-left: 28px;
    color: inherit;
  }
  .moon-olist-item::before {
    content: counter(moon-counter) ".";
    position: absolute;
    left: 0;
    top: 0;
    min-width: 20px;
    color: var(--accent);
    font-weight: 700;
  }
  .moon-md-spacer { height: 8px; }
  .moon-table {
    display: block;
    width: 100%;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    margin: 8px 0;
  }
  .moon-table-row {
    display: flex; gap: 0;
    border-bottom: 1px solid var(--border);
  }
  .moon-table-row:last-child { border-bottom: none; }
  .moon-table-row.head { background: var(--bg-elevated); font-weight: 700; }
  .moon-table-cell {
    flex: 1; padding: 6px 10px;
    font-size: 13px; color: var(--text-secondary);
    border-right: 1px solid var(--border);
  }
  .moon-table-cell:last-child { border-right: none; }

  /* ── Animations ── */
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 760px) {
    .moon-app { position: relative; }
    .moon-sidebar {
      position: absolute;
      inset: 0 auto 0 0;
      width: min(82vw, 280px);
      box-shadow: 16px 0 40px rgba(0,0,0,0.28);
    }
    .moon-main { width: 100%; }
    .moon-header {
      height: 56px;
      padding: 0 12px;
      gap: 8px;
    }
    .moon-header-left,
    .moon-header-right {
      gap: 7px;
      min-width: 0;
    }
    .moon-logo-text { font-size: 15px; }
    .moon-theme-btn {
      width: 36px;
      height: 36px;
      padding: 0;
      justify-content: center;
    }
    .moon-theme-btn span,
    .moon-theme-btn svg:last-child {
      display: none;
    }
    .moon-live-badge {
      padding: 7px 9px;
      min-width: 34px;
    }
    .moon-live-badge span { display: none; }
    .moon-messages {
      padding: 18px 14px;
    }
    .moon-messages-inner {
      max-width: none;
      gap: 18px;
    }
    .moon-empty-state {
      min-height: calc(100vh - 220px);
      gap: 14px;
    }
    .moon-empty-state h1 {
      font-size: 24px;
    }
    .moon-empty-state p {
      font-size: 14px;
    }
    .moon-suggestion-grid {
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .moon-msg-row {
      gap: 10px;
    }
    .moon-avatar {
      width: 32px;
      height: 32px;
      border-radius: 10px;
    }
    .moon-bubble {
      max-width: calc(100% - 42px);
      padding: 12px 14px;
      font-size: 14px;
      border-radius: 18px;
    }
    .moon-footer {
      padding: 12px 12px 14px;
    }
    .moon-input-box {
      border-radius: 20px;
      padding: 7px;
    }
    .moon-send-btn {
      width: 40px;
      height: 40px;
    }
    .moon-send-icon {
      width: 22px;
      height: 22px;
      min-width: 22px;
      flex-basis: 22px;
    }
    .moon-stop-icon {
      width: 18px;
      height: 18px;
    }
    .moon-scroll-btn {
      height: 32px;
      padding: 0 10px;
      font-size: 11px;
    }
    .moon-footer-hint {
      display: none;
    }
  }
`;
