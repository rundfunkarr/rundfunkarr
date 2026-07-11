import type {
  ContentProvider,
  ProviderContentItem,
  ProviderSearchQuery,
  ProviderStatus,
  AggregatedSearchResult,
  ProviderCountry,
} from "@/types/provider";

/**
 * Provider Registry
 *
 * Central registry for managing content providers.
 * Handles provider registration, initialization, and aggregated searches.
 */
class ProviderRegistry {
  private providers: Map<string, ContentProvider> = new Map();
  private initialized = false;

  /**
   * Register a provider
   * @param provider The provider instance to register
   */
  register(provider: ContentProvider): void {
    if (this.providers.has(provider.id)) {
      console.warn(`[ProviderRegistry] Provider ${provider.id} already registered, replacing`);
    }
    this.providers.set(provider.id, provider);
    console.log(`[ProviderRegistry] Registered provider: ${provider.id} (${provider.name})`);
  }

  /**
   * Initialize all registered providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log(`[ProviderRegistry] Initializing ${this.providers.size} providers...`);

    const initPromises = Array.from(this.providers.values()).map(async (provider) => {
      try {
        await provider.initialize();
      } catch (error) {
        console.error(`[ProviderRegistry] Failed to initialize ${provider.id}:`, error);
      }
    });

    await Promise.all(initPromises);
    this.initialized = true;
    console.log(`[ProviderRegistry] All providers initialized`);
  }

  /**
   * Get a provider by ID
   * @param id Provider ID
   * @returns The provider or undefined if not found
   */
  getProvider(id: string): ContentProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): ContentProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all enabled providers
   */
  async getEnabledProviders(): Promise<ContentProvider[]> {
    const providers = this.getAllProviders();
    const enabledChecks = await Promise.all(
      providers.map(async (p) => ({ provider: p, enabled: await p.isEnabled() }))
    );
    return enabledChecks.filter((c) => c.enabled).map((c) => c.provider);
  }

  /**
   * Get providers by country
   * @param country Country code
   */
  getProvidersByCountry(country: ProviderCountry): ContentProvider[] {
    return this.getAllProviders().filter((p) => p.country === country);
  }

  /**
   * Search across all enabled providers
   * @param query Search parameters
   * @returns Aggregated search results from all providers
   */
  async searchAll(query: ProviderSearchQuery): Promise<AggregatedSearchResult> {
    await this.ensureInitialized();

    const enabledProviders = await this.getEnabledProviders();
    const results: ProviderContentItem[] = [];
    const providerCounts: Record<string, number> = {};
    const errors: Array<{ providerId: string; error: string }> = [];

    console.log(
      `[ProviderRegistry] Searching ${enabledProviders.length} providers for: "${query.query}"`
    );

    const searchPromises = enabledProviders.map(async (provider) => {
      try {
        const items = await provider.search(query);
        providerCounts[provider.id] = items.length;
        return items;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`[ProviderRegistry] Search failed for ${provider.id}:`, errorMessage);
        errors.push({ providerId: provider.id, error: errorMessage });
        providerCounts[provider.id] = 0;
        return [];
      }
    });

    const allResults = await Promise.all(searchPromises);
    for (const items of allResults) {
      results.push(...items);
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit if specified
    const limitedResults = query.limit ? results.slice(0, query.limit) : results;

    console.log(
      `[ProviderRegistry] Search complete: ${limitedResults.length} results from ${enabledProviders.length} providers`
    );

    return {
      items: limitedResults,
      providerCounts,
      errors,
    };
  }

  /**
   * Search a specific provider
   * @param providerId Provider ID
   * @param query Search parameters
   * @returns Search results from the specified provider
   */
  async searchProvider(
    providerId: string,
    query: ProviderSearchQuery
  ): Promise<ProviderContentItem[]> {
    await this.ensureInitialized();

    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    const enabled = await provider.isEnabled();
    if (!enabled) {
      console.warn(`[ProviderRegistry] Provider ${providerId} is disabled`);
      return [];
    }

    return provider.search(query);
  }

  /**
   * Get status of all providers
   */
  async getProvidersStatus(): Promise<Record<string, ProviderStatus & { enabled: boolean }>> {
    await this.ensureInitialized();

    const statuses: Record<string, ProviderStatus & { enabled: boolean }> = {};

    for (const provider of this.providers.values()) {
      try {
        const [status, enabled] = await Promise.all([provider.checkStatus(), provider.isEnabled()]);
        statuses[provider.id] = { ...status, enabled };
      } catch (error) {
        statuses[provider.id] = {
          available: false,
          lastCheck: Date.now(),
          error: error instanceof Error ? error.message : "Unknown error",
          enabled: false,
        };
      }
    }

    return statuses;
  }

  /**
   * Get provider info for display
   */
  getProviderInfo(): Array<{
    id: string;
    name: string;
    country: ProviderCountry;
    capabilities: ContentProvider["capabilities"];
  }> {
    return this.getAllProviders().map((p) => ({
      id: p.id,
      name: p.name,
      country: p.country,
      capabilities: p.capabilities,
    }));
  }

  /**
   * Ensure the registry is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// Singleton instance
export const providerRegistry = new ProviderRegistry();

/**
 * Register a provider with the global registry
 */
export function registerProvider(provider: ContentProvider): void {
  providerRegistry.register(provider);
}

/**
 * Initialize the provider registry
 * Should be called at application startup
 */
export async function initializeProviders(): Promise<void> {
  await providerRegistry.initialize();
}
