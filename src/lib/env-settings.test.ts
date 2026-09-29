import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import { prisma } from "./db";
import { initSettingsFromEnv } from "./env-settings";
import { clearSettingsCache, getSetting } from "./settings";

const { testDir } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { testDir: await mkdtemp(join(tmpdir(), "rundfunkarr-env-settings-")) };
});

vi.mock("./db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: `file:${testDir}/settings.db` }) };
});

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    'CREATE TABLE "Config" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL)'
  );
});

beforeEach(async () => {
  await prisma.config.deleteMany();
  clearSettingsCache();
});

afterAll(async () => {
  await prisma.$disconnect();
  await rm(testDir, { recursive: true, force: true });
});

describe("environment settings initialization", () => {
  it("persists configured values and exposes them through the settings service", async () => {
    expect(
      await initSettingsFromEnv({
        TVDB_API_KEY: "tvdb-key",
        TVDB_PIN: "subscriber-pin",
        TMDB_API_KEY: "tmdb-key",
        DOWNLOAD_FOLDER_PATH: "/test/downloads",
      })
    ).toBe(4);
    expect(await getSetting("api.tvdb.key")).toBe("tvdb-key");
    expect(await getSetting("api.tvdb.pin")).toBe("subscriber-pin");
    expect(await getSetting("api.tmdb.key")).toBe("tmdb-key");
    expect(await getSetting("download.path")).toBe("/test/downloads");
  });

  it("fills an empty value and clears a previously cached empty setting", async () => {
    await prisma.config.create({ data: { key: "api.tvdb.key", value: "" } });
    expect(await getSetting("api.tvdb.key")).toBe("");

    expect(await initSettingsFromEnv({ TVDB_API_KEY: "new-key" })).toBe(1);
    expect(await getSetting("api.tvdb.key")).toBe("new-key");
  });

  it("preserves existing values across restarts and environment changes", async () => {
    await initSettingsFromEnv({ TVDB_API_KEY: "original" });
    await prisma.config.create({ data: { key: "download.path", value: "/ui/downloads" } });

    expect(
      await initSettingsFromEnv({
        TVDB_API_KEY: "replacement",
        DOWNLOAD_FOLDER_PATH: "/env/downloads",
      })
    ).toBe(0);
    expect(await getSetting("api.tvdb.key")).toBe("original");
    expect(await getSetting("download.path")).toBe("/ui/downloads");
  });

  it("ignores missing or blank variables", async () => {
    expect(await initSettingsFromEnv({ TVDB_API_KEY: "", TMDB_API_KEY: " \n " })).toBe(0);
    expect(await prisma.config.count()).toBe(0);
  });

  it("does not write build-time credentials", async () => {
    expect(
      await initSettingsFromEnv({
        NEXT_PHASE: "phase-production-build",
        TVDB_API_KEY: "build-secret",
      })
    ).toBe(0);
    expect(await prisma.config.count()).toBe(0);
  });

  it("removes a stale TVDB token when initializing a TVDB credential", async () => {
    await prisma.config.createMany({
      data: [
        { key: "tvdb_token", value: "old-token" },
        { key: "tvdb_token_expiry", value: "2099-01-01" },
      ],
    });
    await initSettingsFromEnv({ TVDB_API_KEY: "new-key" });
    expect(await prisma.config.findUnique({ where: { key: "tvdb_token" } })).toBeNull();
    expect(await prisma.config.findUnique({ where: { key: "tvdb_token_expiry" } })).toBeNull();
  });

  it("keeps the token when stored TVDB credentials do not change", async () => {
    await prisma.config.createMany({
      data: [
        { key: "api.tvdb.key", value: "ui-key" },
        { key: "tvdb_token", value: "valid-token" },
      ],
    });
    await initSettingsFromEnv({ TVDB_API_KEY: "env-key", TMDB_API_KEY: "tmdb-key" });
    expect(await getSetting("tvdb_token")).toBe("valid-token");
  });

  it("stores credential characters as data, not SQL", async () => {
    const value = "key'; DROP TABLE Config; --";
    await initSettingsFromEnv({ TVDB_API_KEY: value });
    expect(await getSetting("api.tvdb.key")).toBe(value);
    expect(await prisma.config.count()).toBe(1);
  });
});
