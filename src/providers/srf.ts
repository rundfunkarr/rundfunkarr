import { BaseProvider } from "./base";
import { getSetting } from "@/lib/settings";
import {
  searchVideos,
  getMediaComposition,
  getBestStreamUrl,
  checkApiStatus,
  type SrgssrMediaItem,
} from "@/services/srgssr-api";
import type {
  ProviderCapabilities,
  ProviderContentItem,
  ProviderDownloadInfo,
  ProviderSearchQuery,
  ProviderStatus,
} from "@/types/provider";

// Minimum duration for content (5 minutes by default)
// Note: SRG-SSR API returns duration in MILLISECONDS, so we use ms here
// Setting matching.minDuration is in seconds, converted to ms in initialize()
const DEFAULT_MIN_DURATION = 5 * 60 * 1000; // milliseconds

// Skip keywords (trailers, clips, etc.)
const SKIP_KEYWORDS = ["Trailer", "Teaser", "Preview", "Clip"];

/**
 * SRF Provider
 *
 * Provides access to Swiss German television content via the official SRG-SSR API.
 * SRF (Schweizer Radio und Fernsehen) is the German-language unit of SRG SSR.
 *
 * Content may be geo-blocked outside Switzerland - use proxy settings if needed.
 */
export class SrfProvider extends BaseProvider {
  readonly id = "srf";
  readonly name = "SRF Play (CH)";
  readonly country = "CH" as const;

  readonly capabilities: ProviderCapabilities = {
    supportsHls: true,
    supportsDirectDownload: false, // SRF only provides HLS streams
    requiresProxy: true, // Geo-blocked outside Switzerland
    hasOfficialApi: true,
  };

  private minDuration = DEFAULT_MIN_DURATION;

  async initialize(): Promise<void> {
    await super.initialize();

    // Load settings
    const minDurationSetting = await getSetting("matching.minDuration");
    if (minDurationSetting) {
      const parsed = parseInt(minDurationSetting, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        // Convert seconds to milliseconds (SRG-SSR API uses ms)
        this.minDuration = parsed * 1000;
      }
    }

    console.log(`[${this.id}] Settings: minDuration=${this.minDuration}ms`);
  }

  /**
   * Check if provider is enabled
   * Requires API credentials to be configured
   */
  async isEnabled(): Promise<boolean> {
    // Check if explicitly disabled
    const enabledSetting = await getSetting(`provider.${this.id}.enabled`);
    if (enabledSetting === "false") {
      return false;
    }

    // Check if API credentials are configured
    const consumerKey = await getSetting("api.srgssr.consumerKey");
    const consumerSecret = await getSetting("api.srgssr.consumerSecret");

    if (!consumerKey || !consumerSecret) {
      return false;
    }

    return true;
  }

  async search(query: ProviderSearchQuery): Promise<ProviderContentItem[]> {
    const limit = query.limit || 50;
    const searchQuery = query.query.trim();

    if (!searchQuery || searchQuery.length < 2) {
      return [];
    }

    // Check if enabled
    const enabled = await this.isEnabled();
    if (!enabled) {
      console.log(`[${this.id}] Provider not enabled (missing API credentials)`);
      return [];
    }

    console.log(`[${this.id}] Searching for: "${searchQuery}" (limit: ${limit})`);

    try {
      // Search SRF videos
      const results = await searchVideos(searchQuery, "SRF", limit * 2);

      if (!results || results.length === 0) {
        console.log(`[${this.id}] No results found`);
        return [];
      }

      console.log(`[${this.id}] API returned ${results.length} results`);

      // Filter and map results
      const items = this.filterAndMapResults(results, query.type);

      console.log(`[${this.id}] Found ${items.length} items after filtering`);

      return items.slice(0, limit);
    } catch (error) {
      console.error(`[${this.id}] Search error:`, error);
      throw error;
    }
  }

  async checkStatus(): Promise<ProviderStatus> {
    const status = await checkApiStatus();

    if (!status.configured) {
      return {
        available: false,
        lastCheck: Date.now(),
        error: "API credentials not configured",
      };
    }

    return {
      available: status.working,
      lastCheck: Date.now(),
      error: status.error,
    };
  }

