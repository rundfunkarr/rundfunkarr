import { describe, expect, it, vi } from "vitest";
import { inputToRuleset } from "@/lib/ruleset-input";
import type { ApiResultItem, TvdbData } from "@/types";
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async () => null),
  getMinDurationSeconds: vi.fn(async () => 300),
}));
vi.mock("./shows", () => ({ getShowInfoByTvdbId: vi.fn() }));
import { getShowInfoByTvdbId } from "./shows";
import { diagnoseRuleset } from "./mediathek";
const show: TvdbData = {
  id: 123,
  name: "Testserie",
  germanName: "Testserie",
  aliases: [],
  episodes: [{ name: "Der Anfang", seasonNumber: 1, episodeNumber: 2, aired: null, runtime: 30 }],
};
const item: ApiResultItem = {
  channel: "ARD",
  topic: "Testserie",
  title: "Der Anfang (S01/E02)",
  description: "",
  filmlisteTimestamp: 1,
  duration: 1800,
  size: 100,
  url_website: "https://example.org/folge",
  url_video: "https://example.org/folge.mp4",
  url_video_hd: "",
  url_video_low: "",
};
const rule = inputToRuleset(
  {
    topic: "Testserie",
    tvdbId: 123,
    matchingStrategy: "SeasonAndEpisodeNumber",
    filters: "[]",
    titleRegexRules: "[]",
    seasonRegex: "S(\\d+)",
    episodeRegex: "E(\\d+)",
  },
  show.name
);
vi.mocked(getShowInfoByTvdbId).mockResolvedValue(show);

describe("Matching-Diagnose mit dem Produktionsmatcher", () => {
  it("ordnet dieselbe Staffel und Episode wie die Newznab-Suche zu", async () => {
    expect(await diagnoseRuleset(item, rule, show)).toMatchObject({
      status: "matched",
      episode: { season: 1, episode: 2, title: "Der Anfang" },
    });
  });
  it("erklärt einen globalen Laufzeitfilter", async () => {
    expect(await diagnoseRuleset({ ...item, duration: 60 }, rule, show)).toMatchObject({
      status: "filtered",
      reason: expect.stringContaining("globalen Minimum"),
    });
  });
  it("erklärt einen nicht erfüllten Regelfilter", async () => {
    expect(
      await diagnoseRuleset(
        item,
        { ...rule, filters: '[{"attribute":"duration","type":"GreaterThan","value":"40"}]' },
        show
      )
    ).toMatchObject({ status: "filtered", reason: expect.stringContaining("duration") });
  });
  it("unterscheidet fehlende Zuordnung von ausgefilterten Treffern", async () => {
    expect(
      await diagnoseRuleset({ ...item, title: "Folge ohne Nummer" }, rule, show)
    ).toMatchObject({ status: "unmatched" });
  });
  it("erklärt einen abweichenden Topic", async () => {
    expect(await diagnoseRuleset({ ...item, topic: "Andere Serie" }, rule, show)).toMatchObject({
      status: "filtered",
      reason: expect.stringContaining("Thema"),
    });
  });
});
