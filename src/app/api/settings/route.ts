import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clearSettingsCache } from "@/lib/settings";
import { clearTTLCache } from "@/lib/cache";
import { isTvdbCredentialSettingKey } from "@/lib/tvdb-auth";
import { clearTvdbTokenCache } from "@/services/tvdb";

// Default settings
const DEFAULT_SETTINGS: Record<string, string> = {
  // General
  "download.path": "/downloads",
  "download.quality": "all",
  "download.convertToMkv": "true",

  // API Keys
  "api.tvdb.key": "",
  "api.tvdb.pin": "",
  "api.tmdb.key": "",

  // Matching
  "matching.strategy": "fuzzy",
  "matching.threshold": "0.7",
  "matching.minDuration": "300",

  // Cache
  "cache.ttl.search": "3600",
  "cache.ttl.metadata": "86400",

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
      return NextResponse.json({
        key,
        value: config?.value ?? DEFAULT_SETTINGS[key] ?? null,
      });
    }

    // Fetch all settings
    const configs = await prisma.config.findMany();
    const settings: Record<string, string> = { ...DEFAULT_SETTINGS };

    for (const config of configs) {
      settings[config.key] = config.value;
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

// POST /api/settings - Update settings
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle single key-value pair
    if (body.key && body.value !== undefined) {
      const key = String(body.key);
      await prisma.config.upsert({
        where: { key },
        update: { value: String(body.value) },
        create: { key, value: String(body.value) },
      });
      clearSettingsCache();
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
      const changedKeys = Object.keys(body);
      const updates = Object.entries(body).map(([key, value]) =>
        prisma.config.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        })
      );
      await Promise.all(updates);
      clearSettingsCache();
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
    console.error("Failed to update settings:", error);
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
    if (isTvdbCredentialSettingKey(key)) {
      await clearTvdbTokenCache();
    }
    if (key.startsWith("cache.")) {
      clearTTLCache();
    }
    return NextResponse.json({ success: true, key });
  }
}
