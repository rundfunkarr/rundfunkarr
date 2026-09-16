import { BaseProvider } from "./base";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { getSetting } from "@/lib/settings";
import { queryMediathekView } from "@/lib/mediathek-client";
import type { ApiResultItem } from "@/types";
import type {
  ProviderCapabilities,
  ProviderContentItem,
  ProviderSearchQuery,
  ProviderStatus,
} from "@/types/provider";

const MEDIATHEK_API_URL = "https://mediathekviewweb.de/api/query";

// Keywords that are always skipped (trailers, outtakes, etc.)
const SKIP_KEYWORDS = ["Trailer", "Outtakes:", "(klare Sprache)"];

/**
 * MediathekView Provider
 *
 * Provides access to German public broadcaster content via the MediathekViewWeb API.
 * Supports: ARD, ZDF, ARTE, 3Sat, BR, HR, MDR, NDR, RBB, SR, SWR, WDR, etc.
 */
export class MediathekViewProvider extends BaseProvider {
  readonly id = "mediathekview";
  readonly name = "MediathekView (DE)";
  readonly country = "DE" as const;

  readonly capabilities: ProviderCapabilities = {
    supportsHls: true,
    supportsDirectDownload: true,
    requiresProxy: false,
    hasOfficialApi: false, // MediathekViewWeb is community-maintained
  };

  private minDuration = 300; // 5 minutes default
  private hlsEnabled = false;

  async initialize(): Promise<void> {
    await super.initialize();

    // Load settings
    const minDurationSetting = await getSetting("matching.minDuration");
    if (minDurationSetting) {
      const parsed = parseInt(minDurationSetting, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        this.minDuration = parsed;
      }
    }

    const hlsSetting = await getSetting("download.enableHLS");
    this.hlsEnabled = hlsSetting === "true";

    console.log(
      `[${this.id}] Settings: minDuration=${this.minDuration}s, hlsEnabled=${this.hlsEnabled}`
    );
  }

  async search(query: ProviderSearchQuery): Promise<ProviderContentItem[]> {
    const limit = query.limit || 100;
    const searchQuery = query.query.trim();

    if (!searchQuery || searchQuery.length < 2) {
      return [];
    }

    console.log(`[${this.id}] Searching for: "${searchQuery}" (limit: ${limit})`);

    try {
      const results = await queryMediathekView(
        [{ fields: ["topic", "title"], query: searchQuery }],
        limit * 3 // Fetch more to account for filtering
      );

      const items = this.filterResults(results ?? [], query.type);

      console.log(`[${this.id}] Found ${items.length} items after filtering`);

      return items.slice(0, limit);
    } catch (error) {
      console.error(`[${this.id}] Search error:`, error);
      throw error;
    }
  }

  async checkStatus(): Promise<ProviderStatus> {
    try {
      // Simple health check - fetch with minimal query
      const response = await fetchWithRetry(MEDIATHEK_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: [{ fields: ["topic"], query: "Tagesschau" }],
          sortBy: "filmlisteTimestamp",
          sortOrder: "desc",
          future: false,
          offset: 0,
          size: 1,
        }),
      });

      return {
        available: response.ok,
        lastCheck: Date.now(),
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        available: false,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Filter raw MediathekView results and map to ProviderContentItem
   */
  private filterResults(
    results: ApiResultItem[],
    type?: "all" | "movie" | "series"
  ): ProviderContentItem[] {
    const items: ProviderContentItem[] = [];

    // For movie search, require at least 60 minutes
    const movieMinDuration = 60 * 60;
    const effectiveMinDuration = type === "movie" ? movieMinDuration : this.minDuration;

    for (const result of results) {
      // Skip HLS unless enabled
      if (!this.hlsEnabled && result.url_video.endsWith(".m3u8")) {
        continue;
      }

      // Skip items with unwanted keywords
      if (SKIP_KEYWORDS.some((kw) => result.title.includes(kw))) {
        continue;
      }

      // Skip items shorter than minimum duration
      if (result.duration < effectiveMinDuration) {
        continue;
      }

      items.push(this.mapToContentItem(result));
    }

    return items;
  }

  /**
   * Map API result to ProviderContentItem
   */
  private mapToContentItem(result: ApiResultItem): ProviderContentItem {
    return this.createContentItem({
      id: `${result.channel}-${result.topic}-${result.title}-${result.filmlisteTimestamp}`,
      channel: result.channel,
      topic: result.topic,
      title: result.title,
      description: result.description,
      timestamp: result.filmlisteTimestamp,
      duration: result.duration,
      size: result.size,
      websiteUrl: result.url_website,
      videoUrl: result.url_video,
      videoUrlLow: result.url_video_low || undefined,
      videoUrlHigh: result.url_video_hd || undefined,
    });
  }
}

// Create and export the provider instance
export const mediathekViewProvider = new MediathekViewProvider();
