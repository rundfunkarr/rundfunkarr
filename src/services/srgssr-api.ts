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
const IL_API_BASE_URL = "https://il.srgssr.ch"; // Integration Layer API

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
  const consumerKey = await getSetting("api.srgssr.consumerKey");
  const consumerSecret = await getSetting("api.srgssr.consumerSecret");

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
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
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
  baseUrl: string = IL_API_BASE_URL
): Promise<T | null> {
  const token = await getAccessToken();
  if (!token) {
    return null;
  }

  try {
    const url = `${baseUrl}${endpoint}`;
    console.log(`[SRG-SSR] API request: ${url}`);

    const response = await fetch(url, {
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
  searchResultListMedia?: {
    resultList?: SrgssrMediaItem[];
    total?: number;
  };
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

export interface SrgssrShowSearchResponse {
  searchResultListShow?: {
    resultList?: SrgssrShow[];
    total?: number;
  };
}

export interface SrgssrShow {
  id: string;
  vendor: SrgssrBusinessUnit;
  transmission: string;
  urn: string;
  title: string;
  description?: string;
  imageUrl?: string;
  posterImageUrl?: string;
  primaryChannelId?: string;
}

export interface SrgssrEpisodeListResponse {
  episodeList?: SrgssrMediaItem[];
  next?: string; // Pagination URL
}

// ============================================================================
// API Methods
// ============================================================================

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
    `/integrationlayer/2.1/${businessUnit}/searchResultListMedia/video?q=${encodedQuery}&pageSize=${pageSize}`
  );

  if (!response?.searchResultListMedia?.resultList) {
    return [];
  }

  return response.searchResultListMedia.resultList;
}

/**
 * Search for shows/series
 */
export async function searchShows(
  query: string,
  businessUnit: SrgssrBusinessUnit = "SRF",
  pageSize: number = 20
): Promise<SrgssrShow[]> {
  const encodedQuery = encodeURIComponent(query);
  const response = await apiRequest<SrgssrShowSearchResponse>(
    `/integrationlayer/2.1/${businessUnit}/searchResultListShow?q=${encodedQuery}&pageSize=${pageSize}`
  );

  if (!response?.searchResultListShow?.resultList) {
    return [];
  }

  return response.searchResultListShow.resultList;
}

/**
 * Get video details including stream URLs
 */
export async function getMediaComposition(urn: string): Promise<SrgssrMediaComposition | null> {
  // URN format: urn:srf:video:12345678-1234-1234-1234-123456789012
  const response = await apiRequest<SrgssrMediaComposition>(
    `/integrationlayer/2.1/mediaComposition/byUrn/${urn}`
  );

  return response;
}

/**
 * Get latest episodes for a show
 */
export async function getShowEpisodes(
  showId: string,
  businessUnit: SrgssrBusinessUnit = "SRF",
  pageSize: number = 50
): Promise<SrgssrMediaItem[]> {
  const response = await apiRequest<SrgssrEpisodeListResponse>(
    `/integrationlayer/2.1/${businessUnit}/episodeListByShowId/${showId}?pageSize=${pageSize}`
  );

  return response?.episodeList || [];
}

/**
 * Get latest videos for a business unit
 */
export async function getLatestVideos(
  businessUnit: SrgssrBusinessUnit = "SRF",
  pageSize: number = 50
): Promise<SrgssrMediaItem[]> {
  const response = await apiRequest<{ mediaList?: SrgssrMediaItem[] }>(
    `/integrationlayer/2.1/${businessUnit}/mediaList/video/latestEpisodes?pageSize=${pageSize}`
  );

  return response?.mediaList || [];
}

/**
 * Get video by URN
 */
export async function getVideoByUrn(urn: string): Promise<SrgssrMediaItem | null> {
  const response = await apiRequest<SrgssrMediaItem>(`/integrationlayer/2.1/media/byUrn/${urn}`);

  return response;
}

/**
 * Get the best streaming URL for a video
 * Returns the HLS URL for the highest available quality
 */
export function getBestStreamUrl(composition: SrgssrMediaComposition): string | null {
  if (!composition.chapterList || composition.chapterList.length === 0) {
    return null;
  }

  const chapter = composition.chapterList[0];
  if (!chapter.resourceList || chapter.resourceList.length === 0) {
    return null;
  }

  // Prefer HLS, then HD quality
  const hlsResources = chapter.resourceList.filter((r) => r.protocol === "HLS");
  if (hlsResources.length > 0) {
    // Prefer HD over SD
    const hdResource = hlsResources.find((r) => r.quality === "HD");
    return hdResource?.url || hlsResources[0].url;
  }

  // Fallback to any available resource
  const hdResource = chapter.resourceList.find((r) => r.quality === "HD");
  return hdResource?.url || chapter.resourceList[0].url;
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
