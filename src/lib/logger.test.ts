import { expect, it } from "vitest";
import { appendLog, readLogs, redactLog, rememberLogSecret } from "./logger";
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
