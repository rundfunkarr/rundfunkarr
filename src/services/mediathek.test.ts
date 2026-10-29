import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiResultItem, TmdbMovieData } from "@/types";

// Keep the unit hermetic: no DB, no network, no ruleset store.
vi.mock("@/lib/settings", () => ({
  // null -> defaults kick in: quality "all", minDuration 300s, fuzzy/0.7
  getSetting: vi.fn().mockResolvedValue(null),
  getMinDurationSeconds: vi.fn().mockResolvedValue(300),
  isSeriesUmlautStrippingEnabled: vi.fn().mockResolvedValue(false),
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
import { getMinDurationSeconds, getSetting } from "@/lib/settings";
import { searchMovieByTitle } from "./tmdb";

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
    json: async () => ({ result: { results } }),
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
  it("passes the broadcaster on in the NZB link", async () => {
    mockedGetMinDuration.mockResolvedValue(0);
    mockApi([makeItem({ topic: "Film", title: "Documentary", channel: "ARTE.DE" })]);
    const xml = await fetchMovieSearchByQuery("Documentary", 100, 0);
    expect(xml).toContain(`metadata=${encodeURIComponent('{"channel":"ARTE.DE"}')}`);
  });
});

describe("fetchMovieSearchByQuery – TMDB IDs", () => {
  const theGeneral: TmdbMovieData = {
    tmdbId: 961,
    imdbId: "tt0017925",
    title: "The General",
    germanTitle: "Der General",
    runtime: 78,
    releaseDate: "1926-12-31",
  };

  // Results are deduplicated by video URL, so every broadcast needs its own.
  function broadcast(slug: string, overrides: Partial<ApiResultItem>): ApiResultItem {
    return makeItem({
      url_website: `https://example.com/${slug}`,
      url_video: `https://example.com/${slug}_720.mp4`,
      url_video_low: `https://example.com/${slug}_480.mp4`,
      url_video_hd: `https://example.com/${slug}_1080.mp4`,
      ...overrides,
    });
  }

  it("attaches the TMDB/IMDB IDs only to results that match the movie", async () => {
    vi.mocked(searchMovieByTitle).mockResolvedValueOnce(theGeneral);
    mockApi([
      broadcast("general", { topic: "Der General", title: "Der General", duration: 4680 }),
      broadcast("mdr", { topic: "MDR um 4", title: "MDR um 4 vom 20.10.2026", duration: 3600 }),
      broadcast("phoenix", { topic: "phoenix vor ort", title: "Pressekonferenz", duration: 3600 }),
    ]);

    const xml = await fetchMovieSearchByQuery("The General 1926", 100, 0);

    expect(searchMovieByTitle).toHaveBeenCalledWith("The General", 1926);
    const items = xml.split("<item>").slice(1);
    const matched = items.filter((i) => i.includes("<title>Der.General."));
    const unrelated = items.filter((i) => !i.includes("<title>Der.General."));
    expect(matched).toHaveLength(3);
    expect(unrelated).toHaveLength(6);
    for (const item of matched) {
      expect(item).toContain('name="tmdbid" value="961"');
      expect(item).toContain('name="imdbid" value="tt0017925"');
    }
    for (const item of unrelated) {
      expect(item).not.toContain('name="tmdbid"');
      expect(item).not.toContain('name="imdbid"');
    }
  });

  it("omits the IDs when no result matches the movie", async () => {
    vi.mocked(searchMovieByTitle).mockResolvedValueOnce(theGeneral);
    mockApi([makeItem({ topic: "MDR um 4", title: "MDR um 4 vom 20.10.2026" })]);

    const xml = await fetchMovieSearchByQuery("The General 1926", 100, 0);

    expect(xml).toContain("<title>MDR.um.4.");
    expect(xml).not.toContain('name="tmdbid"');
    expect(xml).not.toContain('name="imdbid"');
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

it.each(["standard", "high"])("keeps direct movie variants when %s is HLS", async (streaming) => {
  const movie: TmdbMovieData = {
    tmdbId: 123,
    imdbId: null,
    title: "Mixed Movie",
    germanTitle: "Mixed Movie",
    runtime: 60,
    releaseDate: "2026-01-01",
  };
  mockApi([
    makeItem({
      topic: "Mixed Movie",
      title: "Mixed Movie",
      url_video:
        streaming === "standard" ? "https://example.org/720.m3u8" : "https://example.org/720.mp4",
      url_video_hd:
        streaming === "high" ? "https://example.org/1080.m3u8" : "https://example.org/1080.mp4",
      url_video_low: "https://example.org/480.mp4",
    }),
  ]);
  const xml = await fetchMovieSearchResults(movie, 100, 0);
  expect(xml).toContain("480p");
  expect(xml).toContain(streaming === "standard" ? "1080p" : "720p");
  expect(xml).not.toContain(streaming === "standard" ? "720p" : "1080p");
});

it.each(["standard", "high"])(
  "keeps direct movie text-search variants when %s is HLS",
  async (streaming) => {
    mockApi([
      makeItem({
        topic: "Mixed Movie",
        title: "Mixed Movie",
        url_video:
          streaming === "standard" ? "https://example.org/720.m3u8" : "https://example.org/720.mp4",
        url_video_hd:
          streaming === "high" ? "https://example.org/1080.m3u8" : "https://example.org/1080.mp4",
        url_video_low: "https://example.org/480.mp4",
      }),
    ]);
    const xml = await fetchMovieSearchByQuery("Mixed Movie", 100, 0);
    expect(xml).toContain("480p");
    expect(xml).toContain(streaming === "standard" ? "1080p" : "720p");
    expect(xml).not.toContain(streaming === "standard" ? "720p" : "1080p");
  }
);

it("uses a direct low-quality variant for best when higher qualities are HLS", async () => {
  vi.mocked(getSetting).mockImplementation(async (key) =>
    key === "download.quality" ? "best" : null
  );
  try {
    mockApi([
      makeItem({
        url_video: "https://example.org/720.m3u8",
        url_video_hd: "https://example.org/1080.m3u8",
      }),
    ]);
    const xml = await fetchMovieSearchByQuery("Movie", 100, 0);
    expect(xml).toContain("480p");
    expect(xml).not.toContain("720p");
    expect(xml).not.toContain("1080p");
  } finally {
    vi.mocked(getSetting).mockResolvedValue(null);
  }
});
