import { beforeEach, describe, expect, it, vi } from "vitest";
import { tvdbCache } from "@/lib/cache";
import {
  getMovieInfoByImdbId,
  getMovieInfoByTmdbId,
  getShowInfoByTvdbId,
  searchMovieByTitle,
  searchMulti,
} from "./tmdb";

const { fetchWithRetry, getSetting, findUnique, txCreateSeries, txCreateEpisode, transaction } =
  vi.hoisted(() => ({
    fetchWithRetry: vi.fn(),
    getSetting: vi.fn(),
    findUnique: vi.fn(),
    txCreateSeries: vi.fn(),
    txCreateEpisode: vi.fn(),
    transaction: vi.fn(),
  }));

vi.mock("@/lib/fetch-retry", () => ({ fetchWithRetry }));
vi.mock("@/lib/settings", () => ({ getSetting }));
vi.mock("@/lib/db", () => ({
  prisma: { tvdbSeries: { findUnique }, $transaction: transaction },
}));

const API = "https://api.themoviedb.org/3";
const JWT = "eyJhbGciOiJIUzI1NiJ9.test";
let replies: Map<string, () => Response>;

function reply(url: string, body: unknown, status = 200) {
  replies.set(url, () => Response.json(body, { status }));
}

beforeEach(() => {
  vi.clearAllMocks();
  tvdbCache.clear();
  getSetting.mockResolvedValue("plain-key");
  findUnique.mockResolvedValue(null);
  transaction.mockImplementation(async (callback) =>
    callback({
      tvdbSeries: { deleteMany: vi.fn(), create: txCreateSeries },
      tvdbEpisode: { deleteMany: vi.fn(), create: txCreateEpisode },
    })
  );
  replies = new Map();
  fetchWithRetry.mockImplementation(async (url: string) => {
    const handler = replies.get(url);
    if (!handler) throw new Error(`Unexpected request: ${url}`);
    return handler();
  });
});

describe("TMDB authentication", () => {
  it("appends a classic v3 API key as query parameter without auth headers", async () => {
    reply(`${API}/movie/42?api_key=plain-key`, { id: 42, title: "T", original_title: "T" });
    reply(`${API}/movie/42?language=de-DE&api_key=plain-key`, { id: 42, title: "T" });

    await getMovieInfoByTmdbId(42);

    expect(fetchWithRetry).toHaveBeenCalledWith(`${API}/movie/42?api_key=plain-key`, {
      headers: {},
    });
  });

  it("sends a v4 read access token (JWT) as bearer header and keeps it out of the URL", async () => {
    getSetting.mockResolvedValue(JWT);
    reply(`${API}/movie/42`, { id: 42, title: "T", original_title: "T" });
    reply(`${API}/movie/42?language=de-DE`, { id: 42, title: "T" });

    await getMovieInfoByTmdbId(42);

    for (const [url, init] of fetchWithRetry.mock.calls) {
      expect(url).not.toContain(JWT);
      expect(init.headers).toEqual({
        Authorization: `Bearer ${JWT}`,
        "Content-Type": "application/json",
      });
    }
  });

  it("returns null for every lookup without a configured key and does not hit the network", async () => {
    getSetting.mockResolvedValue(null);

    expect(await getShowInfoByTvdbId(1)).toBeNull();
    expect(await getMovieInfoByTmdbId(1)).toBeNull();
    expect(await getMovieInfoByImdbId("tt1")).toBeNull();
    expect(await searchMovieByTitle("Tatort")).toBeNull();
    expect(await searchMulti("Tatort")).toEqual({ mediaType: "unknown", tmdbId: null });
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });
});

