import { getSetting } from "@/lib/settings";
import { isHlsUrl } from "@/server/ytdlp";
import type {
  ContentProvider,
  ProviderCapabilities,
  ProviderContentItem,
  ProviderCountry,
  ProviderDownloadInfo,
  ProviderSearchQuery,
  ProviderStatus,
} from "@/types/provider";

/**
 * Base class for content providers
 *
 * Provides common functionality that can be shared across providers
 */
export abstract class BaseProvider implements ContentProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly country: ProviderCountry;
  abstract readonly capabilities: ProviderCapabilities;

  protected initialized = false;

  /**
   * Initialize the provider
   * Override in subclasses for provider-specific initialization
   */
  async initialize(): Promise<void> {
    this.initialized = true;
    console.log(`[${this.id}] Provider initialized`);
  }

  /**
   * Search for content - must be implemented by subclasses
   */
  abstract search(query: ProviderSearchQuery): Promise<ProviderContentItem[]>;

  /**
   * Get download information for a content item
   * Default implementation - can be overridden by subclasses
   */
  async getDownloadInfo(
    item: ProviderContentItem,
    preferredQuality: "low" | "standard" | "high" = "high"
  ): Promise<ProviderDownloadInfo> {
    // Select URL based on preferred quality
    let url = item.videoUrls.standard;
    let quality = "720p";

    if (preferredQuality === "high" && item.videoUrls.high) {
      url = item.videoUrls.high;
      quality = "1080p";
    } else if (preferredQuality === "low" && item.videoUrls.low) {
      url = item.videoUrls.low;
      quality = "480p";
    }

    // Check if it's an HLS stream
    const isHls = isHlsUrl(url);

    // Generate filename
    const filename = this.generateFilename(item, quality);

    return {
      url,
      isHls,
      filename,
      expectedSize: item.size,
      quality,
    };
  }

  /**
   * Check if the provider is available
   * Default implementation - can be overridden by subclasses
   */
  async checkStatus(): Promise<ProviderStatus> {
    return {
      available: true,
      lastCheck: Date.now(),
    };
  }

  /**
   * Check if this provider is enabled in settings
   */
  async isEnabled(): Promise<boolean> {
    const setting = await getSetting(`provider.${this.id}.enabled`);
    // Default to enabled for MediathekView, disabled for others
    if (setting === null) {
      return this.id === "mediathekview";
    }
    return setting === "true";
  }

  /**
   * Get a provider-specific setting
   */
  protected async getProviderSetting(key: string): Promise<string | null> {
    return getSetting(`provider.${this.id}.${key}`);
  }

  /**
   * Generate a standardized filename for downloads
   */
  protected generateFilename(item: ProviderContentItem, quality: string): string {
    // Format: Topic.Title.GERMAN.Quality.WEB.h264-PROVIDER
    const sanitizedTopic = this.sanitizeForFilename(item.topic);
    const sanitizedTitle = this.sanitizeForFilename(item.title);
    const year = new Date(item.timestamp * 1000).getFullYear();

    return `${sanitizedTopic}.${sanitizedTitle}.${year}.GERMAN.${quality}.WEB.h264-${this.id.toUpperCase()}`;
  }

  /**
   * Sanitize a string for use in filenames
   */
  protected sanitizeForFilename(str: string): string {
    return str
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/Ä/g, "Ae")
      .replace(/Ö/g, "Oe")
      .replace(/Ü/g, "Ue")
      .replace(/&/g, "and")
      .replace(/[/:;,"'@#?$%^*+=!|<>()]/g, "")
      .replace(/\s+/g, ".")
      .replace(/\.+/g, ".");
  }

  /**
   * Create a content item from raw API data
   * Helper method for subclasses
   */
  protected createContentItem(data: {
    id: string;
    channel: string;
    topic: string;
    title: string;
    description: string;
    timestamp: number;
    duration: number;
    size: number;
    websiteUrl: string;
    videoUrl: string;
    videoUrlLow?: string;
    videoUrlHigh?: string;
  }): ProviderContentItem {
    return {
      id: data.id,
      providerId: this.id,
      channel: data.channel,
      topic: data.topic,
      title: data.title,
      description: data.description,
      timestamp: data.timestamp,
      duration: data.duration,
      size: data.size,
      websiteUrl: data.websiteUrl,
      videoUrls: {
        standard: data.videoUrl,
        low: data.videoUrlLow,
        high: data.videoUrlHigh,
      },
    };
  }
}
