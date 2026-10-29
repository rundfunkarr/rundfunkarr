import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchMulti, findUnique, findMany, create, upsert } = vi.hoisted(() => ({
  searchMulti: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("./tmdb", () => ({ searchMulti }));
vi.mock("@/lib/db", () => ({
  prisma: { topicCategory: { findUnique, findMany, create, upsert } },
}));

import {
  getCachedCategoriesForTopics,
  getCategoriesForTopics,
  getCategoryForTopic,
} from "./category";

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
  findMany.mockResolvedValue([]);
});

describe("getCategoryForTopic", () => {
  it("returns unknown for an empty topic without touching database or TMDB", async () => {
    expect(await getCategoryForTopic("")).toBe("unknown");
    expect(findUnique).not.toHaveBeenCalled();
    expect(searchMulti).not.toHaveBeenCalled();
  });

  it("uses the cached category", async () => {
    findUnique.mockResolvedValue({ topic: "Tatort", category: "tv" });

    expect(await getCategoryForTopic("Tatort")).toBe("tv");
    expect(searchMulti).not.toHaveBeenCalled();
  });

  it("asks TMDB on a cache miss and stores the answer, including unknown results", async () => {
    searchMulti.mockResolvedValue({ mediaType: "unknown", tmdbId: null });

    expect(await getCategoryForTopic("Kulturzeit")).toBe("unknown");
    expect(create).toHaveBeenCalledWith({
      data: { topic: "Kulturzeit", category: "unknown", tmdbId: null },
    });
  });
});

describe("batch category lookups", () => {
  it("reads cached categories in one query, ignoring empty and duplicate topics", async () => {
    findMany.mockResolvedValue([{ topic: "Tatort", category: "tv" }]);

    const result = await getCachedCategoriesForTopics(["Tatort", "", "Tatort", "Das Boot"]);

    expect(findMany).toHaveBeenCalledWith({ where: { topic: { in: ["Tatort", "Das Boot"] } } });
    expect([...result]).toEqual([["Tatort", "tv"]]);
    expect(searchMulti).not.toHaveBeenCalled();
  });

  it("skips the database entirely for an empty topic list", async () => {
    expect((await getCachedCategoriesForTopics(["", ""])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("resolves only uncached topics via TMDB and upserts them", async () => {
    findMany.mockResolvedValue([{ topic: "Tatort", category: "tv" }]);
    searchMulti.mockImplementation(async (topic: string) =>
      topic === "Das Boot"
        ? { mediaType: "movie", tmdbId: 387 }
        : { mediaType: "unknown", tmdbId: null }
    );

    const result = await getCategoriesForTopics(["Tatort", "Das Boot", "Das Boot", "Kulturzeit"]);

    expect(Object.fromEntries(result)).toEqual({
      Tatort: "tv",
      "Das Boot": "movie",
      Kulturzeit: "unknown",
    });
    expect(searchMulti).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith({
      where: { topic: "Das Boot" },
      update: {},
      create: { topic: "Das Boot", category: "movie", tmdbId: 387 },
    });
  });
});
