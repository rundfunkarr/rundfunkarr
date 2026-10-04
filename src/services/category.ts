import { prisma } from "@/lib/db";
import { searchMulti } from "./tmdb";

export type CategoryType = "movie" | "tv" | "unknown";

/**
 * Get the category (movie/tv/unknown) for a MediathekView topic.
 * Uses database cache, falls back to TMDB multi-search on cache miss.
 */
export async function getCategoryForTopic(topic: string): Promise<CategoryType> {
  if (!topic) {
    return "unknown";
  }

  // Check database cache first
  const cached = await prisma.topicCategory.findUnique({
    where: { topic },
  });

  if (cached) {
    return cached.category as CategoryType;
  }

  // Cache miss - query TMDB
  const result = await searchMulti(topic);

  // Store in database cache
  await prisma.topicCategory.create({
    data: {
      topic,
      category: result.mediaType,
      tmdbId: result.tmdbId,
    },
  });

  return result.mediaType;
}

/**
 * Read known categories without starting external lookups for a search result list.
 */
export async function getCachedCategoriesForTopics(
  topics: string[]
): Promise<Map<string, CategoryType>> {
  const uniqueTopics = [...new Set(topics.filter(Boolean))];
  const categoryMap = new Map<string, CategoryType>();
  if (!uniqueTopics.length) return categoryMap;

  // First, check all cached entries in one query
  const cachedEntries = await prisma.topicCategory.findMany({
    where: {
      topic: { in: uniqueTopics },
    },
  });

  for (const entry of cachedEntries) {
    categoryMap.set(entry.topic, entry.category as CategoryType);
  }

  return categoryMap;
}

/**
 * Get categories for multiple topics, resolving uncached topics through TMDB.
 */
export async function getCategoriesForTopics(topics: string[]): Promise<Map<string, CategoryType>> {
  const uniqueTopics = [...new Set(topics.filter(Boolean))];
  const categoryMap = await getCachedCategoriesForTopics(uniqueTopics);

  // Find topics that need TMDB lookup
  const uncachedTopics = uniqueTopics.filter((t) => !categoryMap.has(t));

  // Query TMDB for uncached topics in parallel
  const tmdbResults = await Promise.all(
    uncachedTopics.map(async (topic) => {
      const result = await searchMulti(topic);
      return { topic, ...result };
    })
  );

  // Store new entries in database (use upsert to handle race conditions)
  for (const r of tmdbResults) {
    await prisma.topicCategory.upsert({
      where: { topic: r.topic },
      update: {},
      create: {
        topic: r.topic,
        category: r.mediaType,
        tmdbId: r.tmdbId,
      },
    });
  }

  // Add to result map
  for (const result of tmdbResults) {
    categoryMap.set(result.topic, result.mediaType);
  }

  return categoryMap;
}
