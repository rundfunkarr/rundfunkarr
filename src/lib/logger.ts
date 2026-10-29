import { formatWithOptions } from "node:util";
export type LogLevel = "info" | "warn" | "error" | "debug";
export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  message: string;
}
type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";
interface LogState {
  entries: LogEntry[];
  secrets: Set<string>;
  next: number;
  installed: boolean;
  // Unpatched console methods, kept so logger output is not captured twice.
  console?: Record<ConsoleMethod, (...args: unknown[]) => void>;
}
const shared = globalThis as typeof globalThis & { rundfunkarrLogs?: LogState };
const state = (shared.rundfunkarrLogs ??= {
  entries: [],
  secrets: new Set(),
  next: 1,
  installed: false,
});
export function rememberLogSecret(value: unknown) {
  if (typeof value === "string" && value.length > 0) {
    state.secrets.add(value);
    if (state.secrets.size > 512) state.secrets.delete(state.secrets.values().next().value!);
  }
}
export function redactLog(text: string): string {
  let result = text;
  const credentialKeys =
    "authorization|api[_-]?key|admin[_-]?key|access[_-]?token|refresh[_-]?token|consumer[_-]?secret|password|passwd|secret|token|pin";
  for (const secret of [...state.secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= 6) result = result.split(secret).join("[vertraulich]");
    else {
      // Short PINs must not erase timestamps, ports, status codes or item counts.
      const literal = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(
        new RegExp(`(\\b(?:${credentialKeys})["']?\\s+["']?)${literal}(?=$|[\\s"',;}])`, "gi"),
        "$1[vertraulich]"
      );
    }
  }
  result = result.replace(/(?:https?|socks4a?|socks5h?):\/\/[^\s<>"']+/gi, (value) => {
    try {
      const url = new URL(value);
      if (url.username || url.password) {
        url.username = "vertraulich";
        url.password = "";
      }
      if (url.search) url.search = "?vertraulich";
      if (url.hash) url.hash = "#vertraulich";
      return url.toString();
    } catch {
      return "[Adresse ausgeblendet]";
    }
  });
  result = result.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.:-]+/gi, "$1 [vertraulich]");
  result = result.replace(
    new RegExp(`((?:${credentialKeys})["']?\\s*[:=]\\s*)(?:["'][^"']*["']|[^\\s,;}]+)`, "gi"),
    "$1[vertraulich]"
  );
  return result;
}
export function appendLog(level: LogLevel, ...args: unknown[]) {
  const text = redactLog(
    formatWithOptions({ depth: 3, maxArrayLength: 30, maxStringLength: 20000 }, ...args)
  );
  const entry = {
    id: state.next++,
    time: new Date().toISOString(),
    level,
    message: text.slice(0, 5000),
  };
  state.entries.push(entry);
  if (state.entries.length > 500) state.entries.splice(0, state.entries.length - 500);
  return entry;
}
const levelRank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
export const DEFAULT_LOG_LEVEL: LogLevel = "info";

export function parseLogLevel(value: string | undefined): LogLevel | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && Object.hasOwn(levelRank, normalized) ? (normalized as LogLevel) : null;
}

/** Minimum level from LOG_LEVEL; read on every call so tests can switch it. */
export function getLogLevel(): LogLevel {
  return parseLogLevel(process.env.LOG_LEVEL) ?? DEFAULT_LOG_LEVEL;
}

export function isLogLevelEnabled(level: LogLevel) {
  return levelRank[level] >= levelRank[getLogLevel()];
}

const outputMethod: Record<LogLevel, ConsoleMethod> = {
  debug: "debug",
  info: "log",
  warn: "warn",
  error: "error",
};

function writeLog(level: LogLevel, args: unknown[]) {
  if (!isLogLevelEnabled(level)) return;
  const entry = appendLog(level, ...args);
  const method = outputMethod[level];
  (state.console?.[method] ?? console[method])(entry.message);
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Creates a logger that prefixes messages with "[scope]". Methods are bound,
 * so they can be passed directly as callbacks, e.g. `.catch(log.error)`.
 */
export function createLogger(scope?: string): Logger {
  const withScope = (args: unknown[]) => {
    if (!scope) return args;
    const [first, ...rest] = args;
    // Prepending to a string keeps util.format placeholders in the first argument working.
    return typeof first === "string" ? [`[${scope}] ${first}`, ...rest] : [`[${scope}]`, ...args];
  };
  return {
    debug: (...args) => writeLog("debug", withScope(args)),
    info: (...args) => writeLog("info", withScope(args)),
    warn: (...args) => writeLog("warn", withScope(args)),
    error: (...args) => writeLog("error", withScope(args)),
  };
}

/** Unscoped logger for messages without a fixed "[Scope]" prefix. */
export const logger = createLogger();

export function readLogs(level?: string, query = "") {
  const needle = query.toLocaleLowerCase("de");
  return state.entries
    .filter(
      (e) =>
        (!level || level === "all" || e.level === level) &&
        (!needle || e.message.toLocaleLowerCase("de").includes(needle))
    )
    .map((e) => ({ ...e, message: redactLog(e.message) }));
}
export function installLogger() {
  if (state.installed) return;
  state.installed = true;
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = Object.fromEntries(
    methods.map((method) => [method, console[method].bind(console)])
  ) as Record<ConsoleMethod, (...args: unknown[]) => void>;
  state.console = originals;
  // Remaining console calls (Next.js, libraries) share redaction, buffer and level filter.
  for (const method of methods) {
    const level: LogLevel = method === "log" ? "info" : method;
    console[method] = (...args: unknown[]) => {
      if (!isLogLevelEnabled(level)) return;
      const entry = appendLog(level, ...args);
      originals[method](entry.message);
    };
  }
  const configured = process.env.LOG_LEVEL;
  if (configured?.trim() && !parseLogLevel(configured)) {
    createLogger("Logger").warn(
      `LOG_LEVEL=${configured} ignored; allowed: debug, info, warn, error (using ${DEFAULT_LOG_LEVEL})`
    );
  }
}
