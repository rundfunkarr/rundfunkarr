import { formatWithOptions } from "node:util";
export type LogLevel = "info" | "warn" | "error" | "debug";
export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  message: string;
}
interface LogState {
  entries: LogEntry[];
  secrets: Set<string>;
  next: number;
  installed: boolean;
}
const shared = globalThis as typeof globalThis & { rundfunkarrLogs?: LogState };
const state = (shared.rundfunkarrLogs ??= {
  entries: [],
  secrets: new Set(),
  next: 1,
  installed: false,
});
export function rememberLogSecret(value: unknown) {
  if (typeof value === "string" && value.length >= 4) {
    state.secrets.add(value);
    if (state.secrets.size > 512) state.secrets.delete(state.secrets.values().next().value!);
  }
}
export function redactLog(text: string): string {
  let result = text;
  for (const secret of [...state.secrets].sort((a, b) => b.length - a.length))
    result = result.split(secret).join("[vertraulich]");
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
    /((?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|consumer[_-]?secret|password|passwd|secret|token|pin)["']?\s*[:=]\s*)(?:["'][^"']*["']|[^\s,;}]+)/gi,
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
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const entry = appendLog(method === "log" ? "info" : method, ...args);
      original(entry.message);
    };
  }
}
