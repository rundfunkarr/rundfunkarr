import { prisma } from "@/lib/db";

// Cache for settings to avoid repeated DB queries
const settingsCache: Map<string, { value: string; expiry: number }> = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute
const DEFAULT_MIN_DURATION_SECONDS = 300;

export async function getSetting(key: string): Promise<string | null> {
  // Check cache first
  const cached = settingsCache.get(key);
  if (cached && Date.now() < cached.expiry) {
    return cached.value;
  }

  // Fetch from database
  const config = await prisma.config.findUnique({
    where: { key },
  });

  if (config) {
    settingsCache.set(key, {
      value: config.value,
      expiry: Date.now() + CACHE_TTL,
    });
    return config.value;
  }

  return null;
}

export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};

  // Check which keys need fetching
  const keysToFetch: string[] = [];
  for (const key of keys) {
    const cached = settingsCache.get(key);
    if (cached && Date.now() < cached.expiry) {
      result[key] = cached.value;
    } else {
      keysToFetch.push(key);
    }
  }

  // Fetch missing keys from database
  if (keysToFetch.length > 0) {
    const configs = await prisma.config.findMany({
      where: { key: { in: keysToFetch } },
    });

    const configMap = new Map(configs.map((c) => [c.key, c.value]));

    for (const key of keysToFetch) {
      const value = configMap.get(key);
      if (value !== undefined) {
        // Cache all values including empty strings
        settingsCache.set(key, {
          value,
          expiry: Date.now() + CACHE_TTL,
        });
        result[key] = value;
      } else {
        result[key] = null;
      }
    }
  }

  return result;
}

export async function getMinDurationSeconds(): Promise<number> {
  const setting = await getSetting("matching.minDuration");
  if (setting) {
    const parsed = parseInt(setting, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return DEFAULT_MIN_DURATION_SECONDS;
}

export async function isMkvConversionEnabled(): Promise<boolean> {
  return (await getSetting("download.convertToMkv")) !== "false";
}

export function clearSettingsCache(): void {
  settingsCache.clear();
}