  /**
   * Get download info - fetches the HLS stream URL
   */
  async getDownloadInfo(
    item: ProviderContentItem,
    preferredQuality: "low" | "standard" | "high" = "high"
  ): Promise<ProviderDownloadInfo> {
    // For SRF, we need to fetch the media composition to get the stream URL
    // The URN is stored in the item ID
    const urn = this.extractUrn(item);

    if (urn) {
      try {
        const composition = await getMediaComposition(urn);
        if (composition) {
          const streamUrl = getBestStreamUrl(composition);
          if (streamUrl) {
            return {
              url: streamUrl,
              isHls: true,
              filename: this.generateFilename(item, preferredQuality === "high" ? "1080p" : "720p"),
              expectedSize: 0, // Unknown for HLS
              quality: preferredQuality === "high" ? "1080p" : "720p",
            };
          }
        }
      } catch (error) {
        console.error(`[${this.id}] Failed to get media composition for ${urn}:`, error);
      }
    }

    // Fallback to standard video URL
    return super.getDownloadInfo(item, preferredQuality);
  }

  /**
   * Filter and map API results to ProviderContentItem format
   */
  private filterAndMapResults(
    results: SrgssrMediaItem[],
    type?: "all" | "movie" | "series"
  ): ProviderContentItem[] {
    const items: ProviderContentItem[] = [];

    // For movie search, require at least 60 minutes
    const movieMinDuration = 60 * 60 * 1000;
    const effectiveMinDuration = type === "movie" ? movieMinDuration : this.minDuration;

    for (const result of results) {
      // Skip non-video content
      if (result.mediaType !== "VIDEO") {
        continue;
      }

      // Skip livestreams
      if (result.type === "LIVESTREAM") {
        continue;
      }

      // Skip trailers and clips
      if (result.type === "TRAILER" || result.type === "CLIP") {
        continue;
      }

      // Skip items with unwanted keywords in title
      if (SKIP_KEYWORDS.some((kw) => result.title.toLowerCase().includes(kw.toLowerCase()))) {
        continue;
      }

      // Skip items shorter than minimum duration
      if (result.duration < effectiveMinDuration) {
        continue;
      }

      // Skip content not playable abroad (unless proxy is configured)
      // We'll still include it but the download might fail without proxy
      // if (!result.playableAbroad) {
      //   continue;
      // }

      items.push(this.mapToContentItem(result));
    }

    return items;
  }

  /**
   * Map SRG-SSR API result to ProviderContentItem
   */
  private mapToContentItem(result: SrgssrMediaItem): ProviderContentItem {
    // Parse date
    const timestamp = new Date(result.date).getTime() / 1000;

    // Build channel name
    const channel = result.channel?.title || result.vendor || "SRF";

    // Build topic from show or use title
    const topic = result.show?.title || result.title;

    // Build title (episode title or main title)
    const title = result.episode?.title || result.title;

    // Duration is in milliseconds, convert to seconds
    const durationSeconds = Math.floor(result.duration / 1000);

    // Build a placeholder URL - actual HLS URL will be fetched via getDownloadInfo
    // Store the URN in the ID for later retrieval
    const videoUrl = `https://www.srf.ch/play/tv/redirect/detail/${result.id}`;

    return this.createContentItem({
      id: result.urn, // Store URN as ID for later media composition lookup
      channel,
      topic,
      title,
      description: result.description || result.show?.description || "",
      timestamp,
      duration: durationSeconds,
      size: 0, // Unknown until download
      websiteUrl: `https://www.srf.ch/play/tv/sendung/${result.show?.id || result.id}`,
      videoUrl,
      videoUrlHigh: videoUrl,
    });
  }

  /**
   * Extract URN from content item
   */
  private extractUrn(item: ProviderContentItem): string | null {
    // The URN is stored in the item ID
    if (item.id.startsWith("urn:")) {
      return item.id;
    }
    return null;
  }
}

// Create and export the provider instance
export const srfProvider = new SrfProvider();
