/**
 * SRG-SSR API Client
 *
 * Client for the official SRG-SSR (Swiss Broadcasting Corporation) APIs.
 * Supports SRF, RTS, RSI, RTR, and SWI content.
 *
 * API Documentation: https://developer.srgssr.ch/
 * Product: SRG SSR PUBLIC API V2
 */

import { getSetting } from "@/lib/settings";

// API Base URLs
const API_BASE_URL = "https://api.srgssr.ch";
// https://developer.srgssr.ch/sites/default/files/swaggers/SRGSSRVideo-OpenApi3.yaml
const VIDEO_API_BASE_URL = `${API_BASE_URL}/videometadata/v2`;
const TOKEN_EXPIRY_BUFFER_MS = 60000;

// Business Units
export type SrgssrBusinessUnit = "SRF" | "RTS" | "RSI" | "RTR" | "SWI";

// Token cache
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Get API credentials from settings
 */
async function getApiCredentials(): Promise<{
  consumerKey: string;
  consumerSecret: string;
} | null> {
  const consumerKey = (await getSetting("api.srgssr.consumerKey"))?.trim();
  const consumerSecret = (await getSetting("api.srgssr.consumerSecret"))?.trim();

  if (!consumerKey || !consumerSecret) {
    return null;
  }

  return { consumerKey, consumerSecret };
}

/**
 * Get OAuth2 access token
 * Uses client credentials grant type
 */
