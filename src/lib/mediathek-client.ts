/**
 * Shared MediathekViewWeb API client.
 *
 * Before this existed, the same "POST to mediathekviewweb.de/api/query,
 * parse `result.results`" logic was reimplemented independently in
 * services/mediathek.ts, services/ruleset-generator.ts, and
 * providers/mediathekview.ts - each with its own response-parsing types.
 * They drifted apart: ruleset-generator's copy read `data.results` instead
 * of the real `data.result.results`, silently returning empty for every
 * query and breaking ruleset auto-generation for every show. Consolidating
 * to one implementation removes that whole class of bug.
 */
import { fetchWithRetry } from "@/lib/fetch-retry";
import type { ApiResultItem, MediathekApiResponse } from "@/types";

const MEDIATHEK_API_URL = "https://mediathekviewweb.de/api/query";

export interface MediathekQueryField {
  fields: string[];
  query: string;
}

export interface MediathekQueryOptions {
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  future?: boolean;
}

/**
 * Query MediathekViewWeb and return the parsed result items.
 * Returns null on request, API, or parse failures so callers can avoid
 * caching an outage as a successful empty result.
 */
export async function queryMediathekView(
  queries: MediathekQueryField[],
  size: number,
  options: MediathekQueryOptions = {}
): Promise<ApiResultItem[] | null> {
  const requestBody = {
    queries,
    sortBy: options.sortBy ?? "filmlisteTimestamp",
    sortOrder: options.sortOrder ?? "desc",
    future: options.future ?? true,
    offset: 0,
    size,
  };

  try {
    const response = await fetchWithRetry(MEDIATHEK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error(`[MediathekClient] API request failed with status ${response.status}`);
      return null;
    }

    const parsed: MediathekApiResponse = await response.json();
    if (parsed?.err || !Array.isArray(parsed?.result?.results)) {
      console.error("[MediathekClient] Invalid or unsuccessful API response");
      return null;
    }
    // HLS entries use null for an unknown byte size in the live API.
    const items = parsed.result.results.map((item) =>
      item && typeof item === "object" && item.size === null ? { ...item, size: 0 } : item
    );
    if (
      !items.every(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          [
            "channel",
            "topic",
            "title",
            "description",
            "url_website",
            "url_video",
            "url_video_low",
            "url_video_hd",
          ].every((key) => typeof item[key as keyof ApiResultItem] === "string") &&
          ["filmlisteTimestamp", "duration", "size"].every(
            (key) =>
              typeof item[key as keyof ApiResultItem] === "number" &&
              Number.isFinite(item[key as keyof ApiResultItem])
          )
      )
    ) {
      console.error("[MediathekClient] Invalid result item");
      return null;
    }
    return items;
  } catch (error) {
    console.error("[MediathekClient] Error fetching from API:", error);
    return null;
  }
}
