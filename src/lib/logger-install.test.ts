import { afterEach, beforeEach, expect, it, vi } from "vitest";

const methods = ["log", "info", "warn", "error", "debug"] as const;
const originals = Object.fromEntries(methods.map((m) => [m, console[m]]));
const shared = globalThis as typeof globalThis & { rundfunkarrLogs?: unknown };

beforeEach(() => {
  // installLogger patches the global console once per process; start from a clean state.
  delete shared.rundfunkarrLogs;
  vi.resetModules();
});

afterEach(() => {
  for (const m of methods) console[m] = originals[m];
  delete shared.rundfunkarrLogs;
  vi.unstubAllEnvs();
});

function stubConsole() {
  return Object.fromEntries(
    methods.map((m) => {
      const fn = vi.fn();
      console[m] = fn;
      return [m, fn];
    })
  ) as Record<(typeof methods)[number], ReturnType<typeof vi.fn>>;
}

it("records logger output once and applies the level to plain console calls", async () => {
  const out = stubConsole();
  vi.stubEnv("LOG_LEVEL", "info");
  const { createLogger, installLogger, readLogs } = await import("./logger");
  installLogger();

  createLogger("Install").info("summary");
  createLogger("Install").debug("detail");
  console.debug("library detail");
  console.log("library info");

  expect(out.log).toHaveBeenCalledWith("[Install] summary");
  expect(out.log).toHaveBeenCalledWith("library info");
  expect(out.debug).not.toHaveBeenCalled();
  expect(readLogs().map((e) => `${e.level} ${e.message}`)).toEqual([
    "info [Install] summary",
    "info library info",
  ]);
});

it("warns once about an invalid LOG_LEVEL", async () => {
  const out = stubConsole();
  vi.stubEnv("LOG_LEVEL", "loud");
  const { installLogger, readLogs } = await import("./logger");
  installLogger();
  installLogger();
  expect(out.warn).toHaveBeenCalledTimes(1);
  expect(out.warn.mock.calls[0][0]).toContain("[Logger] LOG_LEVEL=loud ignored");
  expect(readLogs("warn")).toHaveLength(1);
});
