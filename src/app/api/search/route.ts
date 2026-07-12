import { NextRequest, NextResponse } from "next/server";
import { getCategoriesForTopics, CategoryType } from "@/services/category";
import { getMinDurationSeconds } from "@/lib/settings";

const MEDIATHEK_API_URL = "https://mediathekviewweb.de/api/query";

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
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get("q");
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const type = searchParams.get("type"); // "movie" for movies only

  if (!q || q.trim().length < 2) {
    return NextResponse.json({ results: [], error: "Query too short" });
  }

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

    // Filter out m3u8 streams and apply the configured minimum duration to movies
    const minDuration = type === "movie" ? await getMinDurationSeconds() : 0;

    const filteredItems = items
      .filter(
        (item: { url_video: string; duration: number }) =>
          !item.url_video.endsWith(".m3u8") && item.duration >= minDuration
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
