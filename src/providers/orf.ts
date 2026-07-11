import { BaseProvider } from "./base";
import { getSetting } from "@/lib/settings";
import {
  extractPlaylistEntries,
  getDetailedVideoInfo,
  ensureYtdlpExists,
  type YtdlpPlaylistEntry,
} from "@/server/ytdlp";
import type {
  ProviderCapabilities,
  ProviderContentItem,
  ProviderDownloadInfo,
  ProviderSearchQuery,
  ProviderStatus,
} from "@/types/provider";

// ORF ON search URL template
const ORF_SEARCH_URL = "https://on.orf.at/suche?q=";

// Minimum duration for content (5 minutes by default)
// Note: yt-dlp returns duration in SECONDS, so we use seconds here
// (unlike SRF which uses milliseconds because SRG-SSR API returns ms)
const DEFAULT_MIN_DURATION = 5 * 60; // seconds

// Skip keywords (trailers, clips, etc.)
const SKIP_KEYWORDS = ["Trailer", "Teaser", "Preview", "Clip", "Ausschnitt"];

/**
 * ORF Provider
 *
 * Provides access to Austrian television content from ORF ON.
 * Uses yt-dlp for both search and download since ORF has no official public API.
 *
 * Content is geo-blocked outside Austria - use proxy settings if needed.
 *
 * Note: This provider is less stable than providers with official APIs (like SRF)
 * as it relies on yt-dlp's web scraping capabilities. If ORF changes their website,
 * this may break until yt-dlp is updated.
 */
export class OrfProvider extends BaseProvider {
  readonly id = "orf";
  readonly name = "ORF ON (AT)";
  readonly country = "AT" as const;

  readonly capabilities: ProviderCapabilities = {
    supportsHls: true,
    supportsDirectDownload: false, // ORF only provides HLS streams
    requiresProxy: true, // Geo-blocked outside Austria
    hasOfficialApi: false, // No official API - uses yt-dlp scraping
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
   * Check if provider is enabled
   * Requires yt-dlp to be available and HLS to be enabled
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

    // Check if enabled
    const enabled = await this.isEnabled();
    if (!enabled) {
      console.log(`[${this.id}] Provider not enabled`);
      return [];
    }

    // Ensure yt-dlp is available
    const ytdlpAvailable = await ensureYtdlpExists();
    if (!ytdlpAvailable) {
      console.error(`[${this.id}] yt-dlp not available`);
      return [];
    }

    console.log(`[${this.id}] Searching for: "${searchQuery}" (limit: ${limit})`);

    try {
      // Build search URL
      const searchUrl = `${ORF_SEARCH_URL}${encodeURIComponent(searchQuery)}`;

      // Use yt-dlp to extract playlist entries from search page
      const entries = await extractPlaylistEntries(searchUrl, limit * 2);

      if (!entries || entries.length === 0) {
        console.log(`[${this.id}] No results found`);
        return [];
      }

      console.log(`[${this.id}] yt-dlp returned ${entries.length} entries`);

      // Filter and map results
      const items = this.filterAndMapResults(entries, query.type);

      console.log(`[${this.id}] Found ${items.length} items after filtering`);

      return items.slice(0, limit);
    } catch (error) {
      console.error(`[${this.id}] Search error:`, error);
      throw error;
    }
  }