async function getAccessToken(): Promise<string | null> {
  // Check cache
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
    return cachedToken.token;
  }

  const credentials = await getApiCredentials();
  if (!credentials) {
    console.error("[SRG-SSR] No API credentials configured");
    return null;
  }

  try {
    const authHeader = Buffer.from(
      `${credentials.consumerKey}:${credentials.consumerSecret}`
    ).toString("base64");

    const response = await fetch(
      `${API_BASE_URL}/oauth/v1/accesstoken?grant_type=client_credentials`,
      {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    if (!response.ok) {
      console.error(`[SRG-SSR] Token request failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    // Validate token response
    if (!data || typeof data.access_token !== "string") {
      console.error("[SRG-SSR] Token response missing access_token");
      return null;
    }

    const token = data.access_token;
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;

    // Cache token
    cachedToken = {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    console.log(`[SRG-SSR] Obtained access token, expires in ${expiresIn}s`);
    return token;
  } catch (error) {
    console.error("[SRG-SSR] Token request error:", error);
    return null;
  }
}

/**
 * Make an authenticated API request
 */
async function apiRequest<T>(
  endpoint: string,
  baseUrl: string = VIDEO_API_BASE_URL
): Promise<T | null> {
  const token = await getAccessToken();
  if (!token) {
    return null;
  }

  try {
    const url = `${baseUrl}${endpoint}`;
    console.log(`[SRG-SSR] API request: ${url}`);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.error(`[SRG-SSR] API request failed: ${response.status} ${response.statusText}`);
      return null;
    }

    return (await response.json()) as T;
  } catch (error) {
    console.error("[SRG-SSR] API request error:", error);
    return null;
  }
}

// ============================================================================
// API Response Types
// ============================================================================

export interface SrgssrSearchResponse {
  searchResultListMedia?: SrgssrMediaItem[];
  SearchResultListMedia?: SrgssrMediaItem[];
}

export interface SrgssrMediaItem {
  id: string;
  mediaType: "VIDEO" | "AUDIO";
  vendor: SrgssrBusinessUnit;
  urn: string;
  title: string;
  description?: string;
  imageUrl?: string;
  date: string; // ISO date
  duration: number; // milliseconds
  playableAbroad: boolean;
  type: "EPISODE" | "CLIP" | "TRAILER" | "LIVESTREAM";
  show?: {
    id: string;
    title: string;
    description?: string;
    imageUrl?: string;
  };
  episode?: {
    id: string;
    title: string;
    description?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    publishedDate?: string;
  };
  channel?: {
    id: string;
    title: string;
  };
  analyticsMetadata?: Record<string, string>;
}

export interface SrgssrMediaComposition {
  chapterUrn: string;
  chapterList: SrgssrChapter[];
  show?: {
    id: string;
    title: string;
    description?: string;
  };
}

export interface SrgssrChapter {
  id: string;
  mediaType: "VIDEO" | "AUDIO";
  vendor: SrgssrBusinessUnit;
  urn: string;
  title: string;
  description?: string;
  imageUrl?: string;
  duration: number;
  resourceList?: SrgssrResource[];
  subtitleList?: SrgssrSubtitle[];
}

export interface SrgssrResource {
  url: string;
  quality: "SD" | "HD" | "HQ";
  protocol: "HLS" | "HTTPS" | "HTTP";
  encoding: string;
  mimeType?: string;
  streaming?: string;
  dvr?: boolean;
  live?: boolean;
  tokenType?: string;
}

export interface SrgssrSubtitle {
  locale: string;
  language: string;
  format: string;
  url: string;
}

// ============================================================================
// API Methods
// ============================================================================

const VIDEO_URN = /^urn:(srf|rts|rsi|rtr|swi):video:([a-zA-Z0-9-]+)$/;

function validateMediaItems(items: unknown, source: string): SrgssrMediaItem[] {
  if (
    !Array.isArray(items) ||
    !items.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        (item.mediaType !== "VIDEO" ||
          (typeof item.title === "string" &&
            typeof item.urn === "string" &&
            VIDEO_URN.test(item.urn) &&
            typeof item.date === "string" &&
            Number.isFinite(Date.parse(item.date)) &&
            typeof item.duration === "number" &&
            Number.isFinite(item.duration)))
    )
  )
    throw new Error(`Invalid SRF ${source} response`);
  return items;
}

/**
 * Search for videos
 */
export async function searchVideos(
  query: string,
  businessUnit: SrgssrBusinessUnit = "SRF",
  pageSize: number = 50
): Promise<SrgssrMediaItem[]> {
  const encodedQuery = encodeURIComponent(query);
  const response = await apiRequest<SrgssrSearchResponse>(
    `/search?bu=${businessUnit.toLowerCase()}&q=${encodedQuery}&pageSize=${Math.max(1, Math.min(pageSize, 100))}`
  );

  if (!response) throw new Error("SRF search failed");
  const items = response.searchResultListMedia ?? response.SearchResultListMedia;
  return validateMediaItems(items, "search");
}

/**
 * Get video details including stream URLs
 */
export async function getMediaComposition(urn: string): Promise<SrgssrMediaComposition | null> {
  const match = urn.match(VIDEO_URN);
  if (!match) return null;
  return apiRequest<SrgssrMediaComposition>(
    `/${encodeURIComponent(match[2])}/mediaComposition?bu=${match[1]}`
  );
}

/**
 * Get latest videos for a business unit
 */
export async function getLatestVideos(
  businessUnit: SrgssrBusinessUnit = "SRF",
  pageSize: number = 50
): Promise<SrgssrMediaItem[]> {
  const response = await apiRequest<{
    mediaList?: SrgssrMediaItem[];
    MediaList?: SrgssrMediaItem[];
  }>(
    `/latest_episodes?bu=${businessUnit.toLowerCase()}&pageSize=${Math.max(1, Math.min(pageSize, 100))}`
  );

  if (!response) throw new Error("SRF latest episodes failed");
  const items = response.mediaList ?? response.MediaList;
  return validateMediaItems(items, "latest episodes");
}

/**
 * Get the best streaming URL for a video
 * Returns the HLS URL for the highest available quality
 */
export function getBestStreamUrl(
  composition: SrgssrMediaComposition,
  preferredQuality: "low" | "standard" | "high" = "high"
): string | null {
  if (!composition.chapterList || composition.chapterList.length === 0) {
    return null;
  }

  const chapter =
    composition.chapterList.find((item) => item.urn === composition.chapterUrn) ||
    composition.chapterList[0];
  if (!chapter.resourceList || chapter.resourceList.length === 0) {
    return null;
  }

  // Prefer HLS and choose the closest advertised quality. The downloader also
  // limits manifest rendition height to the requested resolution.
  const hlsResources = chapter.resourceList.filter((r) => r.protocol === "HLS");
  const resources = hlsResources.length ? hlsResources : chapter.resourceList;
  const qualities =
    preferredQuality === "low"
      ? ["SD", "HQ", "HD"]
      : preferredQuality === "standard"
        ? ["HQ", "HD", "SD"]
        : ["HD", "HQ", "SD"];
  for (const quality of qualities) {
    const resource = resources.find((item) => item.quality === quality);
    if (resource) return resource.url;
  }
  return resources[0].url;
}

/**
 * Check if SRG-SSR API is configured and working
 */
export async function checkApiStatus(): Promise<{
  configured: boolean;
  working: boolean;
  error?: string;
}> {
  const credentials = await getApiCredentials();
  if (!credentials) {
    return { configured: false, working: false, error: "API credentials not configured" };
  }

  const token = await getAccessToken();
  if (!token) {
    return { configured: true, working: false, error: "Failed to obtain access token" };
  }

  // Try a simple API call
  try {
    const videos = await getLatestVideos("SRF", 1);
    return { configured: true, working: videos.length > 0 };
  } catch (error) {
    return {
      configured: true,
      working: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Clear the token cache (useful for testing or after credential changes)
 */
export function clearTokenCache(): void {
  cachedToken = null;
}
