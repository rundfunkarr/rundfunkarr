import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { prisma } from "./db";
import { clearSettingsCache } from "./settings";

const ENV_SETTINGS = {
  TVDB_API_KEY: "api.tvdb.key",
  TVDB_PIN: "api.tvdb.pin",
  TMDB_API_KEY: "api.tmdb.key",
  DOWNLOAD_FOLDER_PATH: "download.path",
} as const;

/** Initialize empty settings from runtime environment variables, preserving UI configuration. */
export async function initSettingsFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<number> {
  // next build also loads instrumentation; it must not persist build-machine credentials.
  if (env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return 0;

  const entries = Object.entries(ENV_SETTINGS).flatMap(([variable, key]) => {
    const value = env[variable]?.trim();
    return value ? [{ key, value }] : [];
  });
  if (entries.length === 0) return 0;

  const initialized = await prisma.$transaction(async (tx) => {
    let count = 0;
    let tvdbChanged = false;
    for (const { key, value } of entries) {
      // The conditional upsert also preserves values written by another starting process.
      const changed = await tx.$executeRaw`
        INSERT INTO "Config" ("key", "value") VALUES (${key}, ${value})
        ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"
        WHERE "Config"."value" = ''
      `;
      count += changed;
      if (changed > 0 && key.startsWith("api.tvdb.")) tvdbChanged = true;
    }
    if (tvdbChanged) {
      await tx.config.deleteMany({
        where: { key: { in: ["tvdb_token", "tvdb_token_expiry"] } },
      });
    }
    return count;
  });

  if (initialized > 0) clearSettingsCache();
  return initialized;
}
