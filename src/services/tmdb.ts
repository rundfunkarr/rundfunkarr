import { prisma } from "@/lib/db";
import { tvdbCache } from "@/lib/cache";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { getSetting } from "@/lib/settings";
import type { TvdbData, TvdbEpisode, TmdbMovieData } from "@/types";

const TMDB_API_URL = "https://api.themoviedb.org/3";

async function getApiKey(): Promise<string | null> {
  return getSetting("api.tmdb.key");
}

function isJwtToken(key: string): boolean {
  return key.startsWith("eyJ");
}

function getAuthHeaders(apiKey: string): HeadersInit {
  if (isJwtToken(apiKey)) {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }
  return {};
}

function getApiUrl(endpoint: string, apiKey: string): string {
  if (isJwtToken(apiKey)) {
    return `${TMDB_API_URL}${endpoint}`;
  }
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${TMDB_API_URL}${endpoint}${separator}api_key=${apiKey}`;
}

interface TmdbFindResult {
  tv_results: Array<{
    id: number;
    name: string;
    original_name: string;
    first_air_date: string;
    origin_country: string[];
  }>;
}

interface TmdbTvDetails {
  id: number;
  name: string;
  original_name: string;
  number_of_seasons: number;
  seasons: Array<{
    season_number: number;
    episode_count: number;
  }>;
  translations?: {
    translations: Array<{
      iso_639_1: string;
      data: {
        name: string;
      };
    }>;
  };
}

interface TmdbEpisode {
  id: number;
  name: string;
  episode_number: number;
  season_number: number;
  air_date: string | null;
  runtime: number | null;
}

interface TmdbSeasonDetails {
  episodes: TmdbEpisode[];
}

export async function getShowInfoByTvdbId(tvdbId: number): Promise<TvdbData | null> {
  if (tvdbId === undefined || tvdbId === null) {
    return null;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return null;
  }

  // Check memory cache first
  const cacheKey = `tmdb_${tvdbId}`;
  const cached = tvdbCache.get(cacheKey) as TvdbData | undefined;
  if (cached) {
    return cached;
  }

  // Check database cache
  const dbSeries = await prisma.tvdbSeries.findUnique({
    where: { id: tvdbId },
    include: { episodes: true },
  });

  if (dbSeries && new Date() < dbSeries.expiresAt) {
    const tvdbData: TvdbData = {
      id: dbSeries.id,
      name: dbSeries.name,
      germanName: dbSeries.germanName,
      aliases: dbSeries.aliases ? JSON.parse(dbSeries.aliases) : [],
      episodes: dbSeries.episodes.map((ep) => ({
        name: ep.name || "",
        aired: ep.aired,
        runtime: ep.runtime,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
      })),
    };

    tvdbCache.set(cacheKey, tvdbData);
    return tvdbData;
  }

  return fetchAndCacheSeriesData(tvdbId, apiKey);
}

async function fetchAndCacheSeriesData(tvdbId: number, apiKey: string): Promise<TvdbData | null> {
  try {
    console.log(`[TMDB] Looking up TVDB ID ${tvdbId}`);
    const headers = getAuthHeaders(apiKey);
    const findUrl = getApiUrl(`/find/${tvdbId}?external_source=tvdb_id`, apiKey);

    const findResponse = await fetchWithRetry(findUrl, { headers });

    if (!findResponse.ok) {
      console.error(`[TMDB] Find request failed: ${findResponse.status}`);
      return null;
    }

    const findData: TmdbFindResult = await findResponse.json();
    return processShowData(tvdbId, findData, apiKey);
  } catch (error) {
    console.error("[TMDB] Error fetching data:", error);
    return null;
  }
}

async function processShowData(
  tvdbId: number,
  findData: TmdbFindResult,
  apiKey: string
): Promise<TvdbData | null> {
  if (!findData.tv_results || findData.tv_results.length === 0) {
    console.log(`[TMDB] No show found for TVDB ID ${tvdbId}`);
    return null;
  }

  const tmdbShow = findData.tv_results[0];
  const tmdbId = tmdbShow.id;
  console.log(`[TMDB] Found show: "${tmdbShow.name}" (TMDB ID: ${tmdbId})`);

  const headers = getAuthHeaders(apiKey);
  const detailsUrl = getApiUrl(`/tv/${tmdbId}?append_to_response=translations`, apiKey);
  const detailsResponse = await fetchWithRetry(detailsUrl, { headers });

  if (!detailsResponse.ok) {
    console.error(`[TMDB] Details request failed: ${detailsResponse.status}`);
    return null;
  }

  const details: TmdbTvDetails = await detailsResponse.json();

  // Prefer a real TMDB "de" translation; but when none is populated (common -
  // translations aren't always filled in), fall back to original_name rather
  // than the English-localized `name`. For German/Austrian-origin shows
  // original_name already IS the German title, and it's what actually shows
  // up in MediathekView's search index - `name` here can be a wholly
  // different English title (e.g. SOKO Kitzbühel -> "Murder in the
  // Mountains"), which then fails every downstream Mediathek/provider search.
  let germanName = details.original_name || details.name;
  if (details.translations?.translations) {
    const germanTranslation = details.translations.translations.find((t) => t.iso_639_1 === "de");
    if (germanTranslation?.data?.name) {
      germanName = germanTranslation.data.name;
    }
  }
  console.log(`[TMDB] German name: "${germanName}"`);

  const episodes: TvdbEpisode[] = [];

  for (const season of details.seasons) {
    if (season.season_number === 0) continue;

    try {
      const seasonUrl = getApiUrl(
        `/tv/${tmdbId}/season/${season.season_number}?language=de-DE`,
        apiKey
      );
      const seasonResponse = await fetchWithRetry(seasonUrl, { headers });

      if (seasonResponse.ok) {
        const seasonData: TmdbSeasonDetails = await seasonResponse.json();

        for (const ep of seasonData.episodes) {
          episodes.push({
            name: ep.name || "",
            aired: ep.air_date ? new Date(ep.air_date) : null,
            runtime: ep.runtime || null,
            seasonNumber: ep.season_number,
            episodeNumber: ep.episode_number,
          });
        }
      }
    } catch (error) {
      console.error(`[TMDB] Error fetching season ${season.season_number}:`, error);
    }
  }

  console.log(`[TMDB] Loaded ${episodes.length} episodes for "${details.name}"`);

  const cacheExpiry = new Date();
  cacheExpiry.setDate(cacheExpiry.getDate() + 7);

  await prisma.$transaction(async (tx) => {
    await tx.tvdbEpisode.deleteMany({ where: { seriesId: tvdbId } });
    await tx.tvdbSeries.deleteMany({ where: { id: tvdbId } });

    await tx.tvdbSeries.create({
      data: {
        id: tvdbId,
        name: details.name,
        germanName: germanName,
        aliases: JSON.stringify([]),
        expiresAt: cacheExpiry,
      },
    });

    for (const ep of episodes) {
      await tx.tvdbEpisode.create({
        data: {
          seriesId: tvdbId,
          name: ep.name,
          aired: ep.aired,
          runtime: ep.runtime,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
        },
      });
    }
  });

  const tvdbData: TvdbData = {
    id: tvdbId,
    name: details.name,
    germanName: germanName,
    aliases: [],
    episodes: episodes,
  };

  const cacheKey = `tmdb_${tvdbId}`;
  tvdbCache.set(cacheKey, tvdbData);

  return tvdbData;
}

// ============== MOVIE FUNCTIONS ==============

interface TmdbMovieDetails {
  id: number;
  imdb_id: string | null;
  title: string;
  original_title: string;
  runtime: number | null;
  release_date: string | null;
}

interface TmdbFindMovieResult {
  movie_results: Array<{
    id: number;
    title: string;
    original_title: string;
    release_date: string;
  }>;
}

/**
 * Get movie info by TMDB ID
 * Uses German locale to get German title
 */
export async function getMovieInfoByTmdbId(tmdbId: number): Promise<TmdbMovieData | null> {
  if (!tmdbId) {
    return null;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("[TMDB] No API key configured");
    return null;
  }

  // Check memory cache first
  const cacheKey = `tmdb_movie_${tmdbId}`;
  const cached = tvdbCache.get(cacheKey) as TmdbMovieData | undefined;
  if (cached) {
    console.log(`[TMDB] Movie cache hit for TMDB ID ${tmdbId}`);
    return cached;
  }

  try {
    console.log(`[TMDB] Looking up movie by TMDB ID ${tmdbId}`);
    const headers = getAuthHeaders(apiKey);

    // First get the original movie details (for runtime and imdb_id)
    const detailsUrl = getApiUrl(`/movie/${tmdbId}`, apiKey);
    const detailsResponse = await fetchWithRetry(detailsUrl, { headers });

    if (!detailsResponse.ok) {
      console.error(`[TMDB] Movie details request failed: ${detailsResponse.status}`);
      return null;
    }

    const details: TmdbMovieDetails = await detailsResponse.json();

    // Now get the German title
    const germanUrl = getApiUrl(`/movie/${tmdbId}?language=de-DE`, apiKey);
    const germanResponse = await fetchWithRetry(germanUrl, { headers });

    let germanTitle = details.title; // fallback to original
    if (germanResponse.ok) {
      const germanDetails: TmdbMovieDetails = await germanResponse.json();
      germanTitle = germanDetails.title || details.title;
    }

    const movieData: TmdbMovieData = {
      tmdbId: details.id,
      imdbId: details.imdb_id,
      title: details.original_title || details.title,
      germanTitle: germanTitle,
      runtime: details.runtime,
      releaseDate: details.release_date,
    };

    console.log(
      `[TMDB] Found movie: "${movieData.title}" (German: "${movieData.germanTitle}"), runtime: ${movieData.runtime} min`
    );

    // Cache using metadata TTL
    tvdbCache.set(cacheKey, movieData);

    return movieData;
  } catch (error) {
    console.error("[TMDB] Error fetching movie data:", error);
    return null;
  }
}

interface TmdbSearchMovieResult {
  results: Array<{
    id: number;
    title: string;
    original_title: string;
    release_date: string;
  }>;
}

/**
 * Search for a movie by title (and optionally year)
 * Returns the best matching movie from TMDB
 */
export async function searchMovieByTitle(
  title: string,
  year?: number | null
): Promise<TmdbMovieData | null> {
  if (!title) {
    return null;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("[TMDB] No API key configured");
    return null;
  }

  // Check memory cache first
  const cacheKey = `tmdb_movie_search_${title}_${year || ""}`;
  const cached = tvdbCache.get(cacheKey) as TmdbMovieData | undefined;
  if (cached) {
    console.log(`[TMDB] Movie search cache hit for "${title}" (${year})`);
    return cached;
  }

  try {
    console.log(`[TMDB] Searching movie by title: "${title}"${year ? ` (${year})` : ""}`);
    const headers = getAuthHeaders(apiKey);

    // Search with German language preference
    let searchUrl = getApiUrl(
      `/search/movie?query=${encodeURIComponent(title)}&language=de-DE`,
      apiKey
    );
    if (year) {
      searchUrl += `&year=${year}`;
    }

    const searchResponse = await fetchWithRetry(searchUrl, { headers });

    if (!searchResponse.ok) {
      console.error(`[TMDB] Movie search request failed: ${searchResponse.status}`);
      return null;
    }

    const searchData: TmdbSearchMovieResult = await searchResponse.json();

    if (!searchData.results || searchData.results.length === 0) {
      console.log(`[TMDB] No movie found for "${title}"`);
      return null;
    }

    // Get the first (best) match
    const tmdbId = searchData.results[0].id;
    console.log(`[TMDB] Found movie: "${searchData.results[0].title}" (TMDB ID: ${tmdbId})`);

    // Get full movie info
    const movieData = await getMovieInfoByTmdbId(tmdbId);

    if (movieData) {
      tvdbCache.set(cacheKey, movieData);
    }

    return movieData;
  } catch (error) {
    console.error("[TMDB] Error searching movie:", error);
    return null;
  }
}

/**
 * Get movie info by IMDB ID
 * Uses TMDB /find endpoint to resolve IMDB ID to TMDB ID
 */
export async function getMovieInfoByImdbId(imdbId: string): Promise<TmdbMovieData | null> {
  if (!imdbId) {
    return null;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("[TMDB] No API key configured");
    return null;
  }

  // Check memory cache first
  const cacheKey = `tmdb_movie_imdb_${imdbId}`;
  const cached = tvdbCache.get(cacheKey) as TmdbMovieData | undefined;
  if (cached) {
    console.log(`[TMDB] Movie cache hit for IMDB ID ${imdbId}`);
    return cached;
  }

  try {
    console.log(`[TMDB] Looking up movie by IMDB ID ${imdbId}`);
    const headers = getAuthHeaders(apiKey);

    // Use /find endpoint to resolve IMDB ID
    const findUrl = getApiUrl(`/find/${imdbId}?external_source=imdb_id`, apiKey);
    const findResponse = await fetchWithRetry(findUrl, { headers });

    if (!findResponse.ok) {
      console.error(`[TMDB] Find request failed: ${findResponse.status}`);
      return null;
    }

    const findData: TmdbFindMovieResult = await findResponse.json();

    if (!findData.movie_results || findData.movie_results.length === 0) {
      console.log(`[TMDB] No movie found for IMDB ID ${imdbId}`);
      return null;
    }

    const tmdbId = findData.movie_results[0].id;
    console.log(`[TMDB] Resolved IMDB ID ${imdbId} to TMDB ID ${tmdbId}`);

    // Now get the full movie info using the TMDB ID
    const movieData = await getMovieInfoByTmdbId(tmdbId);

    if (movieData) {
      // Also cache under the IMDB ID
      tvdbCache.set(cacheKey, movieData);
    }

    return movieData;
  } catch (error) {
    console.error("[TMDB] Error resolving IMDB ID:", error);
    return null;
  }
}

// ============== MULTI-SEARCH (for category detection) ==============

export interface TmdbMultiSearchResult {
  mediaType: "movie" | "tv" | "unknown";
  tmdbId: number | null;
}

interface TmdbMultiSearchResponse {
  results: Array<{
    id: number;
    media_type: "movie" | "tv" | "person";
    name?: string;
    title?: string;
  }>;
}

/**
 * Search TMDB with multi-search to determine if a topic is a movie or TV show
 * Returns the first matching result's media type
 */
export async function searchMulti(query: string): Promise<TmdbMultiSearchResult> {
  if (!query) {
    return { mediaType: "unknown", tmdbId: null };
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("[TMDB] No API key configured");
    return { mediaType: "unknown", tmdbId: null };
  }

  try {
    const headers = getAuthHeaders(apiKey);
    const searchUrl = getApiUrl(
      `/search/multi?query=${encodeURIComponent(query)}&language=de-DE`,
      apiKey
    );

    const response = await fetchWithRetry(searchUrl, { headers });

    if (!response.ok) {
      console.error(`[TMDB] Multi-search request failed: ${response.status}`);
      return { mediaType: "unknown", tmdbId: null };
    }

    const data: TmdbMultiSearchResponse = await response.json();

    if (!data.results || data.results.length === 0) {
      console.log(`[TMDB] No results for multi-search: "${query}"`);
      return { mediaType: "unknown", tmdbId: null };
    }

    // Find first movie or TV result (skip person results)
    const mediaResult = data.results.find((r) => r.media_type === "movie" || r.media_type === "tv");

    if (!mediaResult) {
      return { mediaType: "unknown", tmdbId: null };
    }

    console.log(
      `[TMDB] Multi-search "${query}" -> ${mediaResult.media_type} (ID: ${mediaResult.id})`
    );

    return {
      mediaType: mediaResult.media_type as "movie" | "tv",
      tmdbId: mediaResult.id,
    };
  } catch (error) {
    console.error("[TMDB] Error in multi-search:", error);
    return { mediaType: "unknown", tmdbId: null };
  }
}
