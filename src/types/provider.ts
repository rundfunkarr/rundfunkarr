/**
 * Content Provider Types
 *
 * Defines the interface for content providers (MediathekView, SRF, ORF, etc.)
 */

/**
 * Supported countries for content providers
 */
export type ProviderCountry = "DE" | "CH" | "AT";

/**
 * Content item from a provider search result
 */
export interface ProviderContentItem {
  /** Unique identifier for this item (provider-specific) */
  id: string;
  /** Provider that returned this item */
  providerId: string;
  /** Broadcasting channel (e.g., "ARD", "ZDF", "SRF", "ORF") */
  channel: string;
  /** Topic/Show name */
  topic: string;
  /** Episode/Item title */
  title: string;
  /** Description text */
  description: string;
  /** Unix timestamp of when the content was published */
  timestamp: number;
  /** Duration in seconds */
  duration: number;
  /** File size in bytes (0 if unknown) */
  size: number;
  /** URL to the website page for this content */
  websiteUrl: string;
  /** Available video URLs by quality */
  videoUrls: ProviderVideoUrls;
}

/**
 * Video URLs by quality level
 */
export interface ProviderVideoUrls {
  /** Standard quality video URL */
  standard: string;
  /** Low quality video URL (optional) */
  low?: string;
  /** High/HD quality video URL (optional) */
  high?: string;
}

/**
 * Search query parameters for providers
 */
export interface ProviderSearchQuery {
  /** Search text */
  query: string;
  /** Maximum number of results to return */
  limit?: number;
  /** Content type filter */
  type?: "all" | "movie" | "series";
}

/**
 * Download information for a content item
 */
export interface ProviderDownloadInfo {
  /** URL to download */
  url: string;
  /** Whether this is an HLS stream */
  isHls: boolean;
  /** Suggested filename */
  filename: string;
  /** Expected file size in bytes (0 if unknown) */
  expectedSize: number;
  /** Quality label (e.g., "720p", "1080p") */
  quality: string;
}

/**
 * Provider capabilities
 */
export interface ProviderCapabilities {
  /** Whether the provider supports HLS streams */
  supportsHls: boolean;
  /** Whether the provider supports direct downloads */
  supportsDirectDownload: boolean;
  /** Whether the provider requires a proxy for access */
  requiresProxy: boolean;
  /** Whether the provider has an official API */
  hasOfficialApi: boolean;
}

/**
 * Provider status information
 */
export interface ProviderStatus {
  /** Whether the provider is available/healthy */
  available: boolean;
  /** Last successful check timestamp */
  lastCheck: number;
  /** Error message if not available */
  error?: string;
}

/**
 * Content Provider interface
 *
 * All content providers must implement this interface
 */
export interface ContentProvider {
  /** Unique provider identifier */
  readonly id: string;
  /** Human-readable provider name */
  readonly name: string;
  /** Country code for this provider */
  readonly country: ProviderCountry;
  /** Provider capabilities */
  readonly capabilities: ProviderCapabilities;

  /**
   * Initialize the provider
   * Called once when the provider is registered
   */
  initialize(): Promise<void>;

  /**
   * Search for content
   * @param query Search parameters
   * @returns Array of content items matching the query
   */
  search(query: ProviderSearchQuery): Promise<ProviderContentItem[]>;

  /**
   * Get download information for a content item
   * @param item Content item to get download info for
   * @param preferredQuality Preferred quality level
   * @returns Download information
   */
  getDownloadInfo(
    item: ProviderContentItem,
    preferredQuality?: "low" | "standard" | "high"
  ): Promise<ProviderDownloadInfo>;

  /**
   * Check if the provider is available
   * @returns Provider status
   */
  checkStatus(): Promise<ProviderStatus>;

  /**
   * Whether this provider is enabled
   */
  isEnabled(): Promise<boolean>;
}

/**
 * Provider configuration stored in settings
 */
export interface ProviderConfig {
  /** Provider ID */
  providerId: string;
  /** Whether the provider is enabled */
  enabled: boolean;
  /** Provider-specific settings */
  settings?: Record<string, string>;
}

/**
 * Aggregate search result from multiple providers
 */
export interface AggregatedSearchResult {
  /** All items from all providers */
  items: ProviderContentItem[];
  /** Provider-specific result counts */
  providerCounts: Record<string, number>;
  /** Any errors that occurred during search */
  errors: Array<{ providerId: string; error: string }>;
}
