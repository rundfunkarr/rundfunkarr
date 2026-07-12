import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiResultItem, TmdbMovieData } from "@/types";

// Keep the unit hermetic: no DB, no network, no ruleset store.
vi.mock("@/lib/settings", () => ({
  // null -> defaults kick in: quality "all", minDuration 300s, fuzzy/0.7
  getSetting: vi.fn().mockResolvedValue(null),
  getMinDurationSeconds: vi.fn().mockResolvedValue(300),
}));
vi.mock("@/lib/cache", () => ({
  mediathekCache: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() },
}));
vi.mock("@/lib/fetch-retry", () => ({ fetchWithRetry: vi.fn() }));
// No rulesets -> every API result becomes an "unmatched" item.
vi.mock("./rulesets", () => ({
  ensureRulesetsLoaded: vi.fn().mockResolvedValue(undefined),
  getRulesetsForTopic: vi.fn().mockReturnValue([]),
  getRulesetsForTopicAndTvdbId: vi.fn().mockReturnValue([]),
  getAllTopics: vi.fn().mockReturnValue([]),
  getOrGenerateRulesetForShow: vi.fn().mockResolvedValue(null),
}));
vi.mock("./tmdb", () => ({
  searchMovieByTitle: vi.fn().mockResolvedValue(null),
}));

import {
  fetchMovieSearchByQuery,
  fetchMovieSearchResults,
  fetchSearchResultsByString,
} from "./mediathek";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { mediathekCache } from "@/lib/cache";
import { getMinDurationSeconds } from "@/lib/settings";

const mockedFetch = vi.mocked(fetchWithRetry);
const mockedGetMinDuration = vi.mocked(getMinDurationSeconds);
const mockedCacheSet = vi.mocked(mediathekCache.set);

function makeItem(overrides: Partial<ApiResultItem> = {}): ApiResultItem {
  return {
    channel: "ARD",
    topic: "Irgendeine Sendung",
    title: "Irgendeine Sendung (S01/E03)",
    description: "",
    filmlisteTimestamp: 1_700_000_000,
    duration: 3600,
    size: 1_000_000_000,
    url_website: "https://example.com/show",
    url_video: "https://example.com/show_720.mp4",
    url_video_low: "https://example.com/show_480.mp4",
    url_video_hd: "https://example.com/show_1080.mp4",
    ...overrides,
  };
}

function mockApi(results: ApiResultItem[]): void {
  mockedFetch.mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({ result: { results } }),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetMinDuration.mockResolvedValue(300);
});

describe("fetchSearchResultsByString – generic result gating", () => {
  it("emits NO generic results for a season-only query (no q)", async () => {
    // Regression for tvsearch&season=01 without q: without the gate this
    // returned generic items for every unrelated show whose title contains "S01".
    mockApi([
      makeItem({ topic: "Show A", title: "Show A (S01/E01)" }),
      makeItem({ topic: "Show B", title: "Show B (S01/E02)" }),
    ]);

    const xml = await fetchSearchResultsByString(null, "01", 100, 0);

    expect(xml).toContain('total="0"');
    expect(xml).not.toContain("<item>");
  });

  it("DOES emit generic results for an actual text query (q set)", async () => {
    mockApi([makeItem({ topic: "Markus Lanz", title: "Markus Lanz (S2026/E70)" })]);

    const xml = await fetchSearchResultsByString("Markus Lanz", null, 100, 0);

    expect(xml).not.toContain('total="0"');
    expect(xml).toContain("<item>");
  });

  it("treats a whitespace-only q like an empty query (no generic results)", async () => {
    mockApi([makeItem({ topic: "Show C", title: "Show C (S01/E04)" })]);

    const xml = await fetchSearchResultsByString("   ", "01", 100, 0);

    expect(xml).toContain('total="0"');
    expect(xml).not.toContain("<item>");
  });
});

describe("fetchMovieSearchByQuery – configured minimum duration", () => {
  it("includes movies at the configured boundary and rejects shorter results", async () => {
    mockedGetMinDuration.mockResolvedValue(2700);
    mockApi([
      makeItem({ topic: "Too Short", title: "Documentary", duration: 2699 }),
      makeItem({ topic: "At Boundary", title: "Documentary", duration: 2700 }),
    ]);

    const xml = await fetchMovieSearchByQuery("Documentary", 100, 0);

    expect(xml).toContain("At.Boundary");
    expect(xml).not.toContain("Too.Short");
    expect(mockedCacheSet).toHaveBeenCalledWith(
      expect.stringContaining("movie_query_Documentary__100_0_all_2700"),
      expect.any(Object)
    );
  });
});

describe("fetchMovieSearchResults – configured minimum duration", () => {
  it("applies the configured boundary to TMDB and IMDB-backed searches", async () => {
    mockedGetMinDuration.mockResolvedValue(2700);
    mockApi([
      makeItem({ topic: "Documentary", title: "Documentary", duration: 2699 }),
      makeItem({
        topic: "Documentary",
        title: "Documentary",
        duration: 2700,
        url_video: "https://example.com/boundary_720.mp4",
      }),
    ]);
    const movie: TmdbMovieData = {
      tmdbId: 28,
      imdbId: "tt0000028",
      title: "Documentary",
      germanTitle: "Documentary",
      runtime: 45,
      releaseDate: "2026-07-12",
    };

    const xml = await fetchMovieSearchResults(movie, 100, 0);

    expect(xml).toContain("boundary_720.mp4");
    expect(xml).not.toContain("show_720.mp4");
    expect(mockedCacheSet).toHaveBeenCalledWith(
      expect.stringContaining("movie_28_100_0_all_2700"),
      expect.any(Object)
    );
  });
});
