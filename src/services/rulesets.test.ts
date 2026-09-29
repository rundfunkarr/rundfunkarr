import { afterEach, expect, it, vi } from "vitest";
vi.mock("./ruleset-generator", () => ({ getGeneratedRulesets: vi.fn(async () => []) }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});
it("waits for a due refresh and shares it between concurrent callers", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-29T10:00:00Z"));
  let finishRefresh!: (response: Response) => void;
  const fetchRules = vi
    .fn()
    .mockResolvedValueOnce(Response.json([{ topic: "Old topic", priority: 1 }]))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishRefresh = resolve;
        })
    );
  vi.stubGlobal("fetch", fetchRules);
  const { ensureRulesetsLoaded, getAllTopics } = await import("./rulesets");
  await ensureRulesetsLoaded();
  vi.advanceTimersByTime(3600001);
  let completed = false;
  const first = ensureRulesetsLoaded().then(() => {
    completed = true;
  });
  const second = ensureRulesetsLoaded();
  await Promise.resolve();
  expect(completed).toBe(false);
  expect(fetchRules).toHaveBeenCalledTimes(2);
  finishRefresh(Response.json([{ topic: "New topic", priority: 1 }]));
  await Promise.all([first, second]);
  expect(getAllTopics()).toEqual(["New topic"]);
});
