import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  searchVideos,
  getLatestVideos,
  getMediaComposition,
  clearTokenCache,
  getBestStreamUrl,
  type SrgssrMediaComposition,
} from "./srgssr-api";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(async () => "fixture") }));
const fetchMock = vi.fn();
beforeEach(() => {
  clearTokenCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValueOnce(
    Response.json({ access_token: "fixture-token", expires_in: 3600 })
  );
});
afterEach(() => vi.unstubAllGlobals());

it.each(["searchResultListMedia", "SearchResultListMedia"])(
  "uses the public Video API and parses %s arrays",
  async (key) => {
    const video = validVideo;
    fetchMock.mockResolvedValueOnce(Response.json({ [key]: [video] }));
    expect(await searchVideos("Rundschau", "SRF", 10000)).toEqual([video]);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.srgssr.ch/videometadata/v2/search?bu=srf&q=Rundschau&pageSize=100"
    );
  }
);

it("uses latest episodes for RSS and resolves compositions from stable URNs", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ mediaList: [] }));
  expect(await getLatestVideos()).toEqual([]);
  expect(fetchMock.mock.calls[1][0]).toContain("/videometadata/v2/latest_episodes?bu=srf");
  fetchMock.mockResolvedValueOnce(Response.json({ chapterList: [] }));
  await getMediaComposition("urn:srf:video:11111111-1111-4111-8111-111111111111");
  expect(fetchMock.mock.calls[2][0]).toBe(
    "https://api.srgssr.ch/videometadata/v2/11111111-1111-4111-8111-111111111111/mediaComposition?bu=srf"
  );
});

it("does not report malformed responses or API outages as successful empty searches", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ unexpected: [] }));
  await expect(searchVideos("test")).rejects.toThrow("Invalid SRF search response");
  fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  await expect(searchVideos("test")).rejects.toThrow("SRF search failed");
});

const validVideo = {
  id: "sample",
  mediaType: "VIDEO",
  title: "News",
  urn: "urn:srf:video:sample",
  date: "2026-09-16T12:00:00Z",
  duration: 1800000,
};
it.each([
  null,
  { ...validVideo, title: null },
  { ...validVideo, urn: "broken" },
  { ...validVideo, date: "invalid" },
  { ...validVideo, duration: "1800" },
])("rejects invalid video entries in both search and latest responses: %j", async (item) => {
  fetchMock.mockResolvedValueOnce(Response.json({ searchResultListMedia: [item] }));
  await expect(searchVideos("News")).rejects.toThrow("Invalid SRF search response");
  fetchMock.mockResolvedValueOnce(Response.json({ mediaList: [item] }));
  await expect(getLatestVideos()).rejects.toThrow("Invalid SRF latest episodes response");
});
it("allows audio entries to be skipped without requiring video fields", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ mediaList: [{ mediaType: "AUDIO" }, validVideo] })
  );
  expect(await getLatestVideos()).toEqual([{ mediaType: "AUDIO" }, validVideo]);
});

it.each([
  ["low", "SD"],
  ["standard", "HQ"],
  ["high", "HD"],
] as const)("selects %s SRF resources before downloading", (quality, expected) => {
  const composition = {
    chapterUrn: "urn:srf:video:sample",
    chapterList: [
      {
        urn: "urn:srf:video:sample",
        resourceList: ["HD", "HQ", "SD"].map((level) => ({
          protocol: "HLS",
          quality: level,
          url: `https://example.org/${level}.m3u8`,
        })),
      },
    ],
  } as SrgssrMediaComposition;
  expect(getBestStreamUrl(composition, quality)).toBe(`https://example.org/${expected}.m3u8`);
});
