import { BaseProvider } from "./base";
import { getSetting } from "@/lib/settings";
import { getDetailedVideoInfo, ensureYtdlpExists } from "@/server/ytdlp";
import { queryMediathekView } from "@/lib/mediathek-client";
import type { ApiResultItem } from "@/types";
import type {
  ProviderCapabilities,
  ProviderContentItem,
  ProviderDownloadInfo,
  ProviderSearchQuery,
  ProviderStatus,
} from "@/types/provider";

// Minimum duration for content (5 minutes by default), in seconds.
const DEFAULT_MIN_DURATION = 5 * 60;

// Skip keywords (trailers, clips, etc.)
const SKIP_KEYWORDS = ["Trailer", "Teaser", "Preview", "Clip", "Ausschnitt"];

/**
 * ORF Provider
 *
 * Provides access to Austrian television content from ORF ON.
 *
 * Search: ORF's own on.orf.at/suche page is a client-rendered Nuxt/Vue SPA
 * with no results in the initial HTML, so it can't be scraped by yt-dlp's
 * generic extractor (confirmed: yt-dlp returns "Unsupported URL" against
 * it). ORF's content is already indexed by MediathekViewWeb though (the
 * same community index MediathekViewProvider uses) - ORF entries there are
 * plain HLS (.m3u8) streams, which is exactly why this provider exists
 * (MediathekViewProvider filters .m3u8 out unless HLS is enabled). So
 * search here reuses the same shared MediathekView client, filtered to
 * channel=ORF, rather than duplicating a second scraping approach.
 * (ORF does have its own api-tvthek.orf.at backend the official site uses,
 * confirmed reachable with the client credentials embedded in the site's
 * own page source - but shipping a reverse-engineered, embedded-credential
 * call to a private, unversioned, undocumented API in an upstream PR isn't
 * something to do without ORF's blessing; MediathekViewWeb's coverage is
 * good enough and doesn't have that problem.)
 *
 * Download: still uses yt-dlp, which works fine against a known individual
 * ORF video page (unlike the search page, those aren't client-rendered).
 */
export class OrfProvider extends BaseProvider {
  readonly id = "orf";
  readonly name = "ORF ON (AT)";
  readonly country = "AT" as const;

  readonly capabilities: ProviderCapabilities = {
    supportsHls: true,
    supportsDirectDownload: false, // ORF only provides HLS streams
    requiresProxy: true, // Geo-blocked outside Austria
    hasOfficialApi: false, // Search goes through the community MediathekView index, not an ORF API
  };

  private minDuration = DEFAULT_MIN_DURATION;

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

    console.log(`[${this.id}] Settings: minDuration=${this.minDuration}s`);
  }

  /**
   * Check if provider is enabled. Requires HLS to be enabled (ORF's
   * MediathekView entries are .m3u8 streams, filtered out otherwise).
   */
  async isEnabled(): Promise<boolean> {
    // Check if explicitly disabled
    const enabledSetting = await getSetting(`provider.${this.id}.enabled`);
    if (enabledSetting === "false") {
      return false;
    }

    // If not explicitly enabled, default to disabled
    // ORF is opt-in because it's less stable (no official API)
    if (enabledSetting !== "true") {
      return false;
    }

    // Check if HLS is enabled (required for ORF)
    const hlsEnabled = await getSetting("download.enableHLS");
    if (hlsEnabled !== "true") {
      console.log(`[${this.id}] HLS not enabled - provider disabled`);
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

    const enabled = await this.isEnabled();
    if (!enabled) {
      console.log(`[${this.id}] Provider not enabled`);
      return [];
    }

    console.log(`[${this.id}] Searching for: "${searchQuery}" (limit: ${limit})`);

    try {
      const results = await queryMediathekView(
        [
          { fields: ["topic", "title"], query: searchQuery },
          { fields: ["channel"], query: "ORF" },
        ],
        limit * 3
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
    // Download still needs yt-dlp even though search doesn't.
    const ytdlpAvailable = await ensureYtdlpExists();
    if (!ytdlpAvailable) {
      return {
        available: false,
        lastCheck: Date.now(),
        error: "yt-dlp not available (needed for downloads)",
      };
    }

    const hlsEnabled = await getSetting("download.enableHLS");
    if (hlsEnabled !== "true") {
      return {
        available: false,
        lastCheck: Date.now(),
        error: "HLS downloads not enabled",
      };
    }

    try {
      const results = await queryMediathekView(
        [
          { fields: ["topic", "title"], query: "ZIB" },
          { fields: ["channel"], query: "ORF" },
        ],
        1
      );
      return {
        available: results !== null && results.length > 0,
        lastCheck: Date.now(),
        error:
          results === null
            ? "Failed to query MediathekView"
            : results.length > 0
              ? undefined
              : "MediathekView returned no ORF results",
      };
    } catch (error) {
      return {
        available: false,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : "Failed to reach MediathekView",
      };
    }
  }

  /**
   * Get download info - uses yt-dlp to get the stream URL
   */
  async getDownloadInfo(
    item: ProviderContentItem,
    preferredQuality: "low" | "standard" | "high" = "high"
  ): Promise<ProviderDownloadInfo> {
    // item.videoUrls.standard is MediathekView's own url_video for this
    // entry - already a real HLS manifest URL, not a webpage - yt-dlp
    // extracts the actual stream/formats from it directly.
    const videoUrl = item.videoUrls.standard || item.websiteUrl;

    if (videoUrl) {
      try {
        const videoInfo = await getDetailedVideoInfo(videoUrl);
        if (videoInfo && videoInfo.url) {
          return {
            url: videoUrl, // yt-dlp resolves the actual stream from this manifest URL
            isHls: true,
            filename: this.generateFilename(item, preferredQuality === "high" ? "1080p" : "720p"),
            expectedSize: videoInfo.filesize || 0,
            quality: preferredQuality === "high" ? "1080p" : "720p",
          };
        }
      } catch (error) {
        console.error(`[${this.id}] Failed to get video info for ${videoUrl}:`, error);
      }
    }

    // Fallback to standard download info
    return super.getDownloadInfo(item, preferredQuality);
  }

  /**
   * Filter raw MediathekView results (already channel=ORF via the server-
   * side query filter) and map to ProviderContentItem. MediathekView
   * already gives clean topic/title fields, so unlike the old yt-dlp-entry
   * version, no title-splitting heuristics are needed here.
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
      if (SKIP_KEYWORDS.some((kw) => result.title.toLowerCase().includes(kw.toLowerCase()))) {
        continue;
      }

      if (result.duration < effectiveMinDuration) {
        continue;
      }

      items.push(this.mapToContentItem(result));
    }

    return items;
  }

  /**
   * Map a MediathekView API result to ProviderContentItem
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
export const orfProvider = new OrfProvider();
