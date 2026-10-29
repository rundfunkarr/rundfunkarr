import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResultItem } from "@/types";
import type { ContentProvider, ProviderContentItem } from "@/types/provider";

const { settings, queryMediathekView, fetchWithRetry, getDetailedVideoInfo, ensureYtdlpExists } =
  vi.hoisted(() => ({
    settings: new Map<string, string>(),
    queryMediathekView: vi.fn(),
    fetchWithRetry: vi.fn(),
    getDetailedVideoInfo: vi.fn(),
    ensureYtdlpExists: vi.fn(async () => true),
  }));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
  getMinDurationSeconds: vi.fn(async () => Number(settings.get("matching.minDuration") ?? 300)),
}));
vi.mock("@/lib/mediathek-client", () => ({
  MEDIATHEK_API_URL: "https://mediathekviewweb.de/api/query",
  queryMediathekView,
}));
vi.mock("@/lib/fetch-retry", () => ({ fetchWithRetry }));
vi.mock("@/server/ytdlp", async () => ({
  isHlsUrl: (await import("@/lib/stream-url")).isHlsUrl,
  getDetailedVideoInfo,
  ensureYtdlpExists,
}));

import { BaseProvider } from "./base";
import { MediathekViewProvider } from "./mediathekview";
import { OrfProvider } from "./orf";

function apiItem(overrides: Partial<ApiResultItem> = {}): ApiResultItem {
  return {
    channel: "ARD",
    topic: "Tatort",
    title: "Borowski und der Wiedergänger",
    description: "Krimi",
    filmlisteTimestamp: Date.UTC(2024, 4, 5) / 1000,
    duration: 5400,
    size: 1_000_000,
    url_website: "https://www.ardmediathek.de/video/1",
    url_video: "https://cdn.ard.de/video.mp4",
    url_video_low: "https://cdn.ard.de/video_low.mp4",
    url_video_hd: "https://cdn.ard.de/video_hd.mp4",
    ...overrides,
  };
}

