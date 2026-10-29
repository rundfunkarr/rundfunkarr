import { rememberLogSecret, logger } from "@/lib/logger";
import { clearTokenCache as clearSrfTokenCache } from "@/services/srgssr-api";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clearSettingsCache } from "@/lib/settings";
import { clearTTLCache, mediathekCache } from "@/lib/cache";
import { isTvdbCredentialSettingKey } from "@/lib/tvdb-auth";
import { clearTvdbTokenCache } from "@/services/tvdb";
import { isMaskedSetting, maskSetting } from "@/lib/settings-redaction";

// Default settings
const DEFAULT_SETTINGS: Record<string, string> = {
  // General
  "download.path": "/downloads",
  "download.quality": "all",
  "download.convertToMkv": "true",
  "download.subtitleMode": "off",
  "download.postProcessScript": "",
  "matching.audioVariant": "all",

  // API Keys
  "api.tvdb.key": "",
  "api.tvdb.pin": "",
  "api.tmdb.key": "",

  // Matching
  "matching.strategy": "fuzzy",
  "matching.threshold": "0.7",
  "matching.minDuration": "300",
  "matching.normalizeSeriesNamesForSonarr": "false",

  // Display: preview images from programme pages and TVDB series posters
  "search.thumbnails": "true",
  "ui.posters": "true",

  // MediathekView search source: "mediathekviewweb" or "local"
  "mediathek.source": "mediathekviewweb",
  "mediathek.localIndex.updateHours": "2",

  // Cache
  "cache.ttl.search": "3600",
  "cache.ttl.metadata": "86400",

  // Notifications: events default on; a target only sends once it is configured.
  "notifications.event.downloadCompleted": "true",
  "notifications.event.downloadFailed": "true",
  "notifications.event.subscriptionQueued": "true",
  "notifications.event.subscriptionFound": "true",
  "notifications.webhook.enabled": "true",
  "notifications.webhook.url": "",
  "notifications.ntfy.enabled": "true",
  "notifications.ntfy.url": "https://ntfy.sh",
  "notifications.ntfy.topic": "",
  "notifications.ntfy.token": "",
  "notifications.gotify.enabled": "true",
  "notifications.gotify.url": "",
  "notifications.gotify.token": "",
  "notifications.discord.enabled": "true",
  "notifications.discord.url": "",

  // System
  "system.setupComplete": "false",
};

// GET /api/settings - Fetch all settings or specific key
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  try {
    if (key) {
      // Fetch single setting
      const config = await prisma.config.findUnique({
        where: { key },
      });
      const value = config?.value ?? DEFAULT_SETTINGS[key] ?? null;
      return NextResponse.json({
        key,
        value: value === null ? null : maskSetting(key, value),
      });
    }

    // Fetch all settings
    const configs = await prisma.config.findMany();
    const settings: Record<string, string> = { ...DEFAULT_SETTINGS };

    for (const config of configs) {
      settings[config.key] = maskSetting(config.key, config.value);
    }

    return NextResponse.json(settings);
  } catch (error) {
    logger.error("Failed to fetch settings:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

// POST /api/settings - Update settings
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    for (const [key, value] of Object.entries(
      body?.key ? { [body.key]: body.value } : body || {}
    )) {
      if (typeof value === "string" && maskSetting(key, value) !== value) rememberLogSecret(value);
    }

    // Handle single key-value pair
    if (body.key && body.value !== undefined) {
      const key = String(body.key);
      if (isMaskedSetting(key, body.value)) {
        return NextResponse.json({ success: true, key });
      }
      await prisma.config.upsert({
        where: { key },
        update: { value: String(body.value) },
        create: { key, value: String(body.value) },
      });
      clearSettingsCache();
      mediathekCache.clear();
      clearSrfTokenCache();
      if (isTvdbCredentialSettingKey(key)) {
        await clearTvdbTokenCache();
      }
      // Clear TTL cache if cache settings changed
      if (key.startsWith("cache.")) {
        clearTTLCache();
      }
      return NextResponse.json({ success: true, key });
    }

    // Handle multiple settings
    if (typeof body === "object" && !body.key) {
      const entries = Object.entries(body).filter(([key, value]) => !isMaskedSetting(key, value));
      const changedKeys = entries.map(([key]) => key);
      const updates = entries.map(([key, value]) =>
        prisma.config.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        })
      );
      await Promise.all(updates);
      clearSettingsCache();
      mediathekCache.clear();
      clearSrfTokenCache();
      if (changedKeys.some(isTvdbCredentialSettingKey)) {
        await clearTvdbTokenCache();
      }
      // Clear TTL cache if any cache settings changed
      if (changedKeys.some((key) => key.startsWith("cache."))) {
        clearTTLCache();
      }
      return NextResponse.json({ success: true, updated: changedKeys.length });
    }

    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  } catch (error) {
    logger.error("Failed to update settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}

// DELETE /api/settings - Delete a setting (reset to default)
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "Key parameter required" }, { status: 400 });
  }

  try {
    await prisma.config.delete({
      where: { key },
    });
    clearSettingsCache();
    mediathekCache.clear();
    clearSrfTokenCache();
    if (isTvdbCredentialSettingKey(key)) {
      await clearTvdbTokenCache();
    }
    if (key.startsWith("cache.")) {
      clearTTLCache();
    }
    return NextResponse.json({ success: true, key });
  } catch {
    // Key might not exist, which is fine
    clearSettingsCache();
    mediathekCache.clear();
    clearSrfTokenCache();
    if (isTvdbCredentialSettingKey(key)) {
      await clearTvdbTokenCache();
    }
    if (key.startsWith("cache.")) {
      clearTTLCache();
    }
    return NextResponse.json({ success: true, key });
  }
}
