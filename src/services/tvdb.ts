import { prisma } from "@/lib/db";
import { tvdbCache } from "@/lib/cache";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { getSettings } from "@/lib/settings";
import { buildTvdbLoginPayload } from "@/lib/tvdb-auth";
import type { TvdbData, TvdbEpisode, TvdbAlias } from "@/types";

const TVDB_API_URL = "https://api4.thetvdb.com/v4";

interface ApiEpisode {
  id: number;
  name?: string | null;
  aired?: string;
  runtime?: number | null;
  seasonNumber: number;
  number: number;
}

/** Fetch translated titles in pages, rather than making a request per episode. */
async function getGermanTitles(tvdbId: number, token: string) {
  const base = `${TVDB_API_URL}/series/${tvdbId}`;
  const options = {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  };
  const fetchData = async (url: string) => {
    options.signal.throwIfAborted();
    const response = await fetchWithRetry(url, options, { maxRetries: 0 });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`TVDB translation request failed (${response.status})`);
    const data = await response.json();
    if (data?.status !== "success" || !data.data)
      throw new Error("Invalid TVDB translation response");
    return data;
  };

  const translation = await fetchData(`${base}/translations/deu`);
  const name = translation?.data?.name;
  const germanName = typeof name === "string" && name.trim() ? name.trim() : null;
  const episodeNames = new Map<number, string>();
  const endpoint = `${base}/episodes/default/deu`;
  let page = 0;
  // A malformed pagination chain must not hang a search or cache a partial list.
  for (let requests = 0; requests < 100; requests++) {
    const data = await fetchData(`${endpoint}?page=${page}`);
    if (!data) {
      if (page === 0) return { germanName, episodeNames };
      throw new Error("Missing TVDB translation page");
    }
    if (!Array.isArray(data.data.episodes)) throw new Error("Invalid TVDB episode translations");
    for (const episode of data.data.episodes) {
      if (
        Number.isSafeInteger(episode.id) &&
        typeof episode.name === "string" &&
        episode.name.trim()
      )
        episodeNames.set(episode.id, episode.name.trim());
    }
    const next = data.links?.next;
    if (!next) return { germanName, episodeNames };
    const nextUrl = new URL(next, endpoint);
    const pageValue = nextUrl.searchParams.get("page") || "";
    const nextPage = Number(pageValue);
    if (
      nextUrl.origin + nextUrl.pathname !== endpoint ||
      !/^\d+$/.test(pageValue) ||
      !Number.isSafeInteger(nextPage) ||
      nextPage <= page
    )
      throw new Error("Invalid TVDB translation pagination");
    // Construct our own URL; never forward the token to a returned next URL.
    page = nextPage;
  }
  throw new Error("TVDB translation pagination limit exceeded");
}

// Token management
let cachedToken: string | null = null;
let tokenExpiry: Date | null = null;

export function clearTvdbTokenMemoryCache(): void {
  cachedToken = null;
  tokenExpiry = null;
}

export async function clearTvdbTokenCache(): Promise<void> {
  clearTvdbTokenMemoryCache();
  await prisma.config.deleteMany({
    where: { key: { in: ["tvdb_token", "tvdb_token_expiry"] } },
  });
}

async function getToken(): Promise<string | null> {
  // Check if we have a valid cached token
  if (cachedToken && tokenExpiry && new Date() < tokenExpiry) {
    return cachedToken;
  }

  // Check database for stored token
  const storedToken = await prisma.config.findUnique({
    where: { key: "tvdb_token" },
  });

  const storedExpiry = await prisma.config.findUnique({
    where: { key: "tvdb_token_expiry" },
  });

  if (storedToken && storedExpiry) {
    const expiry = new Date(storedExpiry.value);
    if (new Date() < expiry) {
      cachedToken = storedToken.value;
      tokenExpiry = expiry;
      return cachedToken;
    }
  }

  // Need to refresh token
  return refreshToken();
}

