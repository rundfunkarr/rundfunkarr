import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RulesetRegexExecutor } from "./ruleset-regex";

let executor: RulesetRegexExecutor;
beforeEach(() => {
  executor = new RulesetRegexExecutor();
});
afterEach(async () => {
  await executor.close();
});

describe("bounded ruleset regex execution", () => {
  it("preserves JavaScript lookarounds and backreferences", async () => {
    expect(await executor.evaluate("test", "(?<=prefix:)(\\w+)-\\1$", "prefix:ab-ab")).toBe(true);
    expect(await executor.evaluate("test", "(?<=prefix:)(\\w+)-\\1$", "prefix:ab-cd")).toBe(false);
  });

  it("extracts the first capture for episode numbers and the last for title rules", async () => {
    expect(await executor.evaluate("first", "S(\\d+)/E(\\d+)", "S01/E02")).toBe("01");
    expect(await executor.evaluate("last", "S(\\d+)/E(\\d+)", "S01/E02")).toBe("02");
    expect(await executor.evaluate("last", "Der Anfang", "Folge: Der Anfang")).toBe("Der Anfang");
    expect(await executor.evaluate("first", "Der Anfang", "Der Anfang")).toBeNull();
    expect(await executor.evaluate("last", "(a)(b)?", "a")).toBe("");
    expect(await executor.evaluate("first", "(a)?b", "b")).toBeNull();
    expect(await executor.evaluate("last", "(b)", "a")).toBeNull();
  });

  it("keeps malformed community expressions as nonmatches", async () => {
    expect(await executor.evaluate("test", "[", "title")).toBe(false);
    expect(await executor.evaluate("first", "[", "title")).toBeNull();
    expect(await executor.evaluate("last", "[", "title")).toBeNull();
  });

  it.each(["test", "first", "last"] as const)(
    "terminates a runaway %s evaluation, keeps timers responsive and recovers",
    async (mode) => {
      await executor.evaluate("test", "ready", "ready");
      let timerFired = false;
      const timer = setTimeout(() => {
        timerFired = true;
      }, 10);
      try {
        const failed = executor.evaluate(mode, "^(a+)+$", "a".repeat(32) + "!");
        const healthy = executor.evaluate("first", "E(\\d+)", "E02");
        await expect(failed).rejects.toMatchObject({ code: "timeout" });
        expect(timerFired).toBe(true);
        await expect(healthy).resolves.toBe("02");
      } finally {
        clearTimeout(timer);
      }
    }
  );

  it("temporarily rejects a timed-out pattern, including copies already queued", async () => {
    const results = await Promise.allSettled([
      executor.evaluate("test", "^(a+)+$", "a".repeat(32) + "!"),
      executor.evaluate("test", "^(a+)+$", "a"),
      executor.evaluate("test", "^a$", "a"),
    ]);
    expect(results).toMatchObject([
      { status: "rejected", reason: { code: "timeout" } },
      { status: "rejected", reason: { code: "timeout" } },
      { status: "fulfilled", value: true },
    ]);
    await expect(executor.evaluate("last", "^(a+)+$", "a")).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("bounds pending work and rejects overload without losing accepted jobs", async () => {
    await executor.evaluate("test", "ready", "ready");
    const results = await Promise.allSettled([
      executor.evaluate("test", "^(a+)+$", "a".repeat(32) + "!"),
      ...Array.from({ length: 64 }, () => executor.evaluate("test", "^ok$", "ok")),
    ]);
    expect(results[0]).toMatchObject({ status: "rejected", reason: { code: "timeout" } });
    expect(results.slice(1, 64)).toEqual(
      Array.from({ length: 63 }, () => ({ status: "fulfilled", value: true }))
    );
    expect(results[64]).toMatchObject({ status: "rejected", reason: { code: "busy" } });
  });

  it("expires queued jobs instead of retaining a backlog of different slow patterns", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) =>
        executor.evaluate("test", `^(a+)+$(?:${i})?`, "a".repeat(32) + "!")
      )
    );
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(
      results.some((result) => result.status === "rejected" && result.reason.code === "busy")
    ).toBe(true);
    await expect(executor.evaluate("test", "^ok$", "ok")).resolves.toBe(true);
  });

  it.each([
    ["a".repeat(4097), "a"],
    ["a", "a".repeat(65537)],
  ])(
    "rejects oversized expressions and inputs without silently truncating",
    async (pattern, value) => {
      await expect(executor.evaluate("test", pattern, value)).rejects.toMatchObject({
        code: "too-large",
      });
    }
  );

  it("settles active and queued requests on shutdown", async () => {
    await executor.evaluate("test", "ready", "ready");
    const results = Promise.allSettled([
      executor.evaluate("test", "^(a+)+$", "a".repeat(32) + "!"),
      executor.evaluate("test", "ok", "ok"),
    ]);
    await executor.close();
    expect(await results).toMatchObject([
      { status: "rejected", reason: { code: "unavailable" } },
      { status: "rejected", reason: { code: "unavailable" } },
    ]);
    await expect(executor.evaluate("test", "ok", "ok")).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
