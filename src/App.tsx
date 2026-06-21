import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp, Bot, User, PanelLeft, Plus,
  Copy, Check, Mic, Sun, Moon, Zap, Upload, RotateCcw, Pencil,
  FileText, X, ChevronDown, CircleStop, Trash2, ChevronRight, Search, SlidersHorizontal
} from "lucide-react";
import moonLogoUrl from "./assets/MoonAILogo.png";
import moonLogoLightUrl from "./assets/MoonAILogoWhite.png";

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
  settings?: BotSettings;
}

interface BotSettings {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  topK: number;
  repetitionPenalty: number;
}

interface UploadedFile {
  name: string;
  size: number;
  type: string;
}

type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastPayload {
  title: string;
  detail?: string;
  variant?: ToastVariant;
}

interface ToastMessage extends ToastPayload {
  id: string;
  variant: ToastVariant;
}

// ─── Model Definitions ────────────────────────────────────────────────────────
interface ModelDef {
  id: string;
  name: string;
  tag: string;
  endpoint: string;
  baseUrl?: string;
  description: string;
  color: string;
}

const MOONAI_150M_API_URL = ((import.meta.env.VITE_MOONAI_150M_API_URL as string | undefined) ?? "https://abad3v-moonai-v1-0-150m.hf.space").replace(/\/$/, "");

const MODELS: ModelDef[] = [
  {
    id: "moonai-700m-v1.2",
    name: "MoonAI-v1.2",
    tag: "v1.2 · latest",
    endpoint: "/chat",
    description: "Самая последняя версия",
    color: "#6366f1",
  },
  {
    id: "moonai-700m-v1.1",
    name: "MoonAI-v1.1",
    tag: "v1.1 · stable",
    endpoint: "/chat_v1",
    description: "Самая стабильная версия",
    color: "#a78bfa",
  },
  {
    id: "moonai-150m-v1.0",
    name: "MoonAI-150M",
    tag: "150M V1.0 · fast",
    endpoint: "/chat",
    baseUrl: MOONAI_150M_API_URL,
    description: "Самая быстрая модель",
    color: "#14b8a6",
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

type MarkdownPart = { type: "text" | "code"; value: string; lang?: string };

function normalizeCodeLang(value?: string) {
  const lang = (value || "").trim().replace(/^[:=]/, "").trim();
  return lang ? lang.split(/\s+/)[0].toLowerCase() : "text";
}

function trimCodeBlock(value: string) {
  return value.replace(/^\n+|\n+$/g, "");
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea fallback for webviews with strict clipboard permissions.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

const TOAST_EVENT = "moonai:toast";

function emitToast(payload: ToastPayload) {
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }));
}

const CODE_LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  python3: "python",
  yml: "yaml",
  sh: "bash",
  shell: "bash",
  plaintext: "text",
};

const PY_KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
  "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in",
  "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while",
  "with", "yield",
]);
const PY_LITERALS = new Set(["True", "False", "None"]);
const PY_BUILTINS = new Set([
  "bool", "dict", "enumerate", "float", "input", "int", "len", "list", "map", "max",
  "min", "open", "print", "range", "set", "str", "sum", "tuple", "zip",
]);

const JS_KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "export", "extends", "finally", "for", "from",
  "function", "if", "import", "in", "instanceof", "let", "new", "of", "return",
  "switch", "throw", "try", "typeof", "var", "void", "while", "with", "yield",
]);
const JS_LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

function canonicalCodeLang(lang?: string) {
  const normalized = normalizeCodeLang(lang);
  return CODE_LANG_ALIASES[normalized] ?? normalized;
}

function detectCodeLang(value: string) {
  const code = value.trim();
  if (!code) return "text";

  if ((code.startsWith("{") && code.endsWith("}")) || (code.startsWith("[") && code.endsWith("]"))) {
    try {
      JSON.parse(code);
      return "json";
    } catch {
      // Keep scoring below for object-like JavaScript snippets.
    }
  }

  let pythonScore = 0;
  let jsScore = 0;
  if (/^\s*(from\s+[\w.]+\s+import|import\s+[\w.]+)/m.test(code)) pythonScore += 3;
  if (/^\s*def\s+\w+\s*\([^)]*\)\s*:/m.test(code)) pythonScore += 4;
  if (/^\s*class\s+\w+(?:\([^)]*\))?\s*:/m.test(code)) pythonScore += 2;
  if (/^\s*#/m.test(code)) pythonScore += 1;
  if (/\b(print|len|range|enumerate)\s*\(/.test(code)) pythonScore += 1;
  if (/\b(True|False|None)\b/.test(code)) pythonScore += 1;

  if (/\b(const|let|var|function|=>|console\.|document\.|window\.)\b/.test(code)) jsScore += 3;
  if (/^\s*import\s+.+\s+from\s+["']/m.test(code)) jsScore += 2;
  if (/^\s*export\s+/m.test(code)) jsScore += 2;
  if (/^\s*\/\//m.test(code)) jsScore += 1;
  if (/\b(true|false|null|undefined)\b/.test(code)) jsScore += 1;

  if (pythonScore >= jsScore + 2 && pythonScore >= 2) return "python";
  if (jsScore >= pythonScore + 1 && jsScore >= 2) return "javascript";
  return "text";
}

function resolveCodeLang(lang: string | undefined, value: string) {
  const canonical = canonicalCodeLang(lang);
  return canonical && canonical !== "text" ? canonical : detectCodeLang(value);
}

function classifyCodeToken(token: string, lang: string, source: string, tokenEnd: number) {
  const next = source.slice(tokenEnd);
  if (/^(#|\/\/|\/\*)/.test(token)) return "comment";
  if (/^(`|"""|'''|"|')/.test(token)) {
    return lang === "json" && /^\s*:/.test(next) ? "key" : "string";
  }
  if (/^\d/.test(token)) return "number";
  if (/^[{}()[\].,:;+\-*/%=<>!&|^~?]+$/.test(token)) return "punctuation";

  if (lang === "python") {
    if (PY_KEYWORDS.has(token)) return "keyword";
    if (PY_LITERALS.has(token)) return "literal";
    if (PY_BUILTINS.has(token)) return "builtin";
  } else if (lang === "javascript" || lang === "typescript") {
    if (JS_KEYWORDS.has(token)) return "keyword";
    if (JS_LITERALS.has(token)) return "literal";
  } else if (lang === "json") {
    if (/^(true|false|null)$/.test(token)) return "literal";
  }

  if (/^[A-Za-z_$][\w$]*$/.test(token) && /^\s*\(/.test(next)) return "function";
  return "";
}

function highlightCode(value: string, lang: string) {
  if (!value) return "";
  const tokenRe = lang === "python"
    ? /("""[\s\S]*?"""|'''[\s\S]*?'''|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b|[{}()[\].,:;+\-*/%=<>!&|^~]+)/g
    : /(\/\/.*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[{}()[\].,:;+\-*/%=<>!&|^~?]+)/g;

  let html = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(value)) !== null) {
    const token = match[0];
    html += escapeHtml(value.slice(lastIndex, match.index));
    const cls = classifyCodeToken(token, lang, value, tokenRe.lastIndex);
    html += cls
      ? `<span class="moon-code-token ${cls}">${escapeHtml(token)}</span>`
      : escapeHtml(token);
    lastIndex = tokenRe.lastIndex;
  }
  html += escapeHtml(value.slice(lastIndex));
  return html;
}

function splitMarkdownParts(content: string): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let textLines: string[] = [];
  let codeLines: string[] = [];
  let codeLang = "text";
  let codeMode: "fence" | "bbcode" | null = null;

  const pushText = () => {
    const value = textLines.join("\n");
    if (value) parts.push({ type: "text", value });
    textLines = [];
  };

  const pushCode = () => {
    parts.push({ type: "code", lang: codeLang, value: trimCodeBlock(codeLines.join("\n")) });
    codeLines = [];
    codeLang = "text";
    codeMode = null;
  };

  lines.forEach((line) => {
    if (codeMode === "fence") {
      if (/^\s*```\s*$/.test(line)) {
        pushCode();
        return;
      }
      codeLines.push(line);
      return;
    }

    if (codeMode === "bbcode") {
      const closeMatch = /\[\/code\]/i.exec(line);
      if (closeMatch) {
        codeLines.push(line.slice(0, closeMatch.index));
        pushCode();
        const rest = line.slice(closeMatch.index + closeMatch[0].length);
        if (rest) textLines.push(rest);
        return;
      }
      codeLines.push(line);
      return;
    }

    const fenceMatch = /^\s*```([^\n`]*)\s*$/.exec(line);
    if (fenceMatch) {
      pushText();
      codeMode = "fence";
      codeLang = normalizeCodeLang(fenceMatch[1]);
      return;
    }

    const codeMatch = /\[code(?:=([^\]]*))?\]/i.exec(line);
    if (!codeMatch) {
      textLines.push(line);
      return;
    }

    const before = line.slice(0, codeMatch.index);
    if (before) textLines.push(before);
    pushText();

    const afterOpen = line.slice(codeMatch.index + codeMatch[0].length);
    const closeMatch = /\[\/code\]/i.exec(afterOpen);
    if (closeMatch) {
      parts.push({
        type: "code",
        lang: normalizeCodeLang(codeMatch[1]),
        value: trimCodeBlock(afterOpen.slice(0, closeMatch.index)),
      });
      const rest = afterOpen.slice(closeMatch.index + closeMatch[0].length);
      if (rest) textLines.push(rest);
      return;
    }

    codeMode = "bbcode";
    codeLang = normalizeCodeLang(codeMatch[1]);
    if (afterOpen) codeLines.push(afterOpen);
  });

  if (codeMode) pushCode();
  pushText();

  return parts;
}

function CodeBlock({ lang, value }: { lang: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const copyResetRef = useRef<number | null>(null);
  const detectedLang = useMemo(() => resolveCodeLang(lang, value), [lang, value]);
  const highlightedCode = useMemo(() => highlightCode(value, detectedLang), [detectedLang, value]);
  const handleCopy = useCallback(async () => {
    setCopied(true);
    if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopied(false), 2000);

    try {
      await copyToClipboard(value);
      emitToast({ title: "Код скопирован", variant: "success" });
    } catch {
      copyResetRef.current = window.setTimeout(() => setCopied(false), 900);
      emitToast({ title: "Не удалось скопировать код", detail: "Попробуй выделить код вручную.", variant: "error" });
    }
  }, [value]);

  useEffect(() => () => {
    if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
  }, []);

  return (
    <div className="moon-code-block">
      <div className="moon-code-header">
        <div className="moon-code-title">
          <span className="moon-code-lang">{detectedLang}</span>
          {canonicalCodeLang(lang) === "text" && detectedLang !== "text" && (
            <span className="moon-code-auto">auto</span>
          )}
        </div>
        <div className="moon-code-actions">
          <button
            type="button"
            className={`moon-code-wrap ${wrapped ? "active" : ""}`}
            onClick={() => setWrapped(value => !value)}
            aria-pressed={wrapped}
            title={wrapped ? "Отключить перенос строк" : "Включить перенос строк"}
          >
            {wrapped ? "Без переноса" : "Перенос"}
          </button>
          <button type="button" className={`moon-code-copy ${copied ? "copied" : ""}`} onClick={handleCopy}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? "Скопировано" : "Скопировать"}</span>
          </button>
        </div>
      </div>
      <pre className={`moon-code-pre ${wrapped ? "wrapped" : ""}`}>
        <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
      </pre>
    </div>
  );
}

