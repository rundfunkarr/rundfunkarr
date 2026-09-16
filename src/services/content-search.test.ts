import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/search/route";
import { queryContent } from "./content-search";
import {
  fetchSearchResultsByString,
  fetchSearchResultsForRssSync,
  fetchMovieSearchByQuery,
} from "./mediathek";
import { mediathekCache } from "@/lib/cache";
import { searchVideos, getLatestVideos } from "./srgssr-api";
import { queryMediathekView } from "@/lib/mediathek-client";

const { settings } = vi.hoisted(() => ({ settings: new Map<string, string>() }));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
  getMinDurationSeconds: vi.fn(async () => 300),
}));
vi.mock("@/services/category", () => ({ getCategoriesForTopics: vi.fn(async () => new Map()) }));
vi.mock("@/lib/mediathek-client", () => ({ queryMediathekView: vi.fn(async () => []) }));
vi.mock("./srgssr-api", () => ({ searchVideos: vi.fn(), getLatestVideos: vi.fn() }));
vi.mock("./rulesets", () => ({
  ensureRulesetsLoaded: vi.fn(),
  getAllTopics: () => [],
  getRulesetsForTopic: () => [],
}));
vi.mock("./tmdb", () => ({ searchMovieByTitle: vi.fn(async () => null) }));

const video = {
  id: "11111111-1111-4111-8111-111111111111",
  urn: "urn:srf:video:11111111-1111-4111-8111-111111111111",
  title: "Rundschau",
  mediaType: "VIDEO" as const,
  vendor: "SRF" as const,
  duration: 1800000,
  type: "EPISODE" as const,
  playableAbroad: true,
  date: "2026-09-16T12:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  settings.clear();
  settings.set("api.srgssr.consumerKey", "fixture");
  settings.set("api.srgssr.consumerSecret", "fixture");
  settings.set("download.enableHLS", "true");
  mediathekCache.clear();
  vi.mocked(searchVideos).mockResolvedValue([video]);
  vi.mocked(getLatestVideos).mockResolvedValue([video]);
  vi.mocked(queryMediathekView).mockResolvedValue([]);
});

describe("configured providers in normal search flows", () => {
  it("returns SRF in the ordinary UI request without an extra query parameter", async () => {
    const response = await GET(new NextRequest("http://localhost/api/search?q=Rundschau"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].url_video).toBe(
      "https://www.srf.ch/play/tv/redirect/detail/11111111-1111-4111-8111-111111111111#rundfunkarr-height=720"
    );
  });

  it("includes SRF in Sonarr text searches and Radarr movie searches", async () => {
    expect(await fetchSearchResultsByString("Rundschau", null, 50, 0)).toContain(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(await fetchMovieSearchByQuery("Rundschau", 50, 0)).toContain(
      "11111111-1111-4111-8111-111111111111"
    );
  });

  it("queries recent SRF episodes for RSS sync", async () => {
    await fetchSearchResultsForRssSync(50, 0);
    expect(getLatestVideos).toHaveBeenCalledWith("SRF", 100);
  });

  it("does not query SRF when HLS is disabled", async () => {
    settings.set("download.enableHLS", "false");
    expect(await queryContent([], 50)).toEqual([]);
    expect(getLatestVideos).not.toHaveBeenCalled();
  });

  it("keeps failed SRF searches out of the cache and recovers on the next request", async () => {
    vi.mocked(searchVideos).mockRejectedValueOnce(new Error("unavailable"));
    expect(await fetchSearchResultsByString("Rundschau", null, 50, 0)).not.toContain("<item>");
    expect(await fetchSearchResultsByString("Rundschau", null, 50, 0)).toContain(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(searchVideos).toHaveBeenCalledTimes(2);
  });

  it("honors the ORF opt-in and HLS setting", async () => {
    settings.set("provider.srf.enabled", "false");
    vi.mocked(queryMediathekView).mockResolvedValue([
      {
        channel: "ORF",
        topic: "ZIB",
        title: "ZIB",
        description: "",
        duration: 1800,
        size: 0,
        filmlisteTimestamp: 1,
        url_video: "https://example.org/zib.m3u8",
        url_video_hd: "",
        url_video_low: "",
        url_website: "",
      },
    ]);
    expect(await queryContent([], 50)).toEqual([]);
    settings.set("provider.orf.enabled", "true");
    expect(await queryContent([], 50)).toHaveLength(1);
    settings.set("download.enableHLS", "false");
    expect(await queryContent([], 50)).toEqual([]);
  });
});

it("restricts ORF-only upstream searches before applying the requested limit", async () => {
  settings.set("provider.mediathekview.enabled", "false");
  settings.set("provider.orf.enabled", "true");
  settings.set("provider.srf.enabled", "false");
  const queries = [{ fields: ["topic"], query: "News" }];
  await queryContent(queries, 5);
  expect(queryMediathekView).toHaveBeenCalledWith(
    [...queries, { fields: ["channel"], query: "ORF" }],
    5,
    {}
  );
  expect(queries).toHaveLength(1);
});
