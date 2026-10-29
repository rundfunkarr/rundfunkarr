import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TvdbData } from "@/types";

const { readFile, getSetting, getTvdbShow, getTmdbShow } = vi.hoisted(() => ({
  readFile: vi.fn(),
  getSetting: vi.fn(),
  getTvdbShow: vi.fn(),
  getTmdbShow: vi.fn(),
}));
vi.mock("fs", () => ({ promises: { readFile } }));
vi.mock("@/lib/settings", () => ({ getSetting }));
vi.mock("./tvdb", () => ({ getShowInfoByTvdbId: getTvdbShow }));
vi.mock("./tmdb", () => ({ getShowInfoByTvdbId: getTmdbShow }));

const localShow = {
  tvdbId: 79890,
  name: "Shaun the Sheep",
  germanName: "Shaun das Schaf",
  aliases: ["Shaun"],
  episodes: [
    { name: "Folge 1", seasonNumber: 1, episodeNumber: 1, aired: "2007-03-05", runtime: 7 },
    { name: "Folge 2", seasonNumber: 1, episodeNumber: 2, aired: null },
  ],
};
const apiShow: TvdbData = {
  id: 1,
  name: "API Show",
  germanName: "API Sendung",
  aliases: [],
  episodes: [],
};
const fetchMock = vi.fn();

async function loadModule() {
  vi.resetModules();
  const [shows, cache] = await Promise.all([import("./shows"), import("@/lib/cache")]);
  cache.tvdbCache.clear();
  return shows;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(Response.json([localShow]));
  getSetting.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("getShowInfoByTvdbId (shows aggregator)", () => {
  it("serves shows from the GitHub list with German aliases and parsed air dates", async () => {
    const { getShowInfoByTvdbId } = await loadModule();

    const show = await getShowInfoByTvdbId(79890);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("shows.json"),
      expect.objectContaining({ headers: { "User-Agent": "RundfunkArr" } })
    );
    expect(show).toEqual({
      id: 79890,
      name: "Shaun the Sheep",
      germanName: "Shaun das Schaf",
      aliases: [{ language: "deu", name: "Shaun" }],
      episodes: [
        {
          name: "Folge 1",
          seasonNumber: 1,
          episodeNumber: 1,
          aired: new Date("2007-03-05"),
          runtime: 7,
        },
        { name: "Folge 2", seasonNumber: 1, episodeNumber: 2, aired: null, runtime: null },
      ],
    });
    expect(getTvdbShow).not.toHaveBeenCalled();
  });

  it("falls back to the bundled shows.json when GitHub is unavailable", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    readFile.mockResolvedValue(JSON.stringify([localShow]));
    const { getShowInfoByTvdbId } = await loadModule();

    expect((await getShowInfoByTvdbId(79890))?.germanName).toBe("Shaun das Schaf");
    expect(readFile).toHaveBeenCalledWith(expect.stringMatching(/data[/\\]shows\.json$/), "utf-8");
  });

  it("falls back to the bundled list on network errors too", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    readFile.mockResolvedValue(JSON.stringify([localShow]));
    const { getShowInfoByTvdbId } = await loadModule();

    expect((await getShowInfoByTvdbId(79890))?.name).toBe("Shaun the Sheep");
  });

  it("asks TVDB first and TMDB second for unknown shows, depending on configured keys", async () => {
    getSetting.mockImplementation(async (key: string) => (key === "api.tvdb.key" ? "k" : "k2"));
    getTvdbShow.mockResolvedValue(null);
    getTmdbShow.mockResolvedValue(apiShow);
    const { getShowInfoByTvdbId } = await loadModule();

    expect(await getShowInfoByTvdbId(1)).toEqual(apiShow);
    expect(getTvdbShow).toHaveBeenCalledWith(1);
    expect(getTmdbShow).toHaveBeenCalledWith(1);
  });

  it("does not query TMDB when TVDB already answered", async () => {
    getSetting.mockResolvedValue("key");
    getTvdbShow.mockResolvedValue(apiShow);
    const { getShowInfoByTvdbId } = await loadModule();

    expect(await getShowInfoByTvdbId(1)).toEqual(apiShow);
    expect(getTmdbShow).not.toHaveBeenCalled();
  });

  it("skips API sources without keys and returns null when nothing is found", async () => {
    const { getShowInfoByTvdbId } = await loadModule();

    expect(await getShowInfoByTvdbId(1)).toBeNull();
    expect(getTvdbShow).not.toHaveBeenCalled();
    expect(getTmdbShow).not.toHaveBeenCalled();
  });

  it("returns null for a missing id", async () => {
    const { getShowInfoByTvdbId } = await loadModule();

    expect(await getShowInfoByTvdbId(undefined as unknown as number)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches results and refreshes the show list only once per hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
    const { getShowInfoByTvdbId } = await loadModule();

    await getShowInfoByTvdbId(79890);
    await getShowInfoByTvdbId(79890);
    await getShowInfoByTvdbId(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-10-01T11:00:01Z"));
    await getShowInfoByTvdbId(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries loading on the next call when both sources fail", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    readFile.mockRejectedValueOnce(new Error("ENOENT"));
    const { getShowInfoByTvdbId } = await loadModule();

    expect(await getShowInfoByTvdbId(79890)).toBeNull();
    expect((await getShowInfoByTvdbId(79890))?.name).toBe("Shaun the Sheep");
  });
});
