import { describe, expect, it, vi } from "vitest";
import rulesetData from "../../data/rulesets.json";
import { rulesetInput } from "@/lib/ruleset-input";
import type { ApiResultItem, Ruleset, TvdbData, TvdbEpisode } from "@/types";
import { findEpisodeByAbsoluteNumber } from "@/types";
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async () => null),
  getMinDurationSeconds: vi.fn(async () => 300),
  isSeriesUmlautStrippingEnabled: vi.fn(async () => false),
}));
vi.mock("./shows", () => ({ getShowInfoByTvdbId: vi.fn() }));
vi.mock("./content-search", () => ({ queryContent: vi.fn() }));
vi.mock("./rulesets", () => ({
  ensureRulesetsLoaded: vi.fn(),
  getRulesetsForTopic: vi.fn(),
}));
import { getShowInfoByTvdbId } from "./shows";
import { diagnoseRuleset } from "./mediathek";

function episode(seasonNumber: number, episodeNumber: number): TvdbEpisode {
  return { name: `Folge ${episodeNumber}`, seasonNumber, episodeNumber, aired: null, runtime: 50 };
}

function show(episodes: TvdbEpisode[]): TvdbData {
  return { id: 176491, name: "Sturm der Liebe", germanName: null, aliases: [], episodes };
}

// TVDB numbers "Sturm der Liebe" continuously: season 22 holds episodes 4486-4665.
const soap = show([
  episode(0, 1),
  ...[1, 2, 3].map((n) => episode(1, n)),
  ...[683, 684].map((n) => episode(5, n)),
  ...[1809, 1810].map((n) => episode(9, n)),
  ...[4662, 4663].map((n) => episode(22, n)),
]);

const item: ApiResultItem = {
  channel: "ARD",
  topic: "Sturm der Liebe",
  title: "Folge 4663",
  description: "",
  filmlisteTimestamp: 1,
  duration: 2942,
  size: 100,
  url_website: "https://example.org/folge",
  url_video: "https://example.org/folge.mp4",
  url_video_hd: "",
  url_video_low: "",
};

const soapRules = (rulesetData as Ruleset[]).filter((rule) => rule.topic === "Sturm der Liebe");

describe("findEpisodeByAbsoluteNumber", () => {
  it("nutzt bei fortlaufender Nummerierung die Episodennummer", () => {
    expect(findEpisodeByAbsoluteNumber(soap, 4663)).toMatchObject({
      seasonNumber: 22,
      episodeNumber: 4663,
    });
    expect(findEpisodeByAbsoluteNumber(soap, 4)).toBeUndefined();
  });

  it("zählt reguläre Folgen, wenn die Staffeln neu beginnen", () => {
    const restarting = show([
      episode(2, 2),
      episode(0, 1),
      episode(1, 1),
      episode(2, 1),
      episode(1, 2),
      episode(1, 3),
    ]);
    expect(findEpisodeByAbsoluteNumber(restarting, 3)).toMatchObject({
      seasonNumber: 1,
      episodeNumber: 3,
    });
    expect(findEpisodeByAbsoluteNumber(restarting, 5)).toMatchObject({
      seasonNumber: 2,
      episodeNumber: 2,
    });
    expect(findEpisodeByAbsoluteNumber(restarting, 6)).toBeUndefined();
  });
});

describe("Zuordnung über fortlaufende Folgennummern", () => {
  vi.mocked(getShowInfoByTvdbId).mockResolvedValue(soap);

  it("hat für jedes Titelformat eine Regel mit dieser Strategie", () => {
    expect(soapRules).toHaveLength(5);
    expect(soapRules.every((rule) => rule.matchingStrategy === "ByAbsoluteEpisodeNumber")).toBe(
      true
    );
  });

  it.each([
    ["Folge 4663", 22, 4663],
    ["Sturm der Liebe (1810)", 9, 1810],
    ["Episode 684", 5, 684],
  ])("ordnet „%s“ S%iE%i zu", async (title, season, number) => {
    const results = await Promise.all(
      soapRules.map((rule) => diagnoseRuleset({ ...item, title }, rule, soap))
    );
    const matched = results.filter((result) => result.status === "matched");
    expect(matched.length).toBeGreaterThan(0);
    for (const result of matched) expect(result.episode).toMatchObject({ season, episode: number });
  });

  it("lässt unbekannte Nummern unzugeordnet", async () => {
    const rule = soapRules.find((r) => r.episodeRegex === "^Folge\\s(\\d+)$")!;
    expect(await diagnoseRuleset({ ...item, title: "Folge 9999" }, rule, soap)).toMatchObject({
      status: "unmatched",
    });
  });

  it("lässt sich im Regeleditor speichern", () => {
    expect(
      rulesetInput.safeParse({
        topic: "Sturm der Liebe",
        tvdbId: 176491,
        matchingStrategy: "ByAbsoluteEpisodeNumber",
        filters: "[]",
        titleRegexRules: "[]",
        seasonRegex: "",
        episodeRegex: "Folge\\s(\\d+)",
      }).success
    ).toBe(true);
  });
});
