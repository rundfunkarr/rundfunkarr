import { beforeEach, describe, expect, it, vi } from "vitest";
import { mediathekCache } from "@/lib/cache";
import { MatchingStrategy, type ApiResultItem, type Ruleset, type TvdbData } from "@/types";
import { queryContent } from "./content-search";
import { fetchSearchResultsByString, fetchSearchResultsForRssSync } from "./mediathek";
import { getAllTopics, getRulesetsForTopic } from "./rulesets";
import { getShowInfoByTvdbId } from "./shows";

vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async () => null),
  getMinDurationSeconds: vi.fn(async () => 0),
  isSeriesUmlautStrippingEnabled: vi.fn(async () => false),
}));
vi.mock("./content-search", () => ({ queryContent: vi.fn() }));
vi.mock("./shows", () => ({ getShowInfoByTvdbId: vi.fn() }));
vi.mock("./rulesets", () => ({
  ensureRulesetsLoaded: vi.fn(async () => undefined),
  getAllTopics: vi.fn(() => []),
  getRulesetsForTopic: vi.fn(),
  getRulesetsForTopicAndTvdbId: vi.fn(() => []),
  getOrGenerateRulesetForShow: vi.fn(async () => null),
}));

const TATORT = 83214;
const TATORTREINIGER = 289561;

function rule(
  id: number,
  tvdbId: number,
  strategy: MatchingStrategy,
  topic = "Tatort",
  filters = "[]"
): Ruleset {
  return {
    id,
    mediaId: id,
    topic,
    priority: 1,
    filters,
    titleRegexRules: JSON.stringify([{ type: "regex", field: "title", pattern: "(.*)" }]),
    episodeRegex: null,
    seasonRegex: null,
    matchingStrategy: strategy,
    media: {
      media_id: id,
      media_name: "Tatort",
      media_type: "tv",
      media_tvdbId: tvdbId,
      media_tmdbId: null,
      media_imdbId: null,
    },
  };
}

// Mirrors the shipped rulesets: several rulesets per topic, some for other shows.
const rulesets = [
  rule(1, TATORT, MatchingStrategy.ItemTitleIncludes),
  rule(2, TATORT, MatchingStrategy.ItemTitleIncludes),
  rule(3, TATORT, MatchingStrategy.ItemTitleExact),
  rule(4, TATORTREINIGER, MatchingStrategy.ItemTitleEqualsAirdate),
];

function item(index: number): ApiResultItem {
  return {
    channel: "ARD",
    topic: "Tatort",
    title: `Fall ${index}`,
    description: "",
    filmlisteTimestamp: 1_700_000_000 + index,
    duration: 5400,
    size: 1_000_000_000,
    url_website: `https://example.com/${index}`,
    url_video: `https://example.com/${index}.mp4`,
    url_video_low: "",
    url_video_hd: "",
  };
}

const items = Array.from({ length: 500 }, (_, i) => item(i));

const tatort: TvdbData = {
  id: TATORT,
  name: "Tatort",
  germanName: "Tatort",
  aliases: [],
  episodes: [
    { name: "Fall 1", seasonNumber: 2024, episodeNumber: 1, aired: null, runtime: 90 },
    { name: "Fall 2", seasonNumber: 2024, episodeNumber: 2, aired: null, runtime: 90 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mediathekCache.clear();
  vi.mocked(queryContent).mockResolvedValue(items);
  vi.mocked(getAllTopics).mockReturnValue(["Tatort"]);
  vi.mocked(getRulesetsForTopic).mockImplementation((topic) =>
    rulesets.filter((r) => r.topic === topic)
  );
});

describe("show lookups during ruleset matching", () => {
  it("looks up each unresolvable show once per name search, not once per item", async () => {
    vi.mocked(getShowInfoByTvdbId).mockResolvedValue(null);

    const xml = await fetchSearchResultsByString("Tatort", null, 100, 0);

    expect(getShowInfoByTvdbId).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(getShowInfoByTvdbId)
        .mock.calls.map(([id]) => id)
        .sort((a, b) => a - b)
    ).toEqual([TATORT, TATORTREINIGER]);
  });

  it("keeps matches identical while looking up a found show only once", async () => {
    vi.mocked(getShowInfoByTvdbId).mockImplementation(async (id) =>
      id === TATORT ? tatort : null
    );

    const xml = await fetchSearchResultsByString("Tatort", null, 100, 0);

    expect(getShowInfoByTvdbId).toHaveBeenCalledTimes(2);
    expect(xml).toContain("S2024E01");
    expect(xml).toContain("S2024E02");
  });

  it("bounds lookups in RSS sync, which matches every item against every ruleset", async () => {
    vi.mocked(getShowInfoByTvdbId).mockResolvedValue(null);

    await fetchSearchResultsForRssSync(100, 0);

    expect(getShowInfoByTvdbId).toHaveBeenCalledTimes(2);
  });

  it("does not look up shows for items rejected by ruleset filters", async () => {
    vi.mocked(getRulesetsForTopic).mockReturnValue([
      rule(
        5,
        TATORT,
        MatchingStrategy.ItemTitleIncludes,
        "Tatort",
        JSON.stringify([{ attribute: "title", type: "Contains", value: "nirgends" }])
      ),
    ]);
    vi.mocked(getShowInfoByTvdbId).mockResolvedValue(null);

    await fetchSearchResultsByString("Tatort", null, 100, 0);

    expect(getShowInfoByTvdbId).not.toHaveBeenCalled();
  });
});