  async checkStatus(): Promise<ProviderStatus> {
    // Check if yt-dlp is available
    const ytdlpAvailable = await ensureYtdlpExists();
    if (!ytdlpAvailable) {
      return {
        available: false,
        lastCheck: Date.now(),
        error: "yt-dlp not available",
      };
    }

    // Check if HLS is enabled
    const hlsEnabled = await getSetting("download.enableHLS");
    if (hlsEnabled !== "true") {
      return {
        available: false,
        lastCheck: Date.now(),
        error: "HLS downloads not enabled",
      };
    }

    // Try a simple extraction to verify ORF is accessible
    try {
      await extractPlaylistEntries(`${ORF_SEARCH_URL}test`, 1);
      // Even empty results are OK - it means yt-dlp can access ORF
      return {
        available: true,
        lastCheck: Date.now(),
      };
    } catch (error) {
      return {
        available: false,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : "Failed to access ORF",
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
    // For ORF, the item URL is the webpage URL
    // We need to use yt-dlp to extract the actual stream URL
    const videoUrl = item.videoUrls.standard || item.websiteUrl;

    if (videoUrl) {
      try {
        const videoInfo = await getDetailedVideoInfo(videoUrl);
        if (videoInfo && videoInfo.url) {
          return {
            url: videoUrl, // Use the webpage URL - yt-dlp will handle extraction
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
   * Filter and map yt-dlp results to ProviderContentItem format
   */
  private filterAndMapResults(
    entries: YtdlpPlaylistEntry[],
    type?: "all" | "movie" | "series"
  ): ProviderContentItem[] {
    const items: ProviderContentItem[] = [];

    // For movie search, require at least 60 minutes
    const movieMinDuration = 60 * 60;
    const effectiveMinDuration = type === "movie" ? movieMinDuration : this.minDuration;

    for (const entry of entries) {
      // Skip entries without title or URL
      if (!entry.title || !entry.url) {
        continue;
      }

      // Skip items with unwanted keywords in title
      if (SKIP_KEYWORDS.some((kw) => entry.title.toLowerCase().includes(kw.toLowerCase()))) {
        continue;
      }

      // Skip items shorter than minimum duration (if duration is known)
      if (entry.duration && entry.duration < effectiveMinDuration) {
        continue;
      }

      items.push(this.mapToContentItem(entry));
    }

    return items;
  }

  /**
   * Map yt-dlp entry to ProviderContentItem
   */
  private mapToContentItem(entry: YtdlpPlaylistEntry): ProviderContentItem {
    // Parse date from upload_date (YYYYMMDD format)
    let timestamp = Date.now() / 1000;
    if (entry.upload_date && entry.upload_date.length === 8) {
      const year = entry.upload_date.substring(0, 4);
      const month = entry.upload_date.substring(4, 6);
      const day = entry.upload_date.substring(6, 8);
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) {
        timestamp = date.getTime() / 1000;
      }
    }

    // Build channel name
    const channel = entry.channel || entry.uploader || "ORF";

    // Build topic from series or use title
    const topic = entry.series || this.extractTopic(entry.title);

    // Build title (episode title or main title)
    const title = this.extractEpisodeTitle(entry.title, entry.series);

    // Duration in seconds
    const duration = entry.duration || 0;

    return this.createContentItem({
      id: entry.id || entry.url,
      channel,
      topic,
      title,
      description: entry.description || "",
      timestamp,
      duration,
      size: 0, // Unknown until download
      websiteUrl: entry.url,
      videoUrl: entry.url, // yt-dlp will handle extraction
      videoUrlHigh: entry.url,
    });
  }

  /**
   * Extract topic from title (e.g., "ZIB 2: Interview with..." -> "ZIB 2")
   */
  private extractTopic(title: string): string {
    // Try to extract show name from common patterns
    // Pattern: "Show Name: Episode Title" or "Show Name - Episode Title"
    const colonIndex = title.indexOf(":");
    const dashIndex = title.indexOf(" - ");

    if (colonIndex > 0 && colonIndex < 50) {
      return title.substring(0, colonIndex).trim();
    }
    if (dashIndex > 0 && dashIndex < 50) {
      return title.substring(0, dashIndex).trim();
    }

    return title;
  }

  /**
   * Extract episode title from full title
   */
  private extractEpisodeTitle(title: string, series?: string): string {
    // If we have a series name, try to remove it from the title
    if (series && title.startsWith(series)) {
      let remainder = title.substring(series.length);
      // Remove leading separators
      if (remainder.startsWith(":") || remainder.startsWith(" -")) {
        remainder = remainder.substring(remainder.startsWith(":") ? 1 : 2).trim();
      }
      if (remainder) {
        return remainder;
      }
    }

    // Otherwise, try to extract episode title from patterns
    const colonIndex = title.indexOf(":");
    if (colonIndex > 0 && colonIndex < 50) {
      return title.substring(colonIndex + 1).trim();
    }

    const dashIndex = title.indexOf(" - ");
    if (dashIndex > 0 && dashIndex < 50) {
      return title.substring(dashIndex + 3).trim();
    }

    return title;
  }
}

// Create and export the provider instance
export const orfProvider = new OrfProvider();