describe("getShowInfoByTvdbId", () => {
  const find = `${API}/find/79890?external_source=tvdb_id&api_key=plain-key`;
  const details = `${API}/tv/555?append_to_response=translations&api_key=plain-key`;
  const season = (n: number) => `${API}/tv/555/season/${n}?language=de-DE&api_key=plain-key`;

  function stubShow(overrides: Record<string, unknown> = {}) {
    reply(find, { tv_results: [{ id: 555, name: "Murder in the Mountains" }] });
    reply(details, {
      id: 555,
      name: "Murder in the Mountains",
      original_name: "SOKO Kitzbühel",
      seasons: [
        { season_number: 0, episode_count: 3 },
        { season_number: 1, episode_count: 2 },
        { season_number: 2, episode_count: 1 },
      ],
      ...overrides,
    });
    reply(season(1), {
      episodes: [
        {
          id: 1,
          name: "Tod am Hahnenkamm",
          episode_number: 1,
          season_number: 1,
          air_date: "2001-01-09",
          runtime: 45,
        },
        { id: 2, name: "", episode_number: 2, season_number: 1, air_date: null, runtime: null },
      ],
    });
    reply(season(2), {
      episodes: [
        { id: 3, name: "Lawine", episode_number: 1, season_number: 2, air_date: "2002-02-02" },
      ],
    });
  }

  it("falls back to original_name instead of the English title when no German translation exists", async () => {
    stubShow();

    const result = await getShowInfoByTvdbId(79890);

    expect(result?.name).toBe("Murder in the Mountains");
    expect(result?.germanName).toBe("SOKO Kitzbühel");
  });

  it("prefers a populated German translation over original_name", async () => {
    stubShow({
      translations: {
        translations: [
          { iso_639_1: "en", data: { name: "Murder in the Mountains" } },
          { iso_639_1: "de", data: { name: "SOKO Kitzbühel (DE)" } },
        ],
      },
    });

    expect((await getShowInfoByTvdbId(79890))?.germanName).toBe("SOKO Kitzbühel (DE)");
  });

  it("ignores empty German translations", async () => {
    stubShow({ translations: { translations: [{ iso_639_1: "de", data: { name: "" } }] } });

    expect((await getShowInfoByTvdbId(79890))?.germanName).toBe("SOKO Kitzbühel");
  });

  it("skips specials (season 0), maps episodes and persists them in a single transaction", async () => {
    stubShow();

    const result = await getShowInfoByTvdbId(79890);

    expect(fetchWithRetry).not.toHaveBeenCalledWith(season(0), expect.anything());
    expect(result?.episodes).toEqual([
      {
        name: "Tod am Hahnenkamm",
        aired: new Date("2001-01-09"),
        runtime: 45,
        seasonNumber: 1,
        episodeNumber: 1,
      },
      { name: "", aired: null, runtime: null, seasonNumber: 1, episodeNumber: 2 },
      {
        name: "Lawine",
        aired: new Date("2002-02-02"),
        runtime: null,
        seasonNumber: 2,
        episodeNumber: 1,
      },
    ]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txCreateSeries).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 79890, germanName: "SOKO Kitzbühel", aliases: "[]" }),
    });
    expect(txCreateEpisode).toHaveBeenCalledTimes(3);
  });

  it("keeps the other seasons when a single season request fails", async () => {
    stubShow();
    replies.set(season(1), () => {
      throw new Error("socket hang up");
    });

    const result = await getShowInfoByTvdbId(79890);

    expect(result?.germanName).toBe("SOKO Kitzbühel");
    expect(result?.episodes.map((e) => e.name)).toEqual(["Lawine"]);
  });

  it("skips seasons TMDB answers with an error status", async () => {
    stubShow();
    reply(season(2), {}, 500);

    const result = await getShowInfoByTvdbId(79890);

    expect(result?.episodes.map((e) => e.seasonNumber)).toEqual([1, 1]);
  });

  it("serves repeated lookups from the memory cache", async () => {
    stubShow();

    await getShowInfoByTvdbId(79890);
    fetchWithRetry.mockClear();
    const cached = await getShowInfoByTvdbId(79890);

    expect(cached?.germanName).toBe("SOKO Kitzbühel");
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("uses a fresh database entry without contacting TMDB", async () => {
    findUnique.mockResolvedValue({
      id: 79890,
      name: "Murder in the Mountains",
      germanName: "SOKO Kitzbühel",
      aliases: JSON.stringify(["SOKO K"]),
      expiresAt: new Date(Date.now() + 60_000),
      episodes: [{ name: null, aired: null, runtime: 45, seasonNumber: 1, episodeNumber: 1 }],
    });

    const result = await getShowInfoByTvdbId(79890);

    expect(fetchWithRetry).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: 79890,
      name: "Murder in the Mountains",
      germanName: "SOKO Kitzbühel",
      aliases: ["SOKO K"],
      episodes: [{ name: "", aired: null, runtime: 45, seasonNumber: 1, episodeNumber: 1 }],
    });
  });

  it("refetches when the database entry has expired", async () => {
    findUnique.mockResolvedValue({
      id: 79890,
      name: "stale",
      germanName: "stale",
      aliases: null,
      expiresAt: new Date(Date.now() - 1),
      episodes: [],
    });
    stubShow();

    expect((await getShowInfoByTvdbId(79890))?.germanName).toBe("SOKO Kitzbühel");
  });

  it("returns null when TMDB knows no show for the TVDB id or a request fails", async () => {
    reply(find, { tv_results: [] });
    expect(await getShowInfoByTvdbId(79890)).toBeNull();

    reply(find, {}, 401);
    expect(await getShowInfoByTvdbId(79890)).toBeNull();

    reply(find, { tv_results: [{ id: 555, name: "X" }] });
    reply(details, {}, 404);
    expect(await getShowInfoByTvdbId(79890)).toBeNull();

    replies.set(find, () => {
      throw new Error("offline");
    });
    expect(await getShowInfoByTvdbId(79890)).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("movie lookups", () => {
  function stubMovie(id: number, german: unknown = { id, title: "Das Boot" }, germanStatus = 200) {
    reply(`${API}/movie/${id}?api_key=plain-key`, {
      id,
      imdb_id: "tt0082096",
      title: "The Boat",
      original_title: "Das Boot",
      runtime: 149,
      release_date: "1981-09-17",
    });
    reply(`${API}/movie/${id}?language=de-DE&api_key=plain-key`, german, germanStatus);
  }

  it("combines original details with the German title", async () => {
    stubMovie(387);

    expect(await getMovieInfoByTmdbId(387)).toEqual({
      tmdbId: 387,
      imdbId: "tt0082096",
      title: "Das Boot",
      germanTitle: "Das Boot",
      runtime: 149,
      releaseDate: "1981-09-17",
    });
  });

  it("falls back to the default title when the German request fails or is empty", async () => {
    stubMovie(387, {}, 500);
    expect((await getMovieInfoByTmdbId(387))?.germanTitle).toBe("The Boat");

    tvdbCache.clear();
    stubMovie(387, { id: 387, title: "" });
    expect((await getMovieInfoByTmdbId(387))?.germanTitle).toBe("The Boat");
  });

  it("returns null for an invalid id, failed details or a network error", async () => {
    expect(await getMovieInfoByTmdbId(0)).toBeNull();

    reply(`${API}/movie/1?api_key=plain-key`, {}, 404);
    expect(await getMovieInfoByTmdbId(1)).toBeNull();

    replies.set(`${API}/movie/2?api_key=plain-key`, () => {
      throw new Error("offline");
    });
    expect(await getMovieInfoByTmdbId(2)).toBeNull();
  });

  it("caches movie details", async () => {
    stubMovie(387);
    await getMovieInfoByTmdbId(387);
    fetchWithRetry.mockClear();

    expect((await getMovieInfoByTmdbId(387))?.title).toBe("Das Boot");
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("searches by title with an URL-encoded query and optional year", async () => {
    const url = `${API}/search/movie?query=Die%20H%C3%B6hle%20%26%20mehr&language=de-DE&api_key=plain-key&year=1981`;
    reply(url, {
      results: [
        { id: 387, title: "Das Boot" },
        { id: 9, title: "Other" },
      ],
    });
    stubMovie(387);

    const result = await searchMovieByTitle("Die Höhle & mehr", 1981);

    expect(result?.tmdbId).toBe(387);
    fetchWithRetry.mockClear();
    expect((await searchMovieByTitle("Die Höhle & mehr", 1981))?.tmdbId).toBe(387);
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("returns null for empty titles, empty results and failed searches", async () => {
    expect(await searchMovieByTitle("")).toBeNull();

    reply(`${API}/search/movie?query=Nix&language=de-DE&api_key=plain-key`, { results: [] });
    expect(await searchMovieByTitle("Nix")).toBeNull();

    reply(`${API}/search/movie?query=Kaputt&language=de-DE&api_key=plain-key`, {}, 503);
    expect(await searchMovieByTitle("Kaputt")).toBeNull();

    replies.set(`${API}/search/movie?query=Offline&language=de-DE&api_key=plain-key`, () => {
      throw new Error("offline");
    });
    expect(await searchMovieByTitle("Offline")).toBeNull();
  });

  it("resolves IMDB ids through the find endpoint and caches the result", async () => {
    reply(`${API}/find/tt0082096?external_source=imdb_id&api_key=plain-key`, {
      movie_results: [{ id: 387 }],
    });
    stubMovie(387);

    expect((await getMovieInfoByImdbId("tt0082096"))?.tmdbId).toBe(387);
    fetchWithRetry.mockClear();
    expect((await getMovieInfoByImdbId("tt0082096"))?.tmdbId).toBe(387);
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("returns null for unknown or failing IMDB lookups", async () => {
    expect(await getMovieInfoByImdbId("")).toBeNull();

    reply(`${API}/find/tt1?external_source=imdb_id&api_key=plain-key`, { movie_results: [] });
    expect(await getMovieInfoByImdbId("tt1")).toBeNull();

    reply(`${API}/find/tt2?external_source=imdb_id&api_key=plain-key`, {}, 500);
    expect(await getMovieInfoByImdbId("tt2")).toBeNull();

    replies.set(`${API}/find/tt3?external_source=imdb_id&api_key=plain-key`, () => {
      throw new Error("offline");
    });
    expect(await getMovieInfoByImdbId("tt3")).toBeNull();
  });
});

describe("searchMulti", () => {
  const url = (q: string) =>
    `${API}/search/multi?query=${encodeURIComponent(q)}&language=de-DE&api_key=plain-key`;

  it("skips person results and reports the first movie or TV hit", async () => {
    reply(url("Tatort"), {
      results: [
        { id: 1, media_type: "person", name: "Til Schweiger" },
        { id: 2, media_type: "tv", name: "Tatort" },
        { id: 3, media_type: "movie", title: "Tatort: Der Film" },
      ],
    });

    expect(await searchMulti("Tatort")).toEqual({ mediaType: "tv", tmdbId: 2 });
  });

  it("reports unknown for empty queries, only-person results, errors and empty results", async () => {
    const unknown = { mediaType: "unknown", tmdbId: null };
    expect(await searchMulti("")).toEqual(unknown);

    reply(url("Person"), { results: [{ id: 1, media_type: "person" }] });
    expect(await searchMulti("Person")).toEqual(unknown);

    reply(url("Leer"), { results: [] });
    expect(await searchMulti("Leer")).toEqual(unknown);

    reply(url("Fehler"), {}, 500);
    expect(await searchMulti("Fehler")).toEqual(unknown);

    replies.set(url("Offline"), () => {
      throw new Error("offline");
    });
    expect(await searchMulti("Offline")).toEqual(unknown);
  });
});
