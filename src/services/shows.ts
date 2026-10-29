import { promises as fs } from "fs";
import path from "path";
import { tvdbCache } from "@/lib/cache";
import { getSetting } from "@/lib/settings";
import type { TvdbData } from "@/types";
import { getShowInfoByTvdbId as getTvdbShow } from "./tvdb";
import { getShowInfoByTvdbId as getTmdbShow } from "./tmdb";
import { createLogger } from "@/lib/logger";

const log = createLogger("Shows");

// Local shows data
interface LocalShow {
  tvdbId: number;
  name: string;
  germanName: string;
  aliases: string[];
  episodes: Array<{
    name: string;
    seasonNumber: number;
    episodeNumber: number;
    aired: string | null;
    runtime?: number | null;
  }>;
}

let localShows: Map<number, LocalShow> = new Map();
let localShowsLoaded = false;
let lastShowsFetchTime: number = 0;
const SHOWS_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// GitHub raw URL for auto-update
const GITHUB_SHOWS_URL =
  process.env.SHOWS_URL ||
  "https://raw.githubusercontent.com/rundfunkarr/rundfunkarr/main/data/shows.json";

async function fetchShowsFromGitHub(): Promise<LocalShow[] | null> {
  try {
    log.debug(`Fetching from GitHub: ${GITHUB_SHOWS_URL}`);
    const response = await fetch(GITHUB_SHOWS_URL, {
      headers: { "User-Agent": "RundfunkArr" },
    });

    if (!response.ok) {
      log.warn(`GitHub fetch failed: ${response.status}`);
      return null;
    }

    const shows: LocalShow[] = await response.json();
    log.info(`Fetched ${shows.length} shows from GitHub`);
    return shows;
  } catch (error) {
    log.warn("Error fetching from GitHub:", error);
    return null;
  }
}

async function loadLocalShows(): Promise<void> {
  // Check if we need to refresh (hourly)
  const now = Date.now();
  if (localShowsLoaded && now - lastShowsFetchTime < SHOWS_REFRESH_INTERVAL_MS) {
    return;
  }

  try {
    // Try GitHub first, fall back to local file
    let shows = await fetchShowsFromGitHub();

    if (!shows) {
      log.info("Falling back to local file");
      const showsPath = path.join(process.cwd(), "data", "shows.json");
      const fileContent = await fs.readFile(showsPath, "utf-8");
      shows = JSON.parse(fileContent);
      log.info(`Loaded ${shows!.length} shows from local file`);
    }

    localShows = new Map();
    for (const show of shows!) {
      localShows.set(show.tvdbId, show);
    }

    log.debug(`Indexed ${localShows.size} local shows`);
    localShowsLoaded = true;
    lastShowsFetchTime = now;
  } catch (error) {
    log.error("Error loading local shows:", error);
  }
}

function getLocalShow(tvdbId: number): TvdbData | null {
  const show = localShows.get(tvdbId);
  if (!show) return null;

  return {
    id: show.tvdbId,
    name: show.name,
    germanName: show.germanName,
    aliases: show.aliases.map((name) => ({ language: "deu", name })),
    episodes: show.episodes.map((ep) => ({
      name: ep.name,
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.episodeNumber,
      aired: ep.aired ? new Date(ep.aired) : null,
      runtime: ep.runtime || null,
    })),
  };
}

/**
 * Get show info by TVDB ID from multiple sources:
 * 1. Local shows.json (always checked first)
 * 2. TVDB API (if api.tvdb.key is configured in settings)
 * 3. TMDB API (if api.tmdb.key is configured in settings)
 */
export async function getShowInfoByTvdbId(tvdbId: number): Promise<TvdbData | null> {
  if (tvdbId === undefined || tvdbId === null) {
    return null;
  }

  // Check memory cache first
  const cacheKey = `show_${tvdbId}`;
  const cached = tvdbCache.get(cacheKey) as TvdbData | undefined;
  if (cached) {
    return cached;
  }

  // 1. Check local shows file first (no API needed)
  await loadLocalShows();
  const localShow = getLocalShow(tvdbId);
  if (localShow) {
    log.debug(`Found "${localShow.name}" in local database`);
    tvdbCache.set(cacheKey, localShow);
    return localShow;
  }

  // 2. Try TVDB if API key is configured
  const tvdbApiKey = await getSetting("api.tvdb.key");
  if (tvdbApiKey) {
    log.debug(`Trying TVDB for ID ${tvdbId}`);
    const tvdbResult = await getTvdbShow(tvdbId);
    if (tvdbResult) {
      log.debug(`Found "${tvdbResult.name}" via TVDB`);
      tvdbCache.set(cacheKey, tvdbResult);
      return tvdbResult;
    }
  }

  // 3. Try TMDB if API key is configured
  const tmdbApiKey = await getSetting("api.tmdb.key");
  if (tmdbApiKey) {
    log.debug(`Trying TMDB for ID ${tvdbId}`);
    const tmdbResult = await getTmdbShow(tvdbId);
    if (tmdbResult) {
      log.debug(`Found "${tmdbResult.name}" via TMDB`);
      tvdbCache.set(cacheKey, tmdbResult);
      return tmdbResult;
    }
  }

  log.debug(`No show found for TVDB ID ${tvdbId} in any source`);
  return null;
}