class TestProvider extends BaseProvider {
  readonly id = "test";
  readonly name = "Test";
  readonly country = "DE" as const;
  readonly capabilities = {
    supportsHls: true,
    supportsDirectDownload: true,
    requiresProxy: false,
    hasOfficialApi: false,
  };
  search = vi.fn(async (): Promise<ProviderContentItem[]> => []);
  item(overrides: Partial<Parameters<BaseProvider["createContentItem"]>[0]> = {}) {
    return this.createContentItem({
      id: "1",
      channel: "ARD",
      topic: "Tatort",
      title: "Folge",
      description: "",
      timestamp: Date.UTC(2023, 0, 1) / 1000,
      duration: 5400,
      size: 42,
      websiteUrl: "https://example.org",
      videoUrl: "https://cdn/standard.mp4",
      ...overrides,
    });
  }
  filename(item: ProviderContentItem, quality: string) {
    return this.generateFilename(item, quality);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation(() => {});
  settings.clear();
  ensureYtdlpExists.mockResolvedValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe("BaseProvider", () => {
  it.each([
    ["high", "https://cdn/hd.mp4", "1080p"],
    ["standard", "https://cdn/standard.mp4", "720p"],
    ["low", "https://cdn/low.mp4", "480p"],
  ] as const)("selects the %s quality URL", async (quality, url, label) => {
    const provider = new TestProvider();
    const item = provider.item({
      videoUrlHigh: "https://cdn/hd.mp4",
      videoUrlLow: "https://cdn/low.mp4",
    });

    const info = await provider.getDownloadInfo(item, quality);

    expect(info).toMatchObject({ url, quality: label, isHls: false, expectedSize: 42 });
  });

  it("falls back to the standard URL when the preferred quality is missing and detects HLS", async () => {
    const provider = new TestProvider();
    const item = provider.item({ videoUrl: "https://cdn/master.m3u8" });

    const info = await provider.getDownloadInfo(item);

    expect(info).toMatchObject({ url: "https://cdn/master.m3u8", quality: "720p", isHls: true });
  });

  it("builds scene-style filenames with transliterated umlauts and stripped punctuation", () => {
    const provider = new TestProvider();
    const item = provider.item({
      topic: "Hubert & Staller",
      title: "Mörderische Grüße: Ärger in Füssen (Teil 1)?",
    });

    expect(provider.filename(item, "1080p")).toBe(
      "Hubert.and.Staller.Moerderische.Gruesse.Aerger.in.Fuessen.Teil.1.2023.GERMAN.1080p.WEB.h264-TEST"
    );
  });

  it("tags audio description and original versions in filenames", () => {
    const provider = new TestProvider();

    expect(
      provider.filename(provider.item({ title: "Folge 1 (Audiodeskription)" }), "720p")
    ).toContain(".GERMAN.AD.720p.");
    expect(provider.filename(provider.item({ title: "Folge 1 (OmU)" }), "720p")).toContain(
      ".ORIGINAL.720p."
    );
  });

  it("limits filenames to 200 UTF-8 bytes without splitting characters and keeps the suffix", () => {
    const provider = new TestProvider();
    const name = provider.filename(provider.item({ title: "€".repeat(150) }), "720p");

    expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(200);
    expect(name.endsWith(".2023.GERMAN.720p.WEB.h264-TEST")).toBe(true);
    expect(name).not.toContain("�");
  });

  it("is disabled by default unless it is the MediathekView provider", async () => {
    const provider = new TestProvider();
    expect(await provider.isEnabled()).toBe(false);

    settings.set("provider.test.enabled", "true");
    expect(await provider.isEnabled()).toBe(true);

    const mediathek = new MediathekViewProvider();
    expect(await mediathek.isEnabled()).toBe(true);
    settings.set("provider.mediathekview.enabled", "false");
    expect(await mediathek.isEnabled()).toBe(false);
  });

  it("reports itself available by default", async () => {
    expect((await new TestProvider().checkStatus()).available).toBe(true);
  });
});

describe("MediathekViewProvider", () => {
  it("searches topic and title, filters unwanted items and maps the rest", async () => {
    settings.set("matching.minDuration", "600");
    queryMediathekView.mockResolvedValue([
      apiItem({ url_subtitle: "https://cdn/sub.xml", audioLanguage: "deu" }),
      apiItem({ channel: "ORF", title: "ORF-Duplikat" }),
      apiItem({ title: "Tatort - Trailer" }),
      apiItem({ title: "Outtakes: Pannen" }),
      apiItem({ title: "Tatort (klare Sprache)" }),
      apiItem({ title: "Kurz", duration: 599 }),
      apiItem({ title: "Stream", url_video: "https://cdn/master.m3u8" }),
    ]);

    const items = await new MediathekViewProvider().search({ query: "  Tatort  ", limit: 10 });

    expect(queryMediathekView).toHaveBeenCalledWith(
      [{ fields: ["topic", "title"], query: "Tatort" }],
      30
    );
    expect(items.map((i) => i.title)).toEqual(["Borowski und der Wiedergänger"]);
    expect(items[0]).toMatchObject({
      providerId: "mediathekview",
      subtitleUrl: "https://cdn/sub.xml",
      audioLanguage: "deu",
      videoUrls: {
        standard: "https://cdn.ard.de/video.mp4",
        low: "https://cdn.ard.de/video_low.mp4",
        high: "https://cdn.ard.de/video_hd.mp4",
      },
    });
  });

  it("keeps HLS streams when HLS downloads are enabled and respects the limit", async () => {
    settings.set("download.enableHLS", "true");
    queryMediathekView.mockResolvedValue([
      apiItem({ title: "A", url_video: "https://cdn/master.m3u8", url_video_hd: "" }),
      apiItem({ title: "B" }),
    ]);

    const items = await new MediathekViewProvider().search({ query: "Tatort", limit: 1 });

    expect(items).toHaveLength(1);
    expect(items[0].videoUrls.high).toBeUndefined();
  });

  it("ignores queries shorter than two characters", async () => {
    expect(await new MediathekViewProvider().search({ query: " a " })).toEqual([]);
    expect(queryMediathekView).not.toHaveBeenCalled();
  });

  it("propagates failed searches so the registry can report them", async () => {
    queryMediathekView.mockResolvedValue(null);

    await expect(new MediathekViewProvider().search({ query: "Tatort" })).rejects.toThrow(
      "MediathekView search failed"
    );
  });

  it("checks the API status with a minimal query", async () => {
    const provider = new MediathekViewProvider();
    fetchWithRetry.mockResolvedValueOnce(new Response("{}"));
    expect(await provider.checkStatus()).toMatchObject({ available: true, error: undefined });

    fetchWithRetry.mockResolvedValueOnce(new Response(null, { status: 502 }));
    expect(await provider.checkStatus()).toMatchObject({ available: false, error: "HTTP 502" });

    fetchWithRetry.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await provider.checkStatus()).toMatchObject({ available: false, error: "ECONNRESET" });
  });
});

describe("OrfProvider", () => {
  function enable() {
    settings.set("provider.orf.enabled", "true");
    settings.set("download.enableHLS", "true");
  }

  it("is opt-in and additionally requires HLS downloads", async () => {
    const provider = new OrfProvider();
    expect(await provider.isEnabled()).toBe(false);

    settings.set("provider.orf.enabled", "true");
    expect(await provider.isEnabled()).toBe(false);

    settings.set("download.enableHLS", "true");
    expect(await provider.isEnabled()).toBe(true);

    settings.set("provider.orf.enabled", "false");
    expect(await provider.isEnabled()).toBe(false);
  });

  it("searches only ORF entries and skips clips as whole words, case-insensitively", async () => {
    enable();
    queryMediathekView.mockResolvedValue([
      apiItem({ channel: "ORF", title: "Soko Kitzbühel: Schöpfung" }),
      apiItem({ channel: "ORF", title: "TRAILER: Soko Kitzbühel" }),
      apiItem({ channel: "ORF", title: "Soko Kitzbühel - Ausschnitt" }),
      apiItem({ channel: "ORF", title: "Soko Kitzbühel: Kurzclip" }),
      apiItem({ channel: "ORF", title: "Soko Kitzbühel: Eclipse" }),
      apiItem({ channel: "ORF", title: "Kurz", duration: 60 }),
    ]);

    const items = await new OrfProvider().search({ query: "Soko Kitzbühel" });

    expect(queryMediathekView).toHaveBeenCalledWith(
      [
        { fields: ["topic", "title"], query: "Soko Kitzbühel" },
        { fields: ["channel"], query: "ORF" },
      ],
      150
    );
    expect(items.map((i) => i.title)).toEqual([
      "Soko Kitzbühel: Schöpfung",
      "Soko Kitzbühel: Eclipse",
    ]);
    expect(items[0].providerId).toBe("orf");
  });

  it("returns nothing when disabled or for too short queries", async () => {
    expect(await new OrfProvider().search({ query: "Soko" })).toEqual([]);
    enable();
    expect(await new OrfProvider().search({ query: "S" })).toEqual([]);
    expect(queryMediathekView).not.toHaveBeenCalled();
  });

  it("propagates failed searches", async () => {
    enable();
    queryMediathekView.mockResolvedValue(null);

    await expect(new OrfProvider().search({ query: "ZIB" })).rejects.toThrow(
      "MediathekView search failed"
    );
  });

  it("reports why it is unavailable", async () => {
    const provider = new OrfProvider();
    ensureYtdlpExists.mockResolvedValueOnce(false);
    expect((await provider.checkStatus()).error).toBe(
      "yt-dlp not available (needed for downloads)"
    );

    expect((await provider.checkStatus()).error).toBe("HLS downloads not enabled");

    enable();
    queryMediathekView.mockResolvedValueOnce(null);
    expect(await provider.checkStatus()).toMatchObject({
      available: false,
      error: "Failed to query MediathekView",
    });

    queryMediathekView.mockResolvedValueOnce([]);
    expect((await provider.checkStatus()).error).toBe("MediathekView returned no ORF results");

    queryMediathekView.mockRejectedValueOnce(new Error("offline"));
    expect((await provider.checkStatus()).error).toBe("offline");

    queryMediathekView.mockResolvedValueOnce([apiItem({ channel: "ORF" })]);
    expect(await provider.checkStatus()).toMatchObject({ available: true, error: undefined });
  });

  it("resolves downloads through yt-dlp as HLS and falls back to the base selection", async () => {
    const provider = new OrfProvider();
    enable();
    queryMediathekView.mockResolvedValue([
      apiItem({ channel: "ORF", url_video: "https://apasfiis.sf.apa.at/master.m3u8" }),
    ]);
    const [item] = await provider.search({ query: "ZIB" });

    getDetailedVideoInfo.mockResolvedValueOnce({ url: "https://resolved", filesize: 99 });
    expect(await provider.getDownloadInfo(item, "low")).toMatchObject({
      url: "https://apasfiis.sf.apa.at/master.m3u8",
      isHls: true,
      quality: "480p",
      expectedSize: 99,
    });

    getDetailedVideoInfo.mockResolvedValueOnce(null);
    expect(await provider.getDownloadInfo(item, "high")).toMatchObject({
      url: "https://cdn.ard.de/video_hd.mp4",
      quality: "1080p",
    });

    getDetailedVideoInfo.mockRejectedValueOnce(new Error("Unsupported proxy protocol"));
    expect((await provider.getDownloadInfo(item, "standard")).quality).toBe("720p");
  });
});

describe("provider registry", () => {
  async function freshRegistry() {
    vi.resetModules();
    return (await import("./registry")).providerRegistry;
  }

  function fake(id: string, overrides: Partial<ContentProvider> = {}): ContentProvider {
    return {
      id,
      name: id.toUpperCase(),
      country: "DE",
      capabilities: {
        supportsHls: false,
        supportsDirectDownload: true,
        requiresProxy: false,
        hasOfficialApi: false,
      },
      initialize: vi.fn(async () => {}),
      search: vi.fn(async () => []),
      getDownloadInfo: vi.fn(),
      checkStatus: vi.fn(async () => ({ available: true, lastCheck: 1 })),
      isEnabled: vi.fn(async () => true),
      ...overrides,
    } as ContentProvider;
  }

  function content(id: string, timestamp: number): ProviderContentItem {
    return new TestProvider().item({ id, timestamp });
  }

  it("merges results from enabled providers newest first and applies the limit", async () => {
    const registry = await freshRegistry();
    registry.register(
      fake("a", { search: vi.fn(async () => [content("a1", 10), content("a2", 30)]) })
    );
    registry.register(fake("b", { search: vi.fn(async () => [content("b1", 20)]) }));
    registry.register(fake("off", { isEnabled: vi.fn(async () => false) }));

    const result = await registry.searchAll({ query: "x", limit: 2 });

    expect(result.items.map((i) => i.id)).toEqual(["a2", "b1"]);
    expect(result.providerCounts).toEqual({ a: 2, b: 1 });
    expect(result.errors).toEqual([]);
  });

  it("isolates failing providers and reports their errors", async () => {
    const registry = await freshRegistry();
    registry.register(fake("ok", { search: vi.fn(async () => [content("1", 1)]) }));
    registry.register(
      fake("broken", { search: vi.fn(async () => Promise.reject(new Error("503"))) })
    );
    registry.register(fake("weird", { search: vi.fn(async () => Promise.reject("nope")) }));

    const result = await registry.searchAll({ query: "x" });

    expect(result.items).toHaveLength(1);
    expect(result.providerCounts).toEqual({ ok: 1, broken: 0, weird: 0 });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { providerId: "broken", error: "503" },
        { providerId: "weird", error: "Unknown error" },
      ])
    );
  });

  it("initializes every provider once, even with concurrent callers and failing providers", async () => {
    const registry = await freshRegistry();
    const good = fake("good");
    const bad = fake("bad", { initialize: vi.fn(async () => Promise.reject(new Error("boom"))) });
    registry.register(good);
    registry.register(bad);

    await Promise.all([
      registry.initialize(),
      registry.initialize(),
      registry.searchAll({ query: "x" }),
    ]);
    await registry.initialize();

    expect(good.initialize).toHaveBeenCalledTimes(1);
    expect(bad.initialize).toHaveBeenCalledTimes(1);
  });

  it("searches a single provider only when it exists and is enabled", async () => {
    const registry = await freshRegistry();
    const on = fake("on", { search: vi.fn(async () => [content("1", 1)]) });
    const off = fake("off", { isEnabled: vi.fn(async () => false) });
    registry.register(on);
    registry.register(off);

    expect(await registry.searchProvider("on", { query: "x" })).toHaveLength(1);
    expect(await registry.searchProvider("off", { query: "x" })).toEqual([]);
    expect(off.search).not.toHaveBeenCalled();
    await expect(registry.searchProvider("missing", { query: "x" })).rejects.toThrow(
      "Provider not found: missing"
    );
  });

  it("replaces providers registered twice and filters by country", async () => {
    const registry = await freshRegistry();
    registry.register(fake("a"));
    registry.register(fake("a", { name: "Replacement", country: "CH" }));
    registry.register(fake("b"));

    expect(registry.getAllProviders()).toHaveLength(2);
    expect(registry.getProvider("a")?.name).toBe("Replacement");
    expect(registry.getProvidersByCountry("CH").map((p) => p.id)).toEqual(["a"]);
    expect(registry.getProviderInfo()).toEqual([
      expect.objectContaining({ id: "a", name: "Replacement", country: "CH" }),
      expect.objectContaining({ id: "b", name: "B", country: "DE" }),
    ]);
  });

  it("collects provider status and marks failing checks as unavailable", async () => {
    const registry = await freshRegistry();
    registry.register(fake("ok"));
    registry.register(
      fake("down", { checkStatus: vi.fn(async () => Promise.reject(new Error("DNS"))) })
    );

    const statuses = await registry.getProvidersStatus();

    expect(statuses.ok).toEqual({ available: true, lastCheck: 1, enabled: true });
    expect(statuses.down).toMatchObject({ available: false, error: "DNS", enabled: false });
  });
});