function SimpleMarkdown({ content }: { content: string }) {
  const parts = useMemo(() => splitMarkdownParts(content), [content]);

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
  const [open, setOpen] = useState(false);
  const current = MODELS.find((m) => m.id === selected) ?? MODELS[0];

  return (
    <div className="moon-model-selector" style={{ "--chip-color": current.color } as React.CSSProperties}>
      <button
        type="button"
        className={`moon-model-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        title={`Выбрать модель: ${current.name} ${current.tag}`}
      >
        <span className="moon-model-chip-dot" />
        <span className="moon-model-trigger-label">{current.tag}</span>
        <ChevronDown size={13} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="moon-model-menu"
          >
            {MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`moon-model-option ${selected === m.id ? "active" : ""}`}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                style={{ "--chip-color": m.color } as React.CSSProperties}
              >
                <span className="moon-model-chip-dot" />
                <span className="moon-model-option-copy">
                  <span className="moon-model-chip-name">{m.name}</span>
                  <span className="moon-model-chip-tag">{m.tag}</span>
                  <span className="moon-model-chip-description">{m.description}</span>
                </span>
                {selected === m.id && <Check size={14} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Theme Toggle ─────────────────────────────────────────────────────────────
function BotSettingsPanel({
  settings,
  open,
  onOpenChange,
  onChange,
}: {
  settings: BotSettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<BotSettings>) => void;
}) {
  const updateNumber = (key: keyof Pick<BotSettings, "temperature" | "maxTokens" | "topK" | "repetitionPenalty">, value: string) => {
    onChange({ [key]: Number(value) } as Partial<BotSettings>);
  };

  return (
    <div className="moon-bot-settings">
      <button
        type="button"
        className={`moon-input-side-btn moon-settings-trigger ${open ? "active" : ""}`}
        onClick={() => onOpenChange(!open)}
        title="Параметры бота"
        aria-label="Параметры бота"
      >
        <SlidersHorizontal size={16} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="moon-settings-panel"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.14 }}
          >
            <div className="moon-settings-head">
              <span>Поведение</span>
              <button type="button" onClick={() => onOpenChange(false)} aria-label="Закрыть">
                <X size={13} />
              </button>
            </div>

            <label className="moon-settings-field wide">
              <span>Системный промпт</span>
              <textarea
                value={settings.systemPrompt}
                onChange={e => onChange({ systemPrompt: e.target.value })}
                rows={3}
              />
            </label>

            <label className="moon-settings-field">
              <span>Temperature <b>{settings.temperature.toFixed(2)}</b></span>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={settings.temperature}
                onChange={e => updateNumber("temperature", e.target.value)}
              />
            </label>

            <label className="moon-settings-field">
              <span>Max tokens <b>{settings.maxTokens}</b></span>
              <input
                type="range"
                min="32"
                max="512"
                step="16"
                value={settings.maxTokens}
                onChange={e => updateNumber("maxTokens", e.target.value)}
              />
            </label>

            <label className="moon-settings-field">
              <span>Top K <b>{settings.topK}</b></span>
              <input
                type="range"
                min="1"
                max="100"
                step="1"
                value={settings.topK}
                onChange={e => updateNumber("topK", e.target.value)}
              />
            </label>

            <label className="moon-settings-field">
              <span>Repeat penalty <b>{settings.repetitionPenalty.toFixed(2)}</b></span>
              <input
                type="range"
                min="1"
                max="2"
                step="0.05"
                value={settings.repetitionPenalty}
                onChange={e => updateNumber("repetitionPenalty", e.target.value)}
              />
            </label>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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

function ToastViewport({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  const toastIcons: Record<ToastVariant, React.ReactNode> = {
    success: <Check size={15} />,
    error: <X size={15} />,
    info: <Zap size={15} />,
    warning: <CircleStop size={15} />,
  };

  return (
    <div className="moon-toast-viewport" aria-live="polite" aria-atomic="true">
      <AnimatePresence initial={false}>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            className={`moon-toast ${toast.variant}`}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 18, scale: 0.97 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <div className="moon-toast-icon">{toastIcons[toast.variant]}</div>
            <div className="moon-toast-copy">
              <strong>{toast.title}</strong>
              {toast.detail && <span>{toast.detail}</span>}
            </div>
            <button
              type="button"
              className="moon-toast-close"
              onClick={() => onDismiss(toast.id)}
              aria-label="Закрыть уведомление"
            >
              <X size={12} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Storage helpers ──────────────────────────────────────────────────────────
const STORAGE_KEY = "moonai_sessions";
const THEME_KEY   = "moonai_theme";
const MODEL_KEY   = "moonai_model";
const USER_SETTINGS_KEY = "moonai_user_settings";
const NEW_CHAT_TITLE = "Новый чат";
const DEFAULT_API_URL = "https://abad3v-moonai-backend-730m.hf.space";
const API_URL = ((import.meta.env.VITE_MOONAI_API_URL as string | undefined) ?? DEFAULT_API_URL).replace(/\/$/, "");
const DEFAULT_SYSTEM_PROMPT = "Ты MoonAI - умный ассистент. Отвечай в Markdown-разметке.";
const DEFAULT_BOT_SETTINGS: BotSettings = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0.35,
  maxTokens: 200,
  topK: 30,
  repetitionPenalty: 1.25,
};

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
      settings: normalizeBotSettings(session.settings),
    }));
  } catch { return []; }
}
function saveSessions(sessions: ChatSession[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch {}
}
function loadUserSettings(): BotSettings {
  try {
    const raw = localStorage.getItem(USER_SETTINGS_KEY);
    return normalizeBotSettings(raw ? JSON.parse(raw) : undefined);
  } catch { return DEFAULT_BOT_SETTINGS; }
}
function saveUserSettings(settings: BotSettings) {
  try { localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}
function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}
function normalizeBotSettings(settings?: Partial<BotSettings>): BotSettings {
  const systemPrompt = typeof settings?.systemPrompt === "string" && settings.systemPrompt.trim()
    ? settings.systemPrompt
    : DEFAULT_SYSTEM_PROMPT;
  return {
    systemPrompt,
    temperature: clampNumber(settings?.temperature, 0, 1.5, DEFAULT_BOT_SETTINGS.temperature),
    maxTokens: Math.round(clampNumber(settings?.maxTokens, 32, 512, DEFAULT_BOT_SETTINGS.maxTokens)),
    topK: Math.round(clampNumber(settings?.topK, 1, 100, DEFAULT_BOT_SETTINGS.topK)),
    repetitionPenalty: clampNumber(settings?.repetitionPenalty, 1, 2, DEFAULT_BOT_SETTINGS.repetitionPenalty),
  };
}
function makeSession(id: string): ChatSession {
  return {
    id,
    title: NEW_CHAT_TITLE,
    lastActive: Date.now(),
    messages: [],
    modelId: localStorage.getItem(MODEL_KEY) ?? MODELS[0].id,
    settings: loadUserSettings(),
  };
}

type SessionGroupKey = "today" | "yesterday" | "earlier";
type SessionGroup = { key: SessionGroupKey; label: string; sessions: ChatSession[] };

function startOfDay(value: number) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getSessionGroupKey(lastActive: number): SessionGroupKey {
  const today = startOfDay(Date.now());
  const day = startOfDay(lastActive);
  const diff = today - day;
  if (diff <= 0) return "today";
  if (diff <= 24 * 60 * 60 * 1000) return "yesterday";
  return "earlier";
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
  const activeSettings = normalizeBotSettings(activeSession?.settings);
  const activeModelId = activeSession?.modelId ?? selectedModel;

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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingClearOpen, setPendingClearOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const scrollRef    = useRef<HTMLDivElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const abortRef     = useRef<AbortController | null>(null);
  const messageCopyResetRef = useRef<number | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimersRef = useRef<Record<string, number>>({});
  const backendState = backendLabels[backendStatus];

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current[id];
    if (timer) window.clearTimeout(timer);
    delete toastTimersRef.current[id];
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const pushToast = useCallback((payload: ToastPayload) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const variant = payload.variant ?? "info";
    const toast: ToastMessage = { ...payload, id, variant };
    const duration = variant === "error" ? 5200 : 2600;

    setToasts(prev => [toast, ...prev].slice(0, 4));
    toastTimersRef.current[id] = window.setTimeout(() => dismissToast(id), duration);
  }, [dismissToast]);

  useEffect(() => {
    const handler = (event: Event) => {
      pushToast((event as CustomEvent<ToastPayload>).detail);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, [pushToast]);

  useEffect(() => () => {
    Object.values(toastTimersRef.current).forEach(timer => window.clearTimeout(timer));
  }, []);

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

  useEffect(() => () => {
    if (messageCopyResetRef.current) window.clearTimeout(messageCopyResetRef.current);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(themes[theme]).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [theme]);

  useEffect(() => {
    if (!renamingSessionId) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renamingSessionId]);

  const historyGroups = useMemo<SessionGroup[]>(() => {
    const query = historyQuery.trim().toLowerCase();
    const filtered = sessions
      .filter(session => {
        if (!query) return true;
        return session.title.toLowerCase().includes(query)
          || session.messages.some(message => message.text.toLowerCase().includes(query));
      })
      .slice()
      .sort((a, b) => b.lastActive - a.lastActive);

    const groups: SessionGroup[] = [
      { key: "today", label: "Сегодня", sessions: [] },
      { key: "yesterday", label: "Вчера", sessions: [] },
      { key: "earlier", label: "Ранее", sessions: [] },
    ];
    filtered.forEach(session => {
      groups.find(group => group.key === getSessionGroupKey(session.lastActive))?.sessions.push(session);
    });
    return groups.filter(group => group.sessions.length > 0);
  }, [historyQuery, sessions]);

  const hasHistoryResults = historyGroups.some(group => group.sessions.length > 0);

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
  const updateActiveSettings = useCallback((patch: Partial<BotSettings>) => {
    const nextSettings = normalizeBotSettings({ ...activeSettings, ...patch });
    updateSession(activeId, { settings: nextSettings, lastActive: Date.now() });
    saveUserSettings(nextSettings);
  }, [activeId, activeSettings, updateSession]);

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

  const pendingDeleteSession = pendingDeleteId
    ? sessions.find(s => s.id === pendingDeleteId)
    : null;
  const canClearCurrentChat = messages.length > 0;

  const confirmDeleteSession = useCallback(() => {
    if (!pendingDeleteId) return;
    const title = sessions.find(s => s.id === pendingDeleteId)?.title;
    deleteSession(pendingDeleteId);
    setPendingDeleteId(null);
    pushToast({ title: "Чат удалён", detail: title, variant: "success" });
  }, [deleteSession, pendingDeleteId, pushToast, sessions]);

  const confirmClearCurrentChat = useCallback(() => {
    updateMessages(activeId, []);
    setPendingClearOpen(false);
    pushToast({ title: "Чат очищен", variant: "success" });
  }, [activeId, pushToast, updateMessages]);

  const startRenameSession = useCallback((session: ChatSession) => {
    setRenamingSessionId(session.id);
    setRenameValue(session.title);
  }, []);

  const cancelRenameSession = useCallback(() => {
    setRenamingSessionId(null);
    setRenameValue("");
  }, []);

  const saveRenameSession = useCallback(() => {
    if (!renamingSessionId) return;
    const title = renameValue.trim() || NEW_CHAT_TITLE;
    updateSession(renamingSessionId, { title });
    setRenamingSessionId(null);
    setRenameValue("");
    pushToast({ title: "Название обновлено", detail: title, variant: "success" });
  }, [pushToast, renameValue, renamingSessionId, updateSession]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsTyping(false);
  }, []);

  const generateBotReply = useCallback(async (
    sessionId: string,
    text: string,
    modelId: string,
    settings: BotSettings,
    insertAfterId?: string,
  ) => {
    const model = MODELS.find(m => m.id === modelId) ?? MODELS[0];
    const requestSettings = normalizeBotSettings(settings);
    setIsTyping(true);
    setUserScrolled(false);

    const msgId = Date.now().toString() + "_bot";
    const botMsg: Message = {
      id: msgId,
      text: "",
      sender: "bot",
      timestamp: Date.now(),
      modelId: model.id,
    };

    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const insertIndex = insertAfterId
        ? s.messages.findIndex(m => m.id === insertAfterId)
        : -1;
      const nextMessages = insertIndex >= 0
        ? [
            ...s.messages.slice(0, insertIndex + 1),
            botMsg,
            ...s.messages.slice(insertIndex + 1),
          ]
        : [...s.messages, botMsg];
      return { ...s, messages: nextMessages, lastActive: Date.now() };
    }));

    const abort = new AbortController();
    abortRef.current = abort;
    setBackendStatus("connecting");

    try {
      const modelBaseUrl = (model.baseUrl ?? API_URL).replace(/\/$/, "");
      const res = await fetch(`${modelBaseUrl}${model.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          system_prompt: requestSettings.systemPrompt,
          max_tokens: requestSettings.maxTokens,
          temperature: requestSettings.temperature,
          top_k: requestSettings.topK,
          repetition_penalty: requestSettings.repetitionPenalty,
        }),
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
        pushToast({ title: "Ошибка запроса", detail: errMsg, variant: "error" });
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
  }, [pushToast]);

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

    await generateBotReply(sessionId, text, activeModelId, activeSettings, userMsg.id);
  }, [input, isTyping, activeId, pendingFiles, activeModelId, activeSettings, generateBotReply]);

  const handleCopyMessage = useCallback(async (msg: Message) => {
    setCopiedMessageId(msg.id);
    if (messageCopyResetRef.current) window.clearTimeout(messageCopyResetRef.current);
    messageCopyResetRef.current = window.setTimeout(() => setCopiedMessageId(null), 1800);

    try {
      await copyToClipboard(msg.text);
      pushToast({ title: "Сообщение скопировано", variant: "success" });
    } catch {
      messageCopyResetRef.current = window.setTimeout(() => setCopiedMessageId(null), 700);
      pushToast({ title: "Не удалось скопировать", detail: "Попробуй выделить текст вручную.", variant: "error" });
    }
  }, [pushToast]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    const latestMessage = messages[messages.length - 1];
    if (isTyping && latestMessage?.id === messageId) handleStop();

    setSessions(prev => prev.map(s =>
      s.id === activeId
        ? { ...s, messages: s.messages.filter(m => m.id !== messageId), lastActive: Date.now() }
        : s
    ));
    pushToast({ title: "Сообщение удалено", variant: "success" });
  }, [activeId, handleStop, isTyping, messages, pushToast]);

  const handleEditMessage = useCallback((msg: Message) => {
    if (isTyping) return;
    setInput(msg.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [isTyping]);

  const handleRegenerateMessage = useCallback((botMsg: Message) => {
    if (isTyping) return;
    const session = sessions.find(s => s.id === activeId);
    if (!session) return;

    const botIndex = session.messages.findIndex(m => m.id === botMsg.id);
    if (botIndex < 0) return;

    const promptMsg = [...session.messages.slice(0, botIndex)]
      .reverse()
      .find(m => m.sender === "user");
    if (!promptMsg) return;

    setSessions(prev => prev.map(s =>
      s.id === activeId
        ? { ...s, messages: s.messages.filter(m => m.id !== botMsg.id), lastActive: Date.now() }
        : s
    ));

    void generateBotReply(activeId, promptMsg.text, botMsg.modelId ?? activeModelId, normalizeBotSettings(session.settings), promptMsg.id);
  }, [activeId, activeModelId, generateBotReply, isTyping, sessions]);

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

  const handleModelChange = useCallback((modelId: string) => {
    if (modelId === activeModelId) return;
    const model = MODELS.find(m => m.id === modelId) ?? MODELS[0];
    setSelectedModel(modelId);
    updateSession(activeId, { modelId, lastActive: Date.now() });
    pushToast({ title: "Модель переключена", detail: model.tag, variant: "info" });
  }, [activeId, activeModelId, pushToast, updateSession]);

  const currentModel = MODELS.find(m => m.id === activeModelId) ?? MODELS[0];
  const currentLogoUrl = theme === "light" ? moonLogoLightUrl : moonLogoUrl;
  const sidebarBody = (
    <motion.div
      className="moon-sidebar-inner"
      initial={false}
      animate={isSidebarOpen || sidebarOverlay ? { x: 0, opacity: 1 } : { x: -18, opacity: 0 }}
      transition={{ duration: isSidebarOpen ? 0.18 : 0.12, ease: "easeOut" }}
    >
      <div className="moon-sidebar-top">
        <div className="moon-sidebar-brand">
          <div className="moon-sidebar-logo">
            <img src={currentLogoUrl} alt="" className="moon-brand-img" />
          </div>
          <span>MoonAI</span>
        </div>
        <button className="moon-new-chat" onClick={newChat}>
          <Plus size={15} /> Новый чат
        </button>
      </div>

      <div className="moon-sessions">
        <div className="moon-sessions-head">
          <p className="moon-sessions-label">История</p>
          <span>{sessions.length}</span>
        </div>
        <label className="moon-history-search">
          <Search size={13} />
          <input
            type="search"
            value={historyQuery}
            onChange={e => setHistoryQuery(e.target.value)}
            placeholder="Поиск чатов"
          />
        </label>

        <div className="moon-session-list">
          {hasHistoryResults ? (
            historyGroups.map(group => (
              <div key={group.key} className="moon-session-group">
                <div className="moon-session-group-title">{group.label}</div>
                {group.sessions.map(sess => {
                  const isRenaming = renamingSessionId === sess.id;
                  return (
                    <motion.div
                      key={sess.id}
                      className={`moon-session-item ${sess.id === activeId ? "active" : ""} ${isRenaming ? "renaming" : ""}`}
                      onClick={() => {
                        if (isRenaming) return;
                        setActiveId(sess.id);
                        if (sidebarOverlay) setIsSidebarOpen(false);
                      }}
                      whileHover={isRenaming ? undefined : { x: 3 }}
                      transition={{ duration: 0.12 }}
                    >
                      <ChevronRight size={11} className="moon-session-arrow" />
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          className="moon-session-rename"
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onClick={e => e.stopPropagation()}
                          onKeyDown={e => {
                            if (e.key === "Enter") saveRenameSession();
                            if (e.key === "Escape") cancelRenameSession();
                          }}
                        />
                      ) : (
                        <span className="moon-session-title">{sess.title}</span>
                      )}
                      <div className="moon-session-actions">
                        {isRenaming ? (
                          <>
                            <button
                              type="button"
                              className="moon-session-action confirm"
                              onClick={e => { e.stopPropagation(); saveRenameSession(); }}
                              title="Сохранить название"
                              aria-label="Сохранить название"
                            >
                              <Check size={11} />
                            </button>
                            <button
                              type="button"
                              className="moon-session-action"
                              onClick={e => { e.stopPropagation(); cancelRenameSession(); }}
                              title="Отменить"
                              aria-label="Отменить"
                            >
                              <X size={11} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="moon-session-action"
                              onClick={e => { e.stopPropagation(); startRenameSession(sess); }}
                              title="Переименовать чат"
                              aria-label="Переименовать чат"
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              type="button"
                              className="moon-session-action danger"
                              onClick={e => { e.stopPropagation(); setPendingDeleteId(sess.id); }}
                              title="Удалить чат"
                              aria-label="Удалить чат"
                            >
                              <X size={11} />
                            </button>
                          </>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="moon-sessions-empty">
              <Search size={16} />
              <span>{historyQuery.trim() ? "Ничего не найдено" : "История пуста"}</span>
              <small>{historyQuery.trim() ? "Попробуй другой запрос" : "Создай новый чат, и он появится здесь"}</small>
            </div>
          )}
        </div>
      </div>

      <div className="moon-sidebar-foot">
        <div className={`moon-engine-status ${backendStatus}`}>
          <div className="moon-engine-dot" />
          <span>{backendState.sidebar}</span>
        </div>
        <span className="moon-version">v0.5.0</span>
      </div>
    </motion.div>
  );
  const sidebarRail = (
    <div className="moon-sidebar-rail" aria-hidden={isSidebarOpen}>
      <button
        type="button"
        className="moon-rail-logo moon-logo-toggle"
        onMouseDown={e => { e.preventDefault(); setIsSidebarOpen(true); }}
        title="Показать панель"
        aria-label="Показать панель"
      >
        <span className="moon-logo-toggle-idle">
          <img src={currentLogoUrl} alt="" className="moon-brand-img" />
        </span>
        <span className="moon-logo-toggle-hover"><PanelLeft size={15} /></span>
      </button>
      <button
        type="button"
        className="moon-rail-btn"
        onMouseDown={e => { e.preventDefault(); newChat(); }}
        title="Новый чат"
        aria-label="Новый чат"
      >
        <Plus size={17} />
      </button>
    </div>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className={`moon-app theme-${theme} ${isSidebarOpen ? "sidebar-open" : "sidebar-closed"} ${sidebarOverlay ? "sidebar-overlay" : "sidebar-docked"}`}>

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
        {!sidebarOverlay && (
          <aside
            className={`moon-sidebar ${isSidebarOpen ? "open" : "collapsed"}`}
          >
            {sidebarBody}
            {sidebarRail}
          </aside>
        )}

        <AnimatePresence>
          {sidebarOverlay && isSidebarOpen && (
            <motion.aside
              className="moon-sidebar mobile-open"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
            >
              {sidebarBody}
            </motion.aside>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {pendingDeleteSession && (
            <motion.div
              className="moon-confirm-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPendingDeleteId(null)}
            >
              <motion.div
                className="moon-confirm-dialog"
                initial={{ opacity: 0, scale: 0.96, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 10 }}
                transition={{ duration: 0.16 }}
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-chat-title"
              >
                <div className="moon-confirm-icon">
                  <Trash2 size={18} />
                </div>
                <div className="moon-confirm-copy">
                  <h2 id="delete-chat-title">Удалить чат?</h2>
                  <p>
                    Чат «{pendingDeleteSession.title}» будет удалён навсегда.
                    Вернуть его после удаления нельзя.
                  </p>
                </div>
                <div className="moon-confirm-actions">
                  <button className="moon-confirm-cancel" onClick={() => setPendingDeleteId(null)}>
                    Отмена
                  </button>
                  <button className="moon-confirm-delete" onClick={confirmDeleteSession}>
                    Удалить
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {pendingClearOpen && (
            <motion.div
              className="moon-confirm-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPendingClearOpen(false)}
            >
              <motion.div
                className="moon-confirm-dialog"
                initial={{ opacity: 0, scale: 0.96, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 10 }}
                transition={{ duration: 0.16 }}
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="clear-chat-title"
              >
                <div className="moon-confirm-icon">
                  <Trash2 size={18} />
                </div>
                <div className="moon-confirm-copy">
                  <h2 id="clear-chat-title">Очистить чат?</h2>
                  <p>
                    Все сообщения в текущем чате будут удалены.
                    Вернуть их после очистки нельзя.
                  </p>
                </div>
                <div className="moon-confirm-actions">
                  <button className="moon-confirm-cancel" onClick={() => setPendingClearOpen(false)}>
                    Отмена
                  </button>
                  <button className="moon-confirm-delete" onClick={confirmClearCurrentChat}>
                    Очистить
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* MAIN */}
        <div className="moon-main">

          {/* HEADER */}
          <header className="moon-header">
            <div className="moon-header-left">
              {(sidebarOverlay || isSidebarOpen) && (
                <button
                  type="button"
                  className="moon-icon-btn"
                  onMouseDown={e => { e.preventDefault(); setIsSidebarOpen(v => !v); }}
                  aria-label={isSidebarOpen ? "Скрыть панель" : "Показать панель"}
                  title={isSidebarOpen ? "Скрыть панель" : "Показать панель"}
                >
                  <PanelLeft size={19} />
                </button>
              )}
            </div>
            <div className="moon-header-right">
              <ThemeToggle current={theme} onChange={setTheme} />
              <div className={`moon-live-badge ${backendStatus}`}>
                <div className="moon-live-dot" />
                <span className="moon-live-label">{backendState.label}</span>
              </div>
              <button
                className="moon-icon-btn danger"
                onClick={() => canClearCurrentChat && setPendingClearOpen(true)}
                disabled={!canClearCurrentChat}
                title={canClearCurrentChat ? "Очистить чат" : "Чат уже пустой"}
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
                  <div className="moon-empty-icon">
                    <img src={currentLogoUrl} alt="" className="moon-brand-img moon-brand-img-empty" />
                  </div>
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
                      <div className={`moon-msg-stack ${msg.sender}`}>
                        <div className={`moon-bubble ${msg.sender}`}>
                          {msg.sender === "bot" && msgModel && (
                            <div className="moon-bubble-model-tag" style={{ "--chip-color": msgModel.color } as React.CSSProperties}>
                              <span className="moon-bubble-model-dot" />
                              {msgModel.tag}
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
                        <div className={`moon-msg-actions ${msg.sender}`}>
                          <button
                            type="button"
                            className={`moon-msg-action ${copiedMessageId === msg.id ? "copied" : ""}`}
                            onClick={() => handleCopyMessage(msg)}
                            disabled={!msg.text.trim()}
                            title="Скопировать сообщение"
                            aria-label={copiedMessageId === msg.id ? "Скопировано" : "Скопировать сообщение"}
                            data-tooltip={copiedMessageId === msg.id ? "Скопировано" : "Скопировать"}
                          >
                            {copiedMessageId === msg.id ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                          {msg.sender === "bot" ? (
                            <button
                              type="button"
                              className="moon-msg-action"
                              onClick={() => handleRegenerateMessage(msg)}
                              disabled={isTyping}
                              title="Повторить ответ"
                              aria-label="Повторить ответ"
                              data-tooltip="Повторить"
                            >
                              <RotateCcw size={14} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="moon-msg-action"
                              onClick={() => handleEditMessage(msg)}
                              disabled={isTyping}
                              title="Редактировать в поле ввода"
                              aria-label="Редактировать сообщение"
                              data-tooltip="Редактировать"
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="moon-msg-action danger"
                            onClick={() => handleDeleteMessage(msg.id)}
                            title="Удалить сообщение"
                            aria-label="Удалить сообщение"
                            data-tooltip="Удалить"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
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

              <div className={`moon-input-box ${isListening ? "listening" : ""}`}>
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

                <div className="moon-input-toolbar">
                  <button
                    className="moon-input-side-btn disabled"
                    disabled
                    title="Загрузка файлов пока не подключена"
                  >
                    <Upload size={16} />
                  </button>

                  <div className="moon-input-actions">
                    <BotSettingsPanel
                      settings={activeSettings}
                      open={isSettingsOpen}
                      onOpenChange={setIsSettingsOpen}
                      onChange={updateActiveSettings}
                    />
                    <ModelSelector selected={activeModelId} onChange={handleModelChange} />

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
                    : <ArrowUp className="moon-send-icon" size={20} />
                  }
                    </button>
                  </div>
                </div>
              </div>

              <p className="moon-footer-hint">Enter — отправить · Shift+Enter — новая строка</p>
            </div>
          </footer>
        </div>
        <ToastViewport toasts={toasts} onDismiss={dismissToast} />
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

  html, body, #root {
    height: 100%;
    min-height: 100%;
    overflow: hidden;
  }

  .moon-app {
    display: grid;
    grid-template-columns: 265px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    font-family: var(--font);
    background: var(--bg-base);
    color: var(--text-primary);
    transition: grid-template-columns 0.12s cubic-bezier(0.22, 1, 0.36, 1), background 0.35s ease, color 0.35s ease;
  }
  .moon-app.sidebar-closed.sidebar-docked {
    grid-template-columns: 56px minmax(0, 1fr);
  }
  .moon-app.sidebar-overlay {
    grid-template-columns: minmax(0, 1fr);
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
    position: relative;
  }
  .moon-app.sidebar-docked .moon-sidebar {
    width: 100%;
    min-width: 0;
  }
  .moon-sidebar.collapsed {
    pointer-events: auto;
  }
  .moon-sidebar-inner {
    width: 265px;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .moon-sidebar.collapsed .moon-sidebar-inner {
    pointer-events: none;
  }
  .moon-sidebar-rail {
    position: absolute;
    inset: 0 auto 0 0;
    width: 56px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 9px;
    padding: 15px 0;
    opacity: 0;
    pointer-events: none;
    transform: translateX(-6px);
    transition: opacity 0.14s ease, transform 0.14s ease;
  }
  .moon-sidebar.collapsed .moon-sidebar-rail {
    opacity: 1;
    pointer-events: auto;
    transform: translateX(0);
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
    overflow: hidden;
  }
  .moon-brand-img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
    object-position: center;
  }
  .moon-rail-btn {
    position: relative;
    padding: 0;
    appearance: none;
    font-family: var(--font);
    cursor: pointer;
    transition: all var(--transition);
  }
  .moon-logo-toggle {
    position: relative;
    padding: 0;
    appearance: none;
    cursor: pointer;
    transition: all var(--transition);
  }
  .moon-logo-toggle-idle,
  .moon-logo-toggle-hover {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.14s ease, transform 0.14s ease;
  }
  .moon-logo-toggle-hover {
    opacity: 0;
    transform: scale(0.72);
  }
  .moon-rail-logo:hover .moon-logo-toggle-idle {
    opacity: 0;
    transform: scale(0.72);
  }
  .moon-rail-logo:hover .moon-logo-toggle-hover {
    opacity: 1;
    transform: scale(1);
  }
  .moon-rail-logo,
  .moon-rail-btn {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .moon-rail-btn {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    box-shadow: 0 8px 18px var(--accent-dim);
  }
  .moon-rail-logo {
    color: var(--accent);
    background: var(--accent-dim);
    border-color: var(--accent);
  }
  .moon-rail-logo:hover {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-dim);
    transform: translateY(-1px);
  }
  .moon-rail-btn:hover {
    color: #fff;
    border-color: var(--accent-hover);
    background: var(--accent-hover);
    transform: translateY(-1px);
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

  .moon-sessions {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 8px;
    min-height: 0;
  }
  .moon-sessions-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 8px 7px;
  }
  .moon-sessions-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--text-muted);
  }
  .moon-sessions-head span {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .moon-history-search {
    height: 34px;
    display: flex; align-items: center; gap: 7px;
    margin: 0 6px 10px;
    padding: 0 9px;
    border-radius: 11px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-base) 76%, var(--bg-elevated));
    color: var(--text-muted);
    transition: all var(--transition);
  }
  .moon-history-search:focus-within {
    border-color: var(--accent);
    color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-dim);
  }
  .moon-history-search input {
    width: 100%;
    min-width: 0;
    border: none;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    background: transparent !important;
    box-shadow: none !important;
    color: var(--text-primary);
    font-family: var(--font);
    font-size: 12.5px;
  }
  .moon-history-search input::-webkit-search-decoration,
  .moon-history-search input::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }
  .moon-history-search input::placeholder { color: var(--text-muted); }
  .moon-session-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .moon-session-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .moon-session-group-title {
    padding: 0 8px 2px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 750;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .moon-session-item {
    display: flex; align-items: center; gap: 7px;
    min-height: 40px;
    padding: 7px 7px 7px 9px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    border: 1px solid transparent;
    transition: all var(--transition);
    position: relative;
    min-width: 0;
  }
  .moon-session-item:hover { background: var(--accent-dim); border-color: var(--border); }
  .moon-session-item.active { background: var(--accent-dim); border-color: var(--accent); }
  .moon-session-item.renaming {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
    cursor: default;
  }
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
  .moon-session-rename {
    flex: 1;
    min-width: 0;
    height: 26px;
    border: none;
    outline: none;
    border-radius: 8px;
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: var(--font);
    font-size: 13px;
    padding: 0 7px;
  }
  .moon-session-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--transition);
  }
  .moon-session-item:hover .moon-session-actions,
  .moon-session-item.active .moon-session-actions,
  .moon-session-item.renaming .moon-session-actions,
  .moon-session-actions:focus-within {
    opacity: 1;
  }
  .moon-session-action {
    width: 18px;
    height: 18px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg-elevated) 72%, transparent);
    color: color-mix(in srgb, var(--text-secondary) 78%, var(--text-primary));
    appearance: none;
    flex-shrink: 0;
    cursor: pointer;
    transition: all var(--transition);
  }
  .moon-session-action svg {
    width: 10px;
    height: 10px;
    min-width: 10px;
    display: block;
    stroke-width: 2.4;
  }
  .moon-session-item.active .moon-session-action {
    color: color-mix(in srgb, var(--accent) 82%, var(--text-primary));
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-surface));
    border-color: color-mix(in srgb, var(--accent) 24%, transparent);
  }
  .moon-session-action:hover {
    color: var(--accent);
    background: var(--accent-dim);
    border-color: color-mix(in srgb, var(--accent) 32%, transparent);
  }
  .moon-session-action.confirm:hover {
    color: var(--green);
    background: color-mix(in srgb, var(--green) 12%, transparent);
  }
  .moon-session-action.danger:hover {
    color: #f87171;
    background: rgba(248,113,113,0.1);
  }
  .theme-light .moon-history-search {
    background: #f4f6f8;
    border-color: #d8dee6;
  }
  .theme-light .moon-history-search:focus-within {
    background: #fff;
  }
  .theme-light .moon-session-action {
    color: #4f46e5;
    background: rgba(99,102,241,0.08);
    border-color: rgba(99,102,241,0.16);
  }
  .theme-light .moon-session-item.active .moon-session-action {
    color: #4338ca;
    background: rgba(99,102,241,0.14);
    border-color: rgba(99,102,241,0.24);
  }
  .theme-light .moon-session-action.danger {
    color: #dc2626;
    background: rgba(248,113,113,0.08);
    border-color: rgba(248,113,113,0.16);
  }
  .moon-sessions-empty {
    margin: 18px 8px 0;
    min-height: 118px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: 14px;
    color: var(--text-muted);
    background: color-mix(in srgb, var(--bg-elevated) 52%, transparent);
  }
  .moon-sessions-empty span {
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 650;
  }
  .moon-sessions-empty small {
    max-width: 170px;
    font-size: 11px;
    line-height: 1.4;
  }

  .moon-confirm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(0,0,0,0.52);
    backdrop-filter: blur(5px);
  }
  .moon-confirm-dialog {
    width: min(410px, 100%);
    border: 1px solid var(--border);
    border-radius: 18px;
    background: var(--bg-elevated);
    box-shadow: 0 24px 70px rgba(0,0,0,0.42);
    padding: 18px;
  }
  .moon-confirm-icon {
    width: 38px; height: 38px;
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    color: #f87171;
    background: rgba(248,113,113,0.1);
    border: 1px solid rgba(248,113,113,0.22);
    margin-bottom: 14px;
  }
  .moon-confirm-copy h2 {
    margin: 0 0 7px;
    font-size: 18px;
    line-height: 1.25;
    letter-spacing: 0;
    color: var(--text-primary);
  }
  .moon-confirm-copy p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13.5px;
    line-height: 1.55;
  }
  .moon-confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
  .moon-confirm-actions button {
    height: 36px;
    border-radius: 10px;
    padding: 0 14px;
    border: 1px solid var(--border);
    font-family: var(--font);
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
    transition: all var(--transition);
  }
  .moon-confirm-cancel {
    background: var(--bg-surface);
    color: var(--text-secondary);
  }
  .moon-confirm-cancel:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
  .moon-confirm-delete {
    background: #ef4444;
    border-color: #ef4444 !important;
    color: #fff;
    box-shadow: 0 10px 24px rgba(239,68,68,0.22);
  }
  .moon-confirm-delete:hover {
    background: #dc2626;
    transform: translateY(-1px);
  }

  .moon-toast-viewport {
    position: fixed;
    right: 18px;
    bottom: 94px;
    z-index: 80;
    width: min(340px, calc(100vw - 28px));
    display: flex;
    flex-direction: column;
    gap: 9px;
    pointer-events: none;
  }
  .moon-toast {
    pointer-events: auto;
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) 24px;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 16px;
    color: var(--text-primary);
    background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
    box-shadow: 0 18px 46px rgba(0,0,0,0.28);
    backdrop-filter: blur(14px);
  }
  .moon-toast-icon {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    background: var(--accent-dim);
    border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .moon-toast.success .moon-toast-icon {
    color: var(--green);
    background: color-mix(in srgb, var(--green) 13%, transparent);
    border-color: color-mix(in srgb, var(--green) 28%, transparent);
  }
  .moon-toast.error .moon-toast-icon {
    color: #f87171;
    background: rgba(248,113,113,0.11);
    border-color: rgba(248,113,113,0.28);
  }
  .moon-toast.warning .moon-toast-icon {
    color: #fbbf24;
    background: rgba(251,191,36,0.12);
    border-color: rgba(251,191,36,0.3);
  }
  .moon-toast-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .moon-toast-copy strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    line-height: 1.25;
    letter-spacing: 0;
  }
  .moon-toast-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
    font-size: 11.5px;
    line-height: 1.25;
  }
  .moon-toast-close {
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    background: transparent;
    cursor: pointer;
    transition: all var(--transition);
  }
  .moon-toast-close:hover {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--text-primary) 8%, transparent);
  }

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
  .moon-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

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

  .moon-icon-btn {
    background: none; border: none; cursor: pointer;
    color: var(--text-secondary); padding: 7px; border-radius: var(--radius-sm);
    display: flex; align-items: center; justify-content: center;
    transition: all var(--transition); flex-shrink: 0;
  }
  .moon-icon-btn:hover { background: var(--accent-dim); color: var(--text-primary); }
  .moon-icon-btn.danger:hover { color: #f87171; background: rgba(248,113,113,0.1); }
  .moon-icon-btn:disabled {
    opacity: 0.38;
    cursor: not-allowed;
    color: var(--text-muted);
    background: transparent;
  }
  .moon-icon-btn:disabled:hover {
    color: var(--text-muted);
    background: transparent;
  }

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
    padding: 6px 10px; border-radius: 999px;
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
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    position: relative;
    padding: 28px 20px;
  }
  .moon-messages-inner {
    max-width: 780px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 22px;
    min-height: 100%;
    padding-bottom: 8px;
  }

  /* ── Empty state ── */
  .moon-empty-state {
    min-height: 100%;
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
    overflow: hidden;
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

  .moon-msg-stack {
    max-width: 78%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  .moon-msg-stack.user { align-items: flex-end; }

  .moon-bubble {
    max-width: 100%;
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

  .moon-msg-actions {
    display: flex;
    flex-wrap: nowrap;
    gap: 4px;
    padding: 0 4px;
    opacity: 0.68;
    transition: opacity var(--transition);
  }
  .moon-msg-row:hover .moon-msg-actions,
  .moon-msg-actions:focus-within {
    opacity: 1;
  }
  .moon-msg-actions.user {
    justify-content: flex-end;
  }
  .moon-msg-action {
    position: relative;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-elevated) 74%, transparent);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .moon-msg-action:hover:not(:disabled) {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: var(--accent-dim);
    transform: translateY(-1px);
  }
  .moon-msg-action.copied {
    color: var(--green);
    border-color: color-mix(in srgb, var(--green) 32%, var(--border));
    background: color-mix(in srgb, var(--green) 12%, transparent);
  }
  .moon-msg-action.danger:hover:not(:disabled) {
    color: #f87171;
    border-color: rgba(248,113,113,0.38);
    background: rgba(248,113,113,0.11);
  }
  .moon-msg-action::after {
    content: attr(data-tooltip);
    position: absolute;
    left: 50%;
    bottom: calc(100% + 8px);
    transform: translate(-50%, 4px);
    padding: 5px 8px;
    border-radius: 8px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-primary);
    box-shadow: 0 10px 28px rgba(0,0,0,0.24);
    font-family: var(--font);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition), transform var(--transition);
    z-index: 12;
  }
  .moon-msg-action::before {
    content: "";
    position: absolute;
    left: 50%;
    bottom: calc(100% + 4px);
    width: 7px;
    height: 7px;
    background: var(--bg-elevated);
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    transform: translate(-50%, 4px) rotate(45deg);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition), transform var(--transition);
    z-index: 11;
  }
  .moon-msg-action:hover:not(:disabled)::after,
  .moon-msg-action:hover:not(:disabled)::before,
  .moon-msg-action:focus-visible:not(:disabled)::after,
  .moon-msg-action:focus-visible:not(:disabled)::before {
    opacity: 1;
    transform: translate(-50%, 0) rotate(0deg);
  }
  .moon-msg-action:hover:not(:disabled)::before,
  .moon-msg-action:focus-visible:not(:disabled)::before {
    transform: translate(-50%, 0) rotate(45deg);
  }
  .moon-msg-action:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    transform: none;
  }

  /* Model tag inside bubble */
  .moon-bubble-model-tag {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
    color: var(--chip-color, var(--accent));
    margin-bottom: 8px;
    opacity: 0.8;
  }
  .moon-bubble-model-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--chip-color, var(--accent)); flex-shrink: 0;
  }

  /* ── Model selector ── */
  .moon-model-selector {
    position: relative;
    flex-shrink: 1;
    min-width: 0;
  }
  .moon-model-trigger {
    display: inline-flex; align-items: center; gap: 5px;
    max-width: 122px;
    height: 32px;
    padding: 0 9px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
    color: var(--text-secondary);
    font-size: 11.5px; font-weight: 650;
    font-family: var(--font);
    cursor: pointer;
    transition: all 0.18s ease;
    white-space: nowrap;
    overflow: hidden;
  }
  .moon-model-trigger:hover,
  .moon-model-trigger.open {
    border-color: var(--chip-color, var(--accent));
    color: var(--chip-color, var(--accent));
    background: color-mix(in srgb, var(--chip-color, var(--accent)) 8%, transparent);
  }
  .moon-model-trigger.open { box-shadow: 0 0 0 3px color-mix(in srgb, var(--chip-color, var(--accent)) 16%, transparent); }
  .moon-model-trigger svg { flex-shrink: 0; transition: transform 0.18s ease; }
  .moon-model-trigger.open svg { transform: rotate(180deg); }
  .moon-model-trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0;
    line-height: 1;
  }
  .moon-model-menu {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    z-index: 20;
    width: min(270px, calc(100vw - 48px));
    padding: 6px;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    box-shadow: 0 18px 45px rgba(0,0,0,0.34);
  }
  .moon-model-option {
    width: 100%;
    display: flex; align-items: center; gap: 8px;
    min-height: 58px;
    padding: 8px 10px;
    border-radius: 12px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--font);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: all 0.16s ease;
  }
  .moon-model-option:hover {
    background: color-mix(in srgb, var(--chip-color, var(--accent)) 9%, transparent);
    color: var(--chip-color, var(--accent));
  }
  .moon-model-option.active {
    background: color-mix(in srgb, var(--chip-color, var(--accent)) 12%, transparent);
    color: var(--chip-color, var(--accent));
    font-weight: 600;
  }
  .moon-model-option-copy {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .moon-model-option svg { flex-shrink: 0; }
  .moon-model-option-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .moon-model-chip-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: currentColor; flex-shrink: 0;
    opacity: 0.7;
  }
  .moon-model-trigger .moon-model-chip-dot,
  .moon-model-option.active .moon-model-chip-dot { opacity: 1; animation: pulse 2s infinite; }
  .moon-model-chip-name { font-weight: 600; }
  .moon-model-chip-tag {
    font-size: 10px; opacity: 0.68; font-weight: 500;
    font-family: var(--font-mono);
  }
  .moon-model-chip-description {
    margin-top: 2px;
    font-size: 10.5px;
    line-height: 1.25;
    color: var(--text-muted);
    white-space: normal;
  }
  .moon-model-option:hover .moon-model-chip-description,
  .moon-model-option.active .moon-model-chip-description {
    color: color-mix(in srgb, var(--chip-color, var(--accent)) 74%, var(--text-secondary));
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
    position: sticky;
    bottom: 0;
    z-index: 12;
  }
  .moon-input-wrap { max-width: 780px; margin: 0 auto; position: relative; }
  .moon-input-box {
    display: flex; flex-direction: column; gap: 4px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    padding: 8px;
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
    width: 100%; background: none; border: none; outline: none; resize: none;
    color: var(--text-primary); font-family: var(--font); font-size: 14px;
    line-height: 1.6; padding: 6px 8px 2px;
    max-height: 200px; overflow-y: auto;
  }
  .moon-textarea::placeholder { color: var(--text-muted); }
  .moon-input-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .moon-input-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .moon-input-side-btn {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); padding: 8px;
    display: flex; align-items: center; justify-content: center;
    border-radius: var(--radius-sm); transition: all var(--transition);
    flex-shrink: 0;
  }
  .moon-input-side-btn:hover { color: var(--accent); background: var(--accent-dim); }
  .moon-input-side-btn.active-voice { color: #f87171; background: rgba(248,113,113,0.1); }
  .moon-input-side-btn.disabled,
  .moon-input-side-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .moon-input-side-btn.disabled:hover,
  .moon-input-side-btn:disabled:hover { color: var(--text-muted); background: none; }
  .moon-bot-settings {
    position: relative;
    flex-shrink: 0;
  }
  .moon-settings-trigger.active {
    color: var(--accent);
    background: var(--accent-dim);
  }
  .moon-settings-panel {
    position: absolute;
    right: 0;
    bottom: calc(100% + 10px);
    z-index: 35;
    width: min(340px, calc(100vw - 34px));
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg-elevated);
    box-shadow: 0 18px 48px rgba(0,0,0,0.38);
  }
  .moon-settings-head {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 750;
  }
  .moon-settings-head button {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .moon-settings-head button:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .moon-settings-field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
  }
  .moon-settings-field.wide { grid-column: 1 / -1; }
  .moon-settings-field span {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 650;
  }
  .moon-settings-field b {
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 650;
  }
  .moon-settings-field textarea {
    min-height: 78px;
    max-height: 130px;
    resize: vertical;
    border: 1px solid var(--border);
    border-radius: 11px;
    outline: none;
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: var(--font);
    font-size: 12px;
    line-height: 1.45;
    padding: 9px;
  }
  .moon-settings-field textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-dim);
  }
  .moon-settings-field input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
  }

  .moon-send-btn {
    width: 36px; height: 36px; border-radius: 50%;
    box-sizing: border-box;
    padding: 0;
    border: none; cursor: pointer; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(180deg, #8b8cff 0%, var(--accent) 100%);
    color: #fff;
    transition: transform var(--transition), filter var(--transition), box-shadow var(--transition), background var(--transition);
    box-shadow: 0 10px 24px color-mix(in srgb, var(--accent) 28%, transparent), inset 0 1px 0 rgba(255,255,255,0.24);
  }
  .moon-send-btn:hover:not(:disabled) {
    filter: brightness(1.08); transform: translateY(-1px) scale(1.04);
    box-shadow: 0 14px 30px color-mix(in srgb, var(--accent) 36%, transparent), inset 0 1px 0 rgba(255,255,255,0.28);
  }
  .moon-send-btn:active:not(:disabled) { transform: scale(0.96); }
  .moon-send-btn:disabled {
    background: color-mix(in srgb, var(--bg-elevated) 92%, white 8%);
    color: color-mix(in srgb, var(--text-muted) 78%, white 22%);
    cursor: default;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
    border: 1px solid color-mix(in srgb, var(--border) 78%, white 22%);
  }
  .moon-send-icon {
    width: 20px; height: 20px; min-width: 20px;
    display: block; stroke-width: 2.8;
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
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid var(--border); margin: 8px 0;
    font-family: var(--font-mono);
  }
  .moon-code-header {
    display: flex; justify-content: space-between; align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 7px 10px 7px 14px; background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
  }
  .moon-code-title {
    min-width: 0;
    display: flex; align-items: center; gap: 7px;
  }
  .moon-code-lang {
    font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--accent);
  }
  .moon-code-auto {
    padding: 1px 4px;
    border-radius: 999px;
    background: var(--accent-dim);
    color: var(--accent);
    font-family: var(--font);
    font-size: 5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    line-height: 1.4;
    text-transform: uppercase;
  }
  .moon-code-actions {
    display: flex; align-items: center; gap: 6px;
    flex-shrink: 0;
  }
  .moon-code-wrap,
  .moon-code-copy {
    display: flex; align-items: center; gap: 5px;
    background: var(--accent-dim);
    border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
    cursor: pointer;
    color: var(--accent);
    font-size: 11px; font-weight: 700; font-family: var(--font);
    padding: 4px 9px; border-radius: 999px; transition: all var(--transition);
  }
  .moon-code-wrap {
    background: color-mix(in srgb, var(--bg-base) 76%, transparent);
    border-color: var(--border);
    color: var(--text-secondary);
  }
  .moon-code-wrap.active {
    color: var(--accent);
    background: var(--accent-dim);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }
  .moon-code-wrap:hover,
  .moon-code-copy:hover {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .moon-code-copy.copied {
    color: var(--green);
    background: color-mix(in srgb, var(--green) 13%, transparent);
    border-color: color-mix(in srgb, var(--green) 32%, transparent);
  }
  .moon-code-pre {
    background: var(--bg-base); padding: 16px; overflow-x: auto;
    font-size: 13px; line-height: 1.65; color: var(--text-primary);
    white-space: pre;
    tab-size: 2;
  }
  .moon-code-pre code {
    min-width: max-content;
    display: block;
  }
  .moon-code-pre.wrapped {
    overflow-x: hidden;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .moon-code-pre.wrapped code {
    min-width: 0;
    white-space: inherit;
  }
  .moon-code-token.comment { color: #7c8798; font-style: italic; }
  .moon-code-token.keyword { color: #a78bfa; font-weight: 700; }
  .moon-code-token.string { color: #34d399; }
  .moon-code-token.key { color: #60a5fa; }
  .moon-code-token.number { color: #fbbf24; }
  .moon-code-token.literal { color: #f87171; font-weight: 650; }
  .moon-code-token.builtin { color: #22d3ee; }
  .moon-code-token.function { color: #93c5fd; }
  .moon-code-token.punctuation { color: color-mix(in srgb, var(--text-secondary) 78%, var(--text-primary)); }
  .theme-light .moon-code-token.comment { color: #6b7280; }
  .theme-light .moon-code-token.keyword { color: #7c3aed; }
  .theme-light .moon-code-token.string { color: #047857; }
  .theme-light .moon-code-token.key { color: #2563eb; }
  .theme-light .moon-code-token.number { color: #b45309; }
  .theme-light .moon-code-token.literal { color: #dc2626; }
  .theme-light .moon-code-token.builtin { color: #0891b2; }
  .theme-light .moon-code-token.function { color: #1d4ed8; }
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
    .moon-app {
      position: relative;
      height: 100svh;
      height: 100dvh;
      min-height: -webkit-fill-available;
      grid-template-rows: minmax(0, 1fr);
    }
    .moon-sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      width: min(80vw, 270px);
      box-shadow: 20px 0 50px rgba(0,0,0,0.35);
      z-index: 22;
    }
    .moon-main { width: 100%; height: 100%; min-height: 0; }
    .moon-header { height: 52px; padding: 0 12px; gap: 7px; }
    .moon-header-left { gap: 7px; min-width: 0; }
    .moon-header-right { gap: 6px; }
    .moon-logo-text { font-size: 15px; }
    .moon-theme-btn { width: 34px; height: 34px; padding: 0; justify-content: center; }
    .moon-theme-btn span, .moon-theme-btn svg:last-child { display: none; }
    .moon-live-badge { padding: 6px 8px; }
    .moon-live-label { display: none; }
    .moon-messages { padding: 16px 12px; }
    .moon-messages-inner { max-width: none; gap: 16px; }
    .moon-empty-state { min-height: 100%; gap: 13px; }
    .moon-empty-state h1 { font-size: 22px; }
    .moon-empty-state p { font-size: 13.5px; }
    .moon-empty-glow { width: 220px; height: 220px; }
    .moon-suggestion-grid { grid-template-columns: 1fr; gap: 7px; }
    .moon-msg-row { gap: 9px; }
    .moon-avatar { width: 30px; height: 30px; border-radius: 9px; }
    .moon-msg-stack { max-width: calc(100% - 39px); }
    .moon-bubble {
      max-width: 100%;
      padding: 11px 13px;
      font-size: 14px;
      border-radius: 16px;
    }
    .moon-msg-actions { opacity: 1; gap: 4px; }
    .moon-msg-action { width: 28px; height: 28px; }
    .moon-footer { padding: 10px 12px 14px; }
    .moon-input-box { border-radius: 18px; padding: 6px; }
    .moon-textarea { max-height: 112px; }
    .moon-input-toolbar { gap: 6px; }
    .moon-send-btn { width: 36px; height: 36px; }
    .moon-send-icon { width: 19px; height: 19px; min-width: 19px; }
    .moon-stop-icon { width: 16px; height: 16px; }
    .moon-scroll-btn { height: 30px; padding: 0 10px; font-size: 11px; }
    .moon-footer-hint { display: none; }
    .moon-settings-panel {
      right: -46px;
      grid-template-columns: 1fr;
      max-height: min(70vh, 440px);
      overflow-y: auto;
    }
    .moon-model-trigger { max-width: 104px; height: 32px; padding: 0 8px; font-size: 11px; }
    .moon-model-menu { width: min(292px, calc(100vw - 24px)); }
    .moon-model-option { min-height: 52px; padding: 8px; }
    .moon-model-option .moon-model-chip-tag { display: none; }
    .moon-model-chip-description { font-size: 10px; line-height: 1.2; }
    .moon-toast-viewport {
      left: 12px;
      right: 12px;
      bottom: 90px;
      width: auto;
    }
    .moon-toast { border-radius: 14px; }
  }

  /* Safe area for notched phones */
  @supports (padding-bottom: env(safe-area-inset-bottom)) {
    .moon-footer {
      padding-bottom: calc(14px + env(safe-area-inset-bottom));
    }
  }
`;
