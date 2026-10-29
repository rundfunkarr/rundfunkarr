import { mediaMetadata, releaseAudioTag } from "@/lib/media-metadata";
import { isStreamingUrl } from "@/lib/stream-url";
import { mediathekCache } from "@/lib/cache";
import { getMinDurationSeconds } from "@/lib/settings";
import { queryContent } from "../content-search";
import {
  generateMovieRssItems,
  convertItemsToRss,
  serializeRss,
  getEmptyRssResult,
  releaseGuid,
} from "../newznab";
import { matchMovieItems } from "../movie-matcher";
import { searchMovieByTitle } from "../tmdb";
import type { ApiResultItem, TmdbMovieData, NewznabItem } from "@/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("Mediathek");
import { QUERY_FIELDS, getQualityPreference, isHlsEnabled } from "./preferences";
import { SKIP_KEYWORDS } from "./item-filters";
import { formatTitle } from "./title-parsing";

/**
 * Search for a movie in the Mediathek by TMDB data
 */
export async function fetchMovieSearchResults(
  movieData: TmdbMovieData,
  limit: number,
  offset: number
): Promise<string> {
  const quality = await getQualityPreference();
  const minDuration = await getMinDurationSeconds();
  log.debug(
    `fetchMovieSearchResults: tmdbId=${movieData.tmdbId}, title="${movieData.title}", germanTitle="${movieData.germanTitle}", runtime=${movieData.runtime} min, quality=${quality}, minDuration=${minDuration}s`
  );

  const cacheKey = `movie_${movieData.tmdbId}_${limit}_${offset}_${quality}_${minDuration}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached && typeof cached === "object" && "response" in cached) {
    log.debug(`Returning cached movie response for ${cacheKey}`);
    return (cached as { response: string }).response;
  }

  // Search by German title and original title in parallel
  const searchTerms = [movieData.germanTitle];
  if (movieData.title !== movieData.germanTitle) {
    searchTerms.push(movieData.title);
  }

  // Helper function to fetch results for a single search term
  async function fetchForTerm(searchTerm: string): Promise<ApiResultItem[] | null> {
    const apiCacheKey = `mediathekapi_movie_${searchTerm}`;
    const cachedApi = mediathekCache.get(apiCacheKey);

    if (cachedApi) {
      log.debug(`Using cached API response for movie search: "${searchTerm}"`);
      return (cachedApi as { results: ApiResultItem[] }).results;
    }

    log.debug(`Searching MediathekView API for movie: "${searchTerm}"`);
    const results = await queryContent([{ fields: QUERY_FIELDS, query: searchTerm }], 500);
    if (results === null) return null;
    log.debug(`API returned ${results.length} results for "${searchTerm}"`);
    mediathekCache.set(apiCacheKey, { results });
    return results;
  }

  // Fetch all search terms in parallel
  const resultsPerTerm = await Promise.all(searchTerms.map(fetchForTerm));
  const hasFailedTerm = resultsPerTerm.some((results) => results === null);

  // Merge results, avoiding duplicates by URL
  const allResults: ApiResultItem[] = [];
  const existingUrls = new Set<string>();
  for (const results of resultsPerTerm) {
    if (results === null) continue;
    for (const result of results) {
      if (!existingUrls.has(result.url_video)) {
        existingUrls.add(result.url_video);
        allResults.push(result);
      }
    }
  }

  if (allResults.length === 0) {
    log.debug(`No results found for movie`);
    const response = serializeRss(getEmptyRssResult());
    if (!hasFailedTerm) mediathekCache.set(cacheKey, { response });
    return response;
  }

  log.debug(`Total results for movie matching: ${allResults.length}`);

  // Filter out trailers and other non-movie content
  const filteredResults = allResults.filter(
    (item) => !SKIP_KEYWORDS.some((kw) => item.title.includes(kw))
  );
  log.debug(`Results after filtering: ${filteredResults.length}`);

  if (filteredResults.length === 0) {
    log.debug(`No results after filtering for movie`);
    const response = serializeRss(getEmptyRssResult());
    if (!hasFailedTerm) mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Match results against movie data
  const matchResults = await matchMovieItems(filteredResults, movieData, minDuration);

  if (matchResults.length === 0) {
    log.debug(`No matches found for movie`);
    const response = serializeRss(getEmptyRssResult());
    if (!hasFailedTerm) mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Generate RSS items for matches
  const hlsEnabled = await isHlsEnabled();
  const newznabItems: NewznabItem[] = matchResults.flatMap((match) =>
    generateMovieRssItems(match, movieData, quality, hlsEnabled)
  );

  log.info(`Generated ${newznabItems.length} Newznab items for movie (quality: ${quality})`);

  const response = convertItemsToRss(newznabItems, limit, offset);
  if (!hasFailedTerm) mediathekCache.set(cacheKey, { response });
  return response;
}

/**
 * Search for movies in the Mediathek by query string (for Radarr text search)
 * Filters by minimum duration to identify feature films
 */
export async function fetchMovieSearchByQuery(
  query: string,
  limit: number,
  offset: number
): Promise<string> {
  const quality = await getQualityPreference();
  const minDuration = await getMinDurationSeconds();

  // Strip trailing year from query (Radarr sends "Movie Title 2018")
  const cleanedQuery = query.replace(/\s+\d{4}$/, "").trim();
  const yearMatch = query.match(/\s+(\d{4})$/);
  const searchYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

  log.debug(
    `fetchMovieSearchByQuery: query="${query}", cleanedQuery="${cleanedQuery}", year=${searchYear}, quality=${quality}, minDuration=${minDuration}s`
  );

  // Try to find the movie on TMDB to get IDs for Radarr matching
  const tmdbMovie = await searchMovieByTitle(cleanedQuery, searchYear);
  if (tmdbMovie) {
    log.debug(
      `Found TMDB match: "${tmdbMovie.germanTitle}" (TMDB: ${tmdbMovie.tmdbId}, IMDB: ${tmdbMovie.imdbId})`
    );
  }

  const cacheKey = `movie_query_${cleanedQuery}_${searchYear || ""}_${limit}_${offset}_${quality}_${minDuration}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached && typeof cached === "object" && "response" in cached) {
    log.debug(`Returning cached movie query response for ${cacheKey}`);
    return (cached as { response: string }).response;
  }

  // Search Mediathek by query (without year)
  const apiCacheKey = `mediathekapi_movie_query_${cleanedQuery}`;
  let results: ApiResultItem[] | null;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi) {
    log.debug(`Using cached API response for movie query: "${cleanedQuery}"`);
    results = (cachedApi as { results: ApiResultItem[] }).results;
  } else {
    log.debug(`Searching MediathekView API for movie query: "${cleanedQuery}"`);
    results = await queryContent([{ fields: QUERY_FIELDS, query: cleanedQuery }], 500);
    if (results === null) {
      return serializeRss(getEmptyRssResult());
    }
    log.debug(`API returned ${results.length} results for movie query "${cleanedQuery}"`);
    mediathekCache.set(apiCacheKey, { results });
  }

  if (results.length === 0) {
    log.debug(`No API response for movie query`);
    const response = serializeRss(getEmptyRssResult());
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Filter trailers and apply the configured minimum duration. Each URL variant
  // is checked for HLS below so direct alternatives remain available.
  const hlsEnabled = await isHlsEnabled();
  const filteredResults = results.filter((item) => {
    if (SKIP_KEYWORDS.some((kw) => item.title.includes(kw))) return false;
    if (minDuration > 0 && item.duration < minDuration) return false;
    return true;
  });

  log.debug(`Results after movie filtering (min ${minDuration}s): ${filteredResults.length}`);

  if (filteredResults.length === 0) {
    log.debug(`No movie results after filtering`);
    const response = serializeRss(getEmptyRssResult());
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Radarr maps releases by tmdbid/imdbid rather than by title. Only results
  // that match the TMDB movie (same check as the ID search) may carry its IDs;
  // otherwise Radarr would grab unrelated broadcasts as that movie.
  const matchedItems = new Set<ApiResultItem>(
    tmdbMovie
      ? (await matchMovieItems(filteredResults, tmdbMovie, minDuration)).map((m) => m.item)
      : []
  );

  // Generate RSS items directly for the filtered results (as movies)
  const newznabItems: NewznabItem[] = [];

  for (const item of filteredResults) {
    const movieIds = matchedItems.has(item) ? tmdbMovie : null;

    // Format the release title
    const baseTitle = formatTitle(item.topic || item.title);
    const year = new Date(item.filmlisteTimestamp * 1000).getFullYear();

    // Calculate size
    const size = item.size > 0 ? item.size : item.duration * 500000;

    // Create item for each available quality
    const qualities: Array<{
      url: string;
      qualityName: string;
      category: string;
      sizeMultiplier: number;
    }> = [];

    const allowed = (url: string) => !!url && (hlsEnabled || !isStreamingUrl(url));
    const has1080p = allowed(item.url_video_hd);
    const has720p = allowed(item.url_video);
    const has480p = allowed(item.url_video_low);

    if (has1080p && (quality === "all" || quality === "best" || quality === "1080p")) {
      qualities.push({
        url: item.url_video_hd,
        qualityName: "1080p",
        category: "2040",
        sizeMultiplier: 1.6,
      });
    }
    if (has720p && (quality === "all" || quality === "720p" || (quality === "best" && !has1080p))) {
      qualities.push({
        url: item.url_video,
        qualityName: "720p",
        category: "2040",
        sizeMultiplier: 1.0,
      });
    }
    if (
      has480p &&
      (quality === "all" || quality === "480p" || (quality === "best" && !has1080p && !has720p))
    ) {
      qualities.push({
        url: item.url_video_low,
        qualityName: "480p",
        category: "2030",
        sizeMultiplier: 0.5,
      });
    }

    for (const q of qualities) {
      const releaseTitle = `${baseTitle}.${year}.${releaseAudioTag(item.title)}.${q.qualityName}.WEB.h264-MEDiATHEK`;
      const adjustedSize = Math.floor(size * q.sizeMultiplier);

      const encodedTitle = Buffer.from(releaseTitle).toString("base64");
      const encodedUrl = Buffer.from(q.url).toString("base64");
      // Only the broadcaster for now; subtitle metadata is not passed on this path.
      const metadata = JSON.stringify(mediaMetadata({ channel: item.channel }));
      const fakeDownloadUrl = `/api/newznab/fake_nzb_download?encodedUrl=${encodeURIComponent(encodedUrl)}&encodedTitle=${encodeURIComponent(encodedTitle)}&metadata=${encodeURIComponent(metadata)}`;

      newznabItems.push({
        title: releaseTitle,
        guid: releaseGuid(q.url, `movie-${q.qualityName}`),
        link: q.url,
        comments: item.url_website || "",
        pubDate: new Date(item.filmlisteTimestamp * 1000).toUTCString(),
        category: q.category === "2030" ? "Movies > SD" : "Movies > HD",
        description: item.description || "",
        enclosure: {
          url: fakeDownloadUrl,
          length: adjustedSize,
          type: "application/x-nzb",
        },
        attributes: [
          { name: "category", value: "2000" },
          { name: "category", value: q.category },
          ...(movieIds?.tmdbId ? [{ name: "tmdbid", value: movieIds.tmdbId.toString() }] : []),
          ...(movieIds?.imdbId ? [{ name: "imdbid", value: movieIds.imdbId }] : []),
        ],
      });
    }
  }

  log.info(`Generated ${newznabItems.length} Newznab items for movie query (quality: ${quality})`);

  const response = convertItemsToRss(newznabItems, limit, offset);
  mediathekCache.set(cacheKey, { response });
  return response;
}
