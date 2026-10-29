import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { config: { findMany } } }));

import {
  clearTTLCache,
  getMetadataTTL,
  getSearchTTL,
  initCacheTTL,
  mediathekCache,
  rulesetsCache,
  tvdbCache,
} from "./cache";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  clearTTLCache();
  findMany.mockReset();
  mediathekCache.clear();
  tvdbCache.clear();
  rulesetsCache.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TTL settings", () => {
  it("uses one hour for searches and one day for metadata by default", () => {
    expect(getSearchTTL()).toBe(3600);
    expect(getMetadataTTL()).toBe(86400);
  });

  it("loads configured TTLs from the database", async () => {
    findMany.mockResolvedValue([
      { key: "cache.ttl.search", value: "120" },
      { key: "cache.ttl.metadata", value: "0" },
    ]);

    await initCacheTTL();

    expect(getSearchTTL()).toBe(120);
    expect(getMetadataTTL()).toBe(0);
  });

  it("falls back to defaults for invalid or negative values", async () => {
    findMany.mockResolvedValue([
      { key: "cache.ttl.search", value: "abc" },
      { key: "cache.ttl.metadata", value: "-5" },
    ]);

    await initCacheTTL();

    expect(getSearchTTL()).toBe(3600);
    expect(getMetadataTTL()).toBe(86400);
  });

  it("only re-reads the database once the one-minute settings cache has expired", async () => {
    findMany.mockResolvedValue([{ key: "cache.ttl.search", value: "60" }]);
    await initCacheTTL();
    findMany.mockResolvedValue([{ key: "cache.ttl.search", value: "90" }]);

    await initCacheTTL();
    expect(getSearchTTL()).toBe(60);
    expect(findMany).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    await initCacheTTL();
    expect(getSearchTTL()).toBe(90);
  });

  it("keeps the previous values when the database is unavailable", async () => {
    findMany.mockResolvedValueOnce([{ key: "cache.ttl.search", value: "42" }]);
    await initCacheTTL();
    vi.advanceTimersByTime(60_001);
    findMany.mockRejectedValueOnce(new Error("database locked"));

    await initCacheTTL();

    expect(getSearchTTL()).toBe(42);
  });

  it("uses defaults when the very first read fails", async () => {
    findMany.mockRejectedValue(new Error("database locked"));

    await initCacheTTL();

    expect(getSearchTTL()).toBe(3600);
    expect(getMetadataTTL()).toBe(86400);
  });
});

describe("dynamic TTL caches", () => {
  it("expires entries after the TTL that was active when they were stored", async () => {
    findMany.mockResolvedValue([{ key: "cache.ttl.search", value: "10" }]);
    await initCacheTTL();

    mediathekCache.set("tatort", { hits: 3 });
    vi.advanceTimersByTime(10_000);
    expect(mediathekCache.get("tatort")).toEqual({ hits: 3 });

    vi.advanceTimersByTime(1);
    expect(mediathekCache.get("tatort")).toBeUndefined();
  });

  it("supports delete and clear", () => {
    tvdbCache.set("a", { id: 1 });
    tvdbCache.set("b", { id: 2 });

    tvdbCache.delete("a");
    expect(tvdbCache.get("a")).toBeUndefined();
    expect(tvdbCache.get("b")).toEqual({ id: 2 });

    tvdbCache.clear();
    expect(tvdbCache.get("b")).toBeUndefined();
  });

  it("evicts the least recently used entry when full", () => {
    for (let i = 0; i < 500; i++) mediathekCache.set(`k${i}`, { i });
    // Touch the oldest entry so k1 becomes the eviction candidate.
    expect(mediathekCache.get("k0")).toEqual({ i: 0 });

    mediathekCache.set("k500", { i: 500 });

    expect(mediathekCache.get("k0")).toEqual({ i: 0 });
    expect(mediathekCache.get("k1")).toBeUndefined();
  });
});
