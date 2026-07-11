import { NextRequest, NextResponse } from "next/server";
import { getCategoriesForTopics, CategoryType } from "@/services/category";
import { getSetting } from "@/lib/settings";
import { providerRegistry, initializeProviders } from "@/providers";
import type { ProviderContentItem } from "@/types/provider";

const MEDIATHEK_API_URL = "https://mediathekviewweb.de/api/query";

async function isHlsEnabled(): Promise<boolean> {
  const setting = await getSetting("download.enableHLS");
  return setting === "true";
}

export interface SearchResult {
  id: string;
  channel: string;
  topic: string;
  title: string;
  description: string;
  timestamp: number;
  duration: number;
  size: number;
  url_video: string;
  url_video_hd: string;
  url_video_low: string;
  url_website: string;
  category?: CategoryType;
  providerId?: string;
}

/**
 * Convert a ProviderContentItem to SearchResult format
 */
function providerItemToSearchResult(
  item: ProviderContentItem,
  category?: CategoryType
): SearchResult {
  return {
    id: item.id,
    channel: item.channel,
    topic: item.topic,
    title: item.title,
    description: item.description,
    timestamp: item.timestamp,
    duration: item.duration,
    size: item.size,
    url_video: item.videoUrls.standard,
    url_video_hd: item.videoUrls.high || item.videoUrls.standard,
    url_video_low: item.videoUrls.low || "",
    url_website: item.websiteUrl,
    category,
    providerId: item.providerId,
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get("q");
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const type = searchParams.get("type"); // "movie" for movies only
  const useProviders = searchParams.get("providers") === "true"; // Use provider system
  const providerId = searchParams.get("provider"); // Specific provider to search

  if (!q || q.trim().length < 2) {
    return NextResponse.json({ results: [], error: "Query too short" });
  }

  // Use new provider system if requested
  if (useProviders || providerId) {
    return handleProviderSearch(q, limit, type, providerId);
  }

  // Legacy direct API search (for backward compatibility)
  return handleLegacySearch(q, limit, type);
}

/**
 * Handle search using the provider system
 */
async function handleProviderSearch(
  q: string,
  limit: number,
  type: string | null,
  providerId: string | null
): Promise<NextResponse> {
  try {
    // Initialize providers if not already done
    await initializeProviders();

    const searchType = type === "movie" ? "movie" : type === "series" ? "series" : "all";

    let items: ProviderContentItem[];
    let providerCounts: Record<string, number> = {};
    let errors: Array<{ providerId: string; error: string }> = [];

    if (providerId) {
      // Search specific provider
      items = await providerRegistry.searchProvider(providerId, {
        query: q,
        limit,
        type: searchType,
      });
      providerCounts[providerId] = items.length;
    } else {
      // Search all enabled providers
      const result = await providerRegistry.searchAll({
        query: q,
        limit,
        type: searchType,
      });
      items = result.items;
      providerCounts = result.providerCounts;
      errors = result.errors;
    }

    // Collect unique topics for category lookup
    const topics = [...new Set(items.map((item) => item.topic))] as string[];
    const categoryMap = await getCategoriesForTopics(topics);

    // Convert to SearchResult format
    const results: SearchResult[] = items.map((item) =>
      providerItemToSearchResult(item, categoryMap.get(item.topic))
    );

    return NextResponse.json({
      results,
      providerCounts,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Provider search error:", error);
    return NextResponse.json({ results: [], error: "Search failed" }, { status: 500 });
  }
}

/**
 * Handle legacy direct API search (backward compatibility)
 */
async function handleLegacySearch(
  q: string,
  limit: number,
  type: string | null
): Promise<NextResponse> {
  // Fetch more results than needed because accessibility filtering may remove many
  // For movie search: at least 3x limit or 150
  // For regular search: at least 3x limit to ensure enough results after filtering
  const fetchSize = type === "movie" ? Math.max(limit * 3, 150) : Math.max(limit * 3, 100);

  try {
    const requestBody = {
      queries: [{ fields: ["topic", "title"], query: q }],
      sortBy: "filmlisteTimestamp",
      sortOrder: "desc",
      future: true,
      offset: 0,
      size: fetchSize,
    };

    const response = await fetch(MEDIATHEK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      return NextResponse.json({ results: [], error: "API error" }, { status: 500 });
    }

    const data = await response.json();
    const items = data.result?.results || [];

    // Filter out m3u8 streams (unless HLS enabled) and transform results
    // For movies: only items >= 60 minutes (3600 seconds)
    const minDuration = type === "movie" ? 3600 : 0;
    const hlsEnabled = await isHlsEnabled();

    const filteredItems = items
      .filter(
        (item: { url_video: string; duration: number }) =>
          (hlsEnabled || !item.url_video.endsWith(".m3u8")) && item.duration >= minDuration
      )
      .slice(0, limit);

    // Collect unique topics for category lookup
    const topics = [
      ...new Set(filteredItems.map((item: { topic: string }) => item.topic)),
    ] as string[];

    // Get categories for all topics
    const categoryMap = await getCategoriesForTopics(topics);

    const results: SearchResult[] = filteredItems.map(
      (item: {
        channel: string;
        topic: string;
        title: string;
        description: string;
        filmlisteTimestamp: number;
        duration: number;
        size: number;
        url_video: string;
        url_video_hd: string;
        url_video_low: string;
        url_website: string;
      }) => ({
        id: `${item.channel}-${item.topic}-${item.title}-${item.filmlisteTimestamp}`,
        channel: item.channel,
        topic: item.topic,
        title: item.title,
        description: item.description,
        timestamp: item.filmlisteTimestamp,
        duration: item.duration,
        size: item.size,
        url_video: item.url_video,
        url_video_hd: item.url_video_hd || item.url_video,
        url_video_low: item.url_video_low || "",
        url_website: item.url_website,
        category: categoryMap.get(item.topic),
      })
    );

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ results: [], error: "Search failed" }, { status: 500 });
  }
}
