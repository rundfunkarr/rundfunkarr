import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { mediathekCache } from "@/lib/cache";
import {
  fetchMovieSearchByQuery,
  fetchMovieSearchResults,
  fetchSearchResultsById,
  fetchSearchResultsByString,
  fetchSearchResultsForRssSync,
} from "./mediathek";
import type { TmdbMovieData, TvdbData } from "@/types";

vi.mock("@/lib/fetch-retry", () => ({ fetchWithRetry: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(async () => null) }));
vi.mock("./rulesets", () => ({
  ensureRulesetsLoaded: vi.fn(),
  getAllTopics: () => [],
  getRulesetsForTopic: () => [],
}));
vi.mock("./tmdb", () => ({ searchMovieByTitle: vi.fn(async () => null) }));

const show: TvdbData = { id: 101241, name: "Show", germanName: null, aliases: [], episodes: [] };
const movie: TmdbMovieData = {
  tmdbId: 1,
  imdbId: null,
  title: "Movie",
  germanTitle: "Movie",
  runtime: 90,
  releaseDate: null,
};
const emptyResult = () => Response.json({ result: { results: [] }, err: null });
const searches = [
  { name: "RSS", run: (limit: number) => fetchSearchResultsForRssSync(limit, 0) },
  { name: "TV query", run: (limit: number) => fetchSearchResultsByString("Show", null, limit, 0) },
  { name: "TV ID", run: (limit: number) => fetchSearchResultsById(show, null, null, limit, 0) },
  { name: "movie query", run: (limit: number) => fetchMovieSearchByQuery("Movie", limit, 0) },
  { name: "movie ID", run: (limit: number) => fetchMovieSearchResults(movie, limit, 0) },
];

beforeEach(() => {
  mediathekCache.clear();
  vi.clearAllMocks();
  vi.mocked(fetchWithRetry).mockReset();
});

describe.each(searches)("$name cache recovery", ({ run, name }) => {
  it("retries after an outage without caching either the failed API result or RSS", async () => {
    vi.mocked(fetchWithRetry)
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockImplementation(async () => emptyResult());

    await run(10);
    await run(10);
    expect(fetchWithRetry).toHaveBeenCalledTimes(2);

    if (name !== "TV ID") {
      await run(10);
      await run(20);
      expect(fetchWithRetry).toHaveBeenCalledTimes(2);
    }
  });
});

it("retries only a failed movie title and does not cache the incomplete combined response", async () => {
  const bilingualMovie = { ...movie, germanTitle: "Film" };
  vi.mocked(fetchWithRetry)
    .mockResolvedValueOnce(emptyResult())
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(emptyResult());

  await fetchMovieSearchResults(bilingualMovie, 10, 0);
  expect(fetchWithRetry).toHaveBeenCalledTimes(2);
  await fetchMovieSearchResults(bilingualMovie, 10, 0);
  expect(fetchWithRetry).toHaveBeenCalledTimes(3);
  const body = JSON.parse(String(vi.mocked(fetchWithRetry).mock.calls[2][1]?.body));
  expect(body.queries[0].query).toBe("Movie");
  await fetchMovieSearchResults(bilingualMovie, 10, 0);
  expect(fetchWithRetry).toHaveBeenCalledTimes(3);
});
