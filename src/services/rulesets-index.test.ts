import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchingStrategy, type Ruleset, type TvdbData } from "@/types";

const { getGeneratedRulesets, generateRulesetForShow, getGeneratedRulesetByTvdbId } = vi.hoisted(
  () => ({
    getGeneratedRulesets: vi.fn(),
    generateRulesetForShow: vi.fn(),
    getGeneratedRulesetByTvdbId: vi.fn(),
  })
);
vi.mock("./ruleset-generator", () => ({
  getGeneratedRulesets,
  generateRulesetForShow,
  getGeneratedRulesetByTvdbId,
}));

function rule(topic: string, tvdbId: number, priority = 0, id = tvdbId * 10 + priority): Ruleset {
  return {
    id,
    mediaId: tvdbId,
    topic,
    priority,
    filters: "[]",
    titleRegexRules: "[]",
    episodeRegex: null,
    seasonRegex: null,
    matchingStrategy: MatchingStrategy.SeasonAndEpisodeNumber,
    media: {
      media_id: tvdbId,
      media_name: topic,
      media_type: "show",
      media_tvdbId: tvdbId,
      media_tmdbId: null,
      media_imdbId: null,
    },
  };
}

const show: TvdbData = { id: 7, name: "Show", germanName: "Sendung", aliases: [], episodes: [] };

async function loadWith(external: Ruleset[], generated: Ruleset[] = []) {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(external))
  );
  getGeneratedRulesets.mockResolvedValue(generated);
  const rulesets = await import("./rulesets");
  await rulesets.ensureRulesetsLoaded();
  return rulesets;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation(() => {});
  getGeneratedRulesetByTvdbId.mockResolvedValue(null);
  generateRulesetForShow.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ruleset index", () => {
  it("groups external rulesets by topic and orders them by priority", async () => {
    const { getRulesetsForTopic, getAllTopics } = await loadWith([
      rule("Tatort", 1, 5),
      rule("Tatort", 2, 1),
      rule("Polizeiruf 110", 3, 0),
    ]);

    expect(getRulesetsForTopic("Tatort").map((r) => r.priority)).toEqual([1, 5]);
    expect(getAllTopics().sort()).toEqual(["Polizeiruf 110", "Tatort"]);
    expect(getRulesetsForTopic("Unbekannt")).toEqual([]);
  });

  it("lets a generated ruleset replace the external one for the same show but keeps others", async () => {
    const generated = { ...rule("Tatort", 1), id: 999 };
    const { getRulesetsForTopic, getRulesetsForTopicAndTvdbId, getAllTopics } = await loadWith(
      [rule("Tatort", 1, 0), rule("Tatort", 2, 1)],
      [generated, rule("Neu", 4)]
    );

    expect(getRulesetsForTopic("Tatort").map((r) => r.id)).toEqual([999, 21]);
    expect(getRulesetsForTopicAndTvdbId("Tatort", 1).map((r) => r.id)).toEqual([999]);
    expect(getRulesetsForTopicAndTvdbId("Tatort", 2).map((r) => r.id)).toEqual([21]);
    expect(getAllTopics()).toContain("Neu");
  });

  it("knows TVDB ids from both sources", async () => {
    const { hasRulesetForTvdbId } = await loadWith([rule("Tatort", 1)], [rule("Neu", 4)]);

    expect(hasRulesetForTvdbId(1)).toBe(true);
    expect(hasRulesetForTvdbId(4)).toBe(true);
    expect(hasRulesetForTvdbId(5)).toBe(false);
  });

  it("still loads external rulesets when generated rulesets cannot be read", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([rule("Tatort", 1)]))
    );
    getGeneratedRulesets.mockRejectedValue(new Error("database locked"));
    const { ensureRulesetsLoaded, getAllTopics, isRulesetsLoaded } = await import("./rulesets");

    await ensureRulesetsLoaded();

    expect(isRulesetsLoaded()).toBe(true);
    expect(getAllTopics()).toEqual(["Tatort"]);
  });

  it("reloads generated rulesets and clears cached search results", async () => {
    const { reloadLocalRulesets, getRulesetsForTopic } = await loadWith([]);
    const { mediathekCache } = await import("@/lib/cache");
    mediathekCache.set("search", { stale: true });
    getGeneratedRulesets.mockResolvedValue([rule("Neu", 4)]);

    await reloadLocalRulesets();

    expect(getRulesetsForTopic("Neu")).toHaveLength(1);
    expect(mediathekCache.get("search")).toBeUndefined();
  });
});

describe("getOrGenerateRulesetForShow", () => {
  it("returns null and generates nothing when a ruleset already exists", async () => {
    const { getOrGenerateRulesetForShow } = await loadWith([rule("Tatort", 7)]);

    expect(await getOrGenerateRulesetForShow(7, show)).toBeNull();
    expect(getGeneratedRulesetByTvdbId).not.toHaveBeenCalled();
    expect(generateRulesetForShow).not.toHaveBeenCalled();
  });

  it("adopts a stored generated ruleset into the in-memory index", async () => {
    const stored = rule("Sendung", 7);
    getGeneratedRulesetByTvdbId.mockResolvedValue(stored);
    const { getOrGenerateRulesetForShow, getRulesetsForTopic, hasRulesetForTvdbId } =
      await loadWith([]);

    expect(await getOrGenerateRulesetForShow(7, show)).toBe(stored);
    expect(generateRulesetForShow).not.toHaveBeenCalled();
    expect(getRulesetsForTopic("Sendung")).toEqual([stored]);
    expect(hasRulesetForTvdbId(7)).toBe(true);
  });

  it("generates a new ruleset once and then reuses it", async () => {
    const generated = rule("Sendung", 7);
    generateRulesetForShow.mockResolvedValue(generated);
    const { getOrGenerateRulesetForShow } = await loadWith([]);

    expect(await getOrGenerateRulesetForShow(7, show)).toBe(generated);
    expect(generateRulesetForShow).toHaveBeenCalledWith(7, show);
    expect(await getOrGenerateRulesetForShow(7, show)).toBeNull();
    expect(generateRulesetForShow).toHaveBeenCalledTimes(1);
  });

  it("returns null when generation finds nothing", async () => {
    const { getOrGenerateRulesetForShow, hasRulesetForTvdbId } = await loadWith([]);

    expect(await getOrGenerateRulesetForShow(7, show)).toBeNull();
    expect(hasRulesetForTvdbId(7)).toBe(false);
  });
});