async function refreshToken(): Promise<string | null> {
  const settings = await getSettings(["api.tvdb.key", "api.tvdb.pin"]);
  const apiKey = settings["api.tvdb.key"];
  const pin = settings["api.tvdb.pin"];
  const payload = buildTvdbLoginPayload(apiKey, pin);

  if (!payload) {
    console.error("TVDB API key not configured in settings");
    return null;
  }

  try {
    const response = await fetchWithRetry(`${TVDB_API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.status === "success" && data.data?.token) {
      const token = data.data.token;
      const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Store in database
      await prisma.config.upsert({
        where: { key: "tvdb_token" },
        update: { value: token },
        create: { key: "tvdb_token", value: token },
      });

      await prisma.config.upsert({
        where: { key: "tvdb_token_expiry" },
        update: { value: expiry.toISOString() },
        create: { key: "tvdb_token_expiry", value: expiry.toISOString() },
      });

      cachedToken = token;
      tokenExpiry = expiry;

      return token;
    }

    console.error("Failed to get TVDB token:", data);
    return null;
  } catch (error) {
    console.error("Error refreshing TVDB token:", error);
    return null;
  }
}

export async function getShowInfoByTvdbId(tvdbId: number): Promise<TvdbData | null> {
  // Guard against undefined/null tvdbId
  if (tvdbId === undefined || tvdbId === null) {
    return null;
  }

  // Check memory cache first
  const cacheKey = `tvdb_${tvdbId}`;
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

  // Fetch from TVDB API
  return fetchAndCacheSeriesData(tvdbId);
}

async function fetchAndCacheSeriesData(tvdbId: number): Promise<TvdbData | null> {
  const token = await getToken();
  if (!token) {
    return null;
  }

  try {
    const response = await fetchWithRetry(
      `${TVDB_API_URL}/series/${tvdbId}/extended?meta=episodes&short=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      }
    );

    const data = await response.json();

    if (!data || data.status !== "success") {
      console.error("Failed to fetch data from TVDB:", data);
      return null;
    }

    const series = data.data;

    // nameTranslations contains language codes, not translated names. Join
    // translated episode titles by ID while retaining the original numbering
    // and any episodes for which a German translation is not available.
    const titles = await getGermanTitles(tvdbId, token);
    const germanName = titles.germanName || series.name;
    const translatedEpisodes: ApiEpisode[] = (series.episodes || []).map((ep: ApiEpisode) => ({
      ...ep,
      name: titles.episodeNames.get(ep.id) || ep.name || "",
    }));

    // Extract German aliases
    const rawAliases = series.aliases || [];
    const germanAliases: TvdbAlias[] = rawAliases
      .filter((alias: { language?: string; name?: string }) => alias.language === "deu")
      .map((alias: { language: string; name: string }) => ({
        language: alias.language,
        name: alias.name,
      }));

    // Calculate cache expiry based on activity
    const now = new Date();
    const lastUpdated = series.lastUpdated ? new Date(series.lastUpdated) : new Date("1970-01-01");
    const nextAired = series.nextAired ? new Date(series.nextAired) : new Date("1970-01-01");
    const lastAired = series.lastAired ? new Date(series.lastAired) : new Date("1970-01-01");

    let cacheExpiry = new Date();
    const daysDiff = (d1: Date, d2: Date) =>
      Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24);

    if (
      daysDiff(lastUpdated, now) < 7 ||
      (nextAired.getTime() > 0 && daysDiff(nextAired, now) < 6) ||
      (lastAired.getTime() > 0 && daysDiff(lastAired, now) < 3)
    ) {
      cacheExpiry.setDate(cacheExpiry.getDate() + 2);
    } else {
      cacheExpiry.setDate(cacheExpiry.getDate() + 6);
    }

    // Map episodes
    const episodes: TvdbEpisode[] = translatedEpisodes.map((ep) => ({
      name: ep.name || "",
      aired: ep.aired ? new Date(ep.aired) : null,
      runtime: ep.runtime || null,
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.number,
    }));

    // Store in database
    await prisma.$transaction(async (tx) => {
      // Delete existing data
      await tx.tvdbEpisode.deleteMany({ where: { seriesId: tvdbId } });
      await tx.tvdbSeries.deleteMany({ where: { id: tvdbId } });

      // Insert series
      await tx.tvdbSeries.create({
        data: {
          id: tvdbId,
          name: series.name,
          germanName: germanName,
          slug: series.slug || null,
          firstAired: series.firstAired ? new Date(series.firstAired) : null,
          image: typeof series.image === "string" && series.image ? series.image : null,
          aliases: JSON.stringify(germanAliases),
          expiresAt: cacheExpiry,
        },
      });

      // Insert episodes in batch
      const episodesData = translatedEpisodes.map((ep) => ({
        id: ep.id,
        seriesId: tvdbId,
        name: ep.name || "",
        aired: ep.aired ? new Date(ep.aired) : null,
        runtime: ep.runtime || null,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.number,
      }));

      if (episodesData.length > 0) {
        await tx.tvdbEpisode.createMany({ data: episodesData });
      }
    });

    const tvdbData: TvdbData = {
      id: tvdbId,
      name: series.name,
      germanName: germanName,
      aliases: germanAliases,
      episodes: episodes,
    };

    // Store in memory cache
    const cacheKey = `tvdb_${tvdbId}`;
    tvdbCache.set(cacheKey, tvdbData);

    return tvdbData;
  } catch (error) {
    console.error("Error fetching TVDB data:", error);
    return null;
  }
}
