import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendLog,
  createLogger,
  getLogLevel,
  logger,
  parseLogLevel,
  readLogs,
  redactLog,
  rememberLogSecret,
} from "./logger";
it("entfernt gespeicherte Zugangsdaten, Bearer-Header, URL-Parameter und Proxy-Passwörter", () => {
  rememberLogSecret("gespeicherter-geheimer-wert");
  const text = redactLog(
    'Fehler gespeicherter-geheimer-wert Authorization: Bearer abcdef123 api_key="test-key" https://user:pass@host/api?secret=abc#token socks5://proxyuser:proxypass@proxy:1080'
  );
  for (const secret of [
    "gespeicherter-geheimer-wert",
    "abcdef123",
    "test-key",
    "pass@",
    "secret=abc",
    "proxypass",
    "proxyuser",
  ])
    expect(text).not.toContain(secret);
  expect(text).toContain("vertraulich");
});
it("begrenzt den Speicher und filtert bereits bereinigte Einträge", () => {
  for (let i = 0; i < 505; i++) appendLog(i % 2 ? "info" : "error", `Puffer-Test ${i}`);
  const all = readLogs();
  expect(all).toHaveLength(500);
  expect(all[0].message).toBe("Puffer-Test 5");
  expect(readLogs("error", "Puffer-Test 50").map((x) => x.message)).toEqual([
    "Puffer-Test 50",
    "Puffer-Test 500",
    "Puffer-Test 502",
    "Puffer-Test 504",
  ]);
  appendLog("error", "x".repeat(6000));
  expect(readLogs().at(-1)?.message).toHaveLength(5000);
});
it("bereinigt auch strukturierte Fehlermeldungen und später bekannte Werte", () => {
  appendLog("warn", { apiKey: "geheim-123", Authorization: "Bearer test-token" });
  expect(readLogs().at(-1)?.message).not.toContain("geheim-123");
  expect(readLogs().at(-1)?.message).not.toContain("test-token");
  appendLog("info", "nachtraeglich-vertraulich");
  rememberLogSecret("nachtraeglich-vertraulich");
  expect(readLogs().at(-1)?.message).toBe("[vertraulich]");
});

it("blendet auch kurze gespeicherte PINs aus", () => {
  rememberLogSecret("29");
  expect(redactLog("Verwendete PIN 29")).not.toContain("29");
});

it("preserves unrelated numbers when a short PIN is configured", () => {
  rememberLogSecret("29");
  const message = "2026-10-29T12:29:00Z HTTP 429 port 8929 count 29 bytes 12900";
  expect(redactLog(message)).toBe(message);
  appendLog("info", message);
  expect(readLogs().at(-1)?.message).toBe(message);
});

it.each([
  ["PIN 29; port 8929", "PIN [vertraulich]; port 8929"],
  ['PIN "29"; count 29', 'PIN "[vertraulich]"; count 29'],
  ["pin=29; HTTP 429", "pin=[vertraulich]; HTTP 429"],
  ['{"api.tvdb.pin":"29","count":29}', '{"api.tvdb.pin":[vertraulich],"count":29}'],
])("redacts a short PIN only in its credential context: %s", (message, expected) => {
  rememberLogSecret("29");
  expect(redactLog(message)).toBe(expected);
});

it("treats short secrets as literal values and preserves global masking of long secrets", () => {
  rememberLogSecret("a+b");
  rememberLogSecret("long-credential-value");
  expect(redactLog("token a+b; expression a+b; long-credential-value")).toBe(
    "token [vertraulich]; expression a+b; [vertraulich]"
  );
});

it("redacts admin credentials even before their values have been registered", () => {
  expect(redactLog("X-RundfunkArr-Admin-Key: sensitive-admin-value")).not.toContain(
    "sensitive-admin-value"
  );
  expect(redactLog("DIAGNOSTICS_ADMIN_KEY=another-sensitive-value")).not.toContain(
    "another-sensitive-value"
  );
});

describe("log levels", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads LOG_LEVEL case-insensitively and falls back to info for invalid values", () => {
    vi.stubEnv("LOG_LEVEL", "");
    expect(getLogLevel()).toBe("info");
    vi.stubEnv("LOG_LEVEL", " DEBUG ");
    expect(getLogLevel()).toBe("debug");
    vi.stubEnv("LOG_LEVEL", "verbose");
    expect(getLogLevel()).toBe("info");
    expect(parseLogLevel("warn")).toBe("warn");
    expect(parseLogLevel("constructor")).toBeNull();
  });

  it("drops messages below the configured level from output and buffer", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const scoped = createLogger("LevelTest");
    vi.stubEnv("LOG_LEVEL", "info");
    scoped.debug("hidden detail");
    scoped.info("visible summary");
    expect(debug).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[LevelTest] visible summary");
    expect(readLogs("all", "hidden detail")).toHaveLength(0);

    vi.stubEnv("LOG_LEVEL", "debug");
    scoped.debug("shown detail");
    expect(debug).toHaveBeenCalledWith("[LevelTest] shown detail");
    expect(readLogs("debug", "shown detail")).toHaveLength(1);

    vi.stubEnv("LOG_LEVEL", "error");
    scoped.info("muted summary");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("prefixes the scope, keeps format placeholders and redacts output", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const scoped = createLogger("Scope");
    scoped.warn("%d items via %s", 3, "https://host/api?apikey=abc123");
    expect(warn).toHaveBeenCalledWith("[Scope] 3 items via https://host/api?vertraulich");
    expect(readLogs("warn").at(-1)?.message).toBe(
      "[Scope] 3 items via https://host/api?vertraulich"
    );

    // Methods are bound, so they can be passed as promise callbacks.
    const failure = new Error("boom");
    [failure].forEach(scoped.error);
    expect(error.mock.calls.at(-1)?.[0]).toMatch(/^\[Scope\] Error: boom\n\s+at /);
    logger.error({ token: "abc" });
    expect(error.mock.calls.at(-1)?.[0]).toBe("{ token: [vertraulich] }");
  });
});
