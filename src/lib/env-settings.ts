import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { prisma } from "./db";
import { clearSettingsCache } from "./settings";
import { createLogger } from "@/lib/logger";

const log = createLogger("Settings");

const ENV_SETTINGS = {
  TVDB_API_KEY: "api.tvdb.key",
  TVDB_PIN: "api.tvdb.pin",
  TMDB_API_KEY: "api.tmdb.key",
  DOWNLOAD_FOLDER_PATH: "download.path",
  MEDIATHEK_SOURCE: "mediathek.source",
  NOTIFY_WEBHOOK_URL: "notifications.webhook.url",
  NOTIFY_NTFY_URL: "notifications.ntfy.url",
  NOTIFY_NTFY_TOPIC: "notifications.ntfy.topic",
  NOTIFY_NTFY_TOKEN: "notifications.ntfy.token",
  NOTIFY_GOTIFY_URL: "notifications.gotify.url",
  NOTIFY_GOTIFY_TOKEN: "notifications.gotify.token",
  NOTIFY_DISCORD_WEBHOOK_URL: "notifications.discord.url",
} as const;

/** Variables with a fixed set of values; anything else is ignored with a warning. */
const ENV_ALLOWED_VALUES: Partial<Record<keyof typeof ENV_SETTINGS, readonly string[]>> = {
  MEDIATHEK_SOURCE: ["mediathekviewweb", "local"],
};

/** Initialize empty settings from runtime environment variables, preserving UI configuration. */
export async function initSettingsFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<number> {
  // next build also loads instrumentation; it must not persist build-machine credentials.
  if (env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return 0;

  const entries = Object.entries(ENV_SETTINGS).flatMap(([variable, key]) => {
    const value = env[variable]?.trim();
    if (!value) return [];
    const allowed = ENV_ALLOWED_VALUES[variable as keyof typeof ENV_SETTINGS];
    if (allowed && !allowed.includes(value.toLowerCase())) {
      log.warn(`${variable}=${value} ignored; allowed: ${allowed.join(", ")}`);
      return [];
    }
    return [{ key, value: allowed ? value.toLowerCase() : value }];
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
