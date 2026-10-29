import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, findMany } = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { config: { findUnique, findMany } } }));

import {
  clearSettingsCache,
  getSetting,
  getSettings,
  isSeriesUmlautStrippingEnabled,
} from "./settings";

beforeEach(() => {
  clearSettingsCache();
  findUnique.mockReset();
  findMany.mockReset();
});

describe("getSetting", () => {
  it("caches found values for a minute", async () => {
    findUnique.mockResolvedValue({ key: "a", value: "1" });

    expect(await getSetting("a")).toBe("1");
    expect(await getSetting("a")).toBe("1");
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("caches missing keys so repeated lookups don't query the database", async () => {
    findUnique.mockResolvedValue(null);

    expect(await getSetting("missing")).toBeNull();
    expect(await getSetting("missing")).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("reads a key again after the cache is cleared, e.g. once it was saved", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ key: "late", value: "set" });

    expect(await getSetting("late")).toBeNull();
    clearSettingsCache();

    expect(await getSetting("late")).toBe("set");
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("re-reads a cached miss once the minute has passed", async () => {
    vi.useFakeTimers();
    try {
      findUnique.mockResolvedValue(null);
      await getSetting("missing");
      vi.advanceTimersByTime(60 * 1000);

      await getSetting("missing");
      expect(findUnique).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getSettings", () => {
  it("fetches only uncached keys in one query and reports missing keys as null", async () => {
    findUnique.mockResolvedValue({ key: "api.tvdb.key", value: "cached" });
    await getSetting("api.tvdb.key");
    findMany.mockResolvedValue([{ key: "api.tmdb.key", value: "" }]);

    const result = await getSettings(["api.tvdb.key", "api.tmdb.key", "api.unknown"]);

    expect(result).toEqual({ "api.tvdb.key": "cached", "api.tmdb.key": "", "api.unknown": null });
    expect(findMany).toHaveBeenCalledWith({
      where: { key: { in: ["api.tmdb.key", "api.unknown"] } },
    });
  });

  it("caches empty strings so they are not re-read", async () => {
    findMany.mockResolvedValue([{ key: "x", value: "" }]);
    await getSettings(["x"]);

    expect(await getSettings(["x"])).toEqual({ x: "" });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("caches missing keys and shares them with getSetting", async () => {
    findMany.mockResolvedValue([]);

    expect(await getSettings(["missing"])).toEqual({ missing: null });
    expect(await getSettings(["missing"])).toEqual({ missing: null });
    expect(await getSetting("missing")).toBeNull();

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("serves keys missed by getSetting without querying them again", async () => {
    findUnique.mockResolvedValue(null);
    await getSetting("missing");

    expect(await getSettings(["missing"])).toEqual({ missing: null });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("does not query the database when every key is cached", async () => {
    findMany.mockResolvedValue([{ key: "x", value: "1" }]);
    await getSettings(["x"]);
    findMany.mockClear();

    await getSettings(["x"]);

    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("isSeriesUmlautStrippingEnabled", () => {
  it.each([
    ["true", true],
    ["false", false],
    [null, false],
  ])("is %s -> %s (opt-in)", async (value, expected) => {
    findUnique.mockResolvedValue(value === null ? null : { value });

    expect(await isSeriesUmlautStrippingEnabled()).toBe(expected);
  });
});
