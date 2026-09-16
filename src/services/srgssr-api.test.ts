import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { searchVideos, getLatestVideos, getMediaComposition, clearTokenCache } from "./srgssr-api";

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
    const video = { id: "sample" };
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
