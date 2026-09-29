import { beforeEach, describe, expect, it, vi } from "vitest";
import { mediathekCache } from "@/lib/cache";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { getSetting } from "@/lib/settings";
import { MatchingStrategy, type ApiResultItem, type Ruleset, type TvdbData } from "@/types";
import { fetchSearchResultsById } from "./mediathek";
import {
  ensureRulesetsLoaded,
  getAllTopics,
  getRulesetsForTopicAndTvdbId,
  getOrGenerateRulesetForShow,
} from "./rulesets";
import { getShowInfoByTvdbId } from "./shows";

vi.mock("@/lib/fetch-retry", () => ({ fetchWithRetry: vi.fn() }));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async () => null),
  getMinDurationSeconds: vi.fn(async () => 300),
}));
vi.mock("./shows", () => ({ getShowInfoByTvdbId: vi.fn() }));
vi.mock("./rulesets", () => ({
  ensureRulesetsLoaded: vi.fn(async () => undefined),
  getAllTopics: vi.fn(),
  getRulesetsForTopicAndTvdbId: vi.fn(),
  getOrGenerateRulesetForShow: vi.fn(async () => null),
}));

const show: TvdbData = {
  id: 273716,
  name: "Checker Tobi",
  germanName: null,
  aliases: [],
  episodes: [
    { name: "Der Klimakrisen-Check", seasonNumber: 14, episodeNumber: 7, aired: null, runtime: 25 },
    { name: "Der Kinder-Check", seasonNumber: 14, episodeNumber: 8, aired: null, runtime: 25 },
  ],
};

function rule(topic = "Checker Reportagen", tvdbId = show.id): Ruleset {
  return {
    id: 1,
    mediaId: 1,
    topic,
    priority: 1,
    filters: "[]",
    titleRegexRules: JSON.stringify([{ type: "regex", field: "title", pattern: "(.*)" }]),
    episodeRegex: null,
    seasonRegex: null,
    matchingStrategy: MatchingStrategy.ItemTitleExact,
    media: {
      media_id: 1,
      media_name: show.name,
      media_type: "tv",
      media_tvdbId: tvdbId,
      media_tmdbId: null,
      media_imdbId: null,
    },
  };
}

function item(overrides: Partial<ApiResultItem> = {}): ApiResultItem {
  return {
    channel: "BR",
    topic: "Checker Reportagen",
    title: "Der Klimakrisen-Check",
    description: "",
    filmlisteTimestamp: 1_700_000_000,
    duration: 1500,
    size: 500_000_000,
    url_website: "https://example.com/climate",
    url_video: "https://example.com/climate.mp4",
    url_video_low: "",
    url_video_hd: "",
    ...overrides,
  };
}

function setRules(rules: Ruleset[]) {
  vi.mocked(getAllTopics).mockReturnValue([...new Set(rules.map((r) => r.topic))]);
  vi.mocked(getRulesetsForTopicAndTvdbId).mockImplementation((topic, id) =>
    rules.filter((r) => r.topic === topic && r.media.media_tvdbId === id)
  );
}

function mockSearch(results: Record<string, ApiResultItem[] | null>) {
  vi.mocked(fetchWithRetry).mockImplementation(async (_url, options) => {
    const { queries } = JSON.parse(String(options?.body));
    // Each request must represent one alternative, not an AND of name and topic.
    expect(queries).toHaveLength(1);
    const found = results[queries[0].query];
    return found === null
      ? new Response("unavailable", { status: 503 })
      : Response.json({ result: { results: found ?? [] } });
  });
}

function requests() {
  return vi
    .mocked(fetchWithRetry)
    .mock.calls.map(([, options]) => JSON.parse(String(options?.body)).queries[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mediathekCache.clear();
  vi.mocked(getSetting).mockResolvedValue(null);
  vi.mocked(getShowInfoByTvdbId).mockResolvedValue(show);
  setRules([rule()]);
});

describe("TVDB search with ruleset topics", () => {
  it("finds S14E07 through its topic even when the series name returns nothing", async () => {
    mockSearch({ "Checker Tobi": [], "Checker Reportagen": [item()] });

    const xml = await fetchSearchResultsById(show, "14", "7", 100, 0);

    expect(xml).toContain("S14E07");
    expect(xml).toContain("climate.mp4");
    expect(requests()).toContainEqual({ fields: ["topic"], query: "Checker Reportagen" });
    expect(vi.mocked(ensureRulesetsLoaded).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fetchWithRetry).mock.invocationCallOrder[0]
    );
  });

  it("searches every related topic once and deduplicates overlapping videos", async () => {
    setRules([rule(), rule(), rule("Checker Extras"), rule("Unrelated", 999)]);
    mockSearch({
      "Checker Tobi": [item()],
      "Checker Reportagen": [item()],
      "Checker Extras": [
        item({
          topic: "Checker Extras",
          title: "Der Kinder-Check",
          url_video: "https://example.com/kids.mp4",
        }),
      ],
    });

    const xml = await fetchSearchResultsById(show, "14", null, 100, 0);

    expect(
      requests()
        .map((q) => q.query)
        .sort()
    ).toEqual(["Checker Extras", "Checker Reportagen", "Checker Tobi"]);
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml).toContain("S14E07");
    expect(xml).toContain("S14E08");
  });

  it("preserves the German series-name search when no ruleset exists", async () => {
    setRules([]);
    mockSearch({});

    await fetchSearchResultsById({ ...show, germanName: "Deutscher Titel" }, null, null, 100, 0);

    expect(requests()).toEqual([{ fields: ["topic", "title"], query: "Deutscher Titel" }]);
  });

  it("does not repeat a topic already covered by the series-name query", async () => {
    setRules([rule("Checker Tobi")]);
    mockSearch({ "Checker Tobi": [item({ topic: "Checker Tobi" })] });

    const xml = await fetchSearchResultsById(show, "14", "7", 100, 0);

    expect(requests()).toHaveLength(1);
    expect(xml).toContain("S14E07");
  });

  it("keeps the newest publication date when matching records share a video URL", async () => {
    const newer = 1_800_000_000;
    const older = 1_700_000_000;
    mockSearch({
      "Checker Tobi": [item({ filmlisteTimestamp: newer })],
      "Checker Reportagen": [item({ filmlisteTimestamp: older })],
    });

    const xml = await fetchSearchResultsById(show, "14", "7", 100, 0);

    expect(xml.match(/<item>/g)).toHaveLength(1);
    expect(xml).toContain(`<pubDate>${new Date(newer * 1000).toUTCString()}</pubDate>`);
    expect(xml).not.toContain(new Date(older * 1000).toUTCString());
  });

  it("retries a failed topic without caching partial RSS or repeating successful searches", async () => {
    mockSearch({ "Checker Tobi": [], "Checker Reportagen": null });
    expect(await fetchSearchResultsById(show, "14", "7", 100, 0)).not.toContain("<item>");

    mockSearch({ "Checker Reportagen": [item()] });
    const xml = await fetchSearchResultsById(show, "14", "7", 100, 0);

    expect(xml).toContain("S14E07");
    expect(requests().map((q) => q.query)).toEqual([
      "Checker Tobi",
      "Checker Reportagen",
      "Checker Reportagen",
    ]);
    await fetchSearchResultsById(show, "14", "7", 100, 0);
    await fetchSearchResultsById(show, "14", null, 10, 0);
    expect(fetchWithRetry).toHaveBeenCalledTimes(3);
  });

  it("returns topic matches when the series-name request fails and retries that request", async () => {
    mockSearch({ "Checker Tobi": null, "Checker Reportagen": [item()] });
    expect(await fetchSearchResultsById(show, "14", "7", 100, 0)).toContain("S14E07");

    mockSearch({ "Checker Tobi": [] });
    expect(await fetchSearchResultsById(show, "14", "7", 100, 0)).toContain("S14E07");
    expect(requests().map((q) => q.query)).toEqual([
      "Checker Tobi",
      "Checker Reportagen",
      "Checker Tobi",
    ]);
  });

  it("picks up newly loaded topics despite a cached empty response", async () => {
    setRules([]);
    mockSearch({ "Checker Tobi": [] });
    await fetchSearchResultsById(show, "14", "7", 100, 0);
    setRules([rule()]);
    mockSearch({ "Checker Reportagen": [item()] });

    expect(await fetchSearchResultsById(show, "14", "7", 100, 0)).toContain("S14E07");
    expect(requests().map((q) => q.query)).toEqual(["Checker Tobi", "Checker Reportagen"]);
  });

  it.each(["provider.mediathekview.enabled", "provider.srf.enabled"])(
    "retains successful topic results when loading %s rejects and retries the failed search",
    async (setting) => {
      let failed = false;
      vi.mocked(getSetting).mockImplementation(async (key) => {
        if (key === setting && !failed) {
          failed = true;
          throw new Error("Temporary settings failure");
        }
        return null;
      });
      mockSearch({ "Checker Reportagen": [item()] });

      expect(await fetchSearchResultsById(show, "14", "7", 100, 0)).toContain("S14E07");
      expect(await fetchSearchResultsById(show, "14", "7", 100, 0)).toContain("S14E07");
      expect(requests().map((q) => q.query)).toEqual(["Checker Reportagen", "Checker Tobi"]);
    }
  );

  describe.each(["same request", "separate requests"])("duplicates from %s", (source) => {
    it.each([
      { topic: "Unrelated" },
      { title: "Trailer" },
      { duration: 10 },
      { title: "Der Kinder-Check" },
    ])("keeps the desired episode when a duplicate differs by %j", async (overrides) => {
      mockSearch(
        source === "same request"
          ? { "Checker Reportagen": [item(), item(overrides)] }
          : { "Checker Tobi": [item()], "Checker Reportagen": [item(overrides)] }
      );

      const xml = await fetchSearchResultsById(show, "14", "7", 100, 0);

      expect(xml).toContain("S14E07");
      expect(xml.match(/<item>/g)).toHaveLength(1);
    });
  });
});

it("skips a broad topic when its required title prefix is covered by the series-name query", async () => {
  const filmRule = {
    ...rule("Film"),
    titleRegexRules: JSON.stringify([
      { type: "regex", field: "title", pattern: "Checker Tobi - (.*)" },
    ]),
  };
  setRules([filmRule]);
  mockSearch({
    "Checker Tobi": [item({ topic: "Film", title: "Checker Tobi - Der Klimakrisen-Check" })],
  });
  const xml = await fetchSearchResultsById(show, "14", "7", 100, 0);
  expect(requests()).toEqual([{ fields: ["topic", "title"], query: "Checker Tobi" }]);
  expect(xml).toContain("S14E07");
});

it("uses the discovery ruleset snapshot if rulesets change during the provider request", async () => {
  vi.mocked(fetchWithRetry).mockImplementation(async (_url, options) => {
    const { queries } = JSON.parse(String(options?.body));
    setRules([]);
    return Response.json({
      result: { results: queries[0].query === "Checker Reportagen" ? [item()] : [] },
    });
  });
  const xml = await fetchSearchResultsById(show, "14", "7", 100, 0);
  expect(xml).toContain("S14E07");
  expect(ensureRulesetsLoaded).toHaveBeenCalledTimes(1);
});

it("keeps a topic search when any ruleset can match titles without the series name", async () => {
  setRules([
    rule("Film"),
    {
      ...rule("Film"),
      titleRegexRules: JSON.stringify([
        { type: "regex", field: "title", pattern: "Checker Tobi - (.*)" },
      ]),
    },
  ]);
  mockSearch({ Film: [item({ topic: "Film" })] });
  expect(await fetchSearchResultsById(show, "14", "7", 100, 0)).toContain("S14E07");
  expect(requests()).toContainEqual({ fields: ["topic"], query: "Film" });
});

it("invalidates matched RSS when rules change without changing topics", async () => {
  mockSearch({ "Checker Reportagen": [item()] });
  expect(await fetchSearchResultsById(show, "14", "7", 100, 0)).toContain("S14E07");
  setRules([
    {
      ...rule(),
      filters: JSON.stringify([{ attribute: "duration", type: "GreaterThan", value: "90" }]),
    },
  ]);
  expect(await fetchSearchResultsById(show, "14", "7", 100, 0)).not.toContain("<item>");
});

it("omits Donna Leon broad topics based on required title filters", async () => {
  const { default: checkedInRules } = await import("../../data/rulesets.json");
  setRules(checkedInRules.filter((r) => r.media.media_tvdbId === 101211) as Ruleset[]);
  mockSearch({});
  await fetchSearchResultsById({ ...show, id: 101211, name: "Donna Leon" }, null, null, 100, 0);
  expect(requests()).toEqual([{ fields: ["topic", "title"], query: "Donna Leon" }]);
});

it("does not regenerate missing rulesets before a cached response", async () => {
  setRules([]);
  mockSearch({ "Checker Tobi": [item()] });
  await fetchSearchResultsById(show, "14", "7", 100, 0);
  await fetchSearchResultsById(show, "14", "7", 100, 0);
  expect(getOrGenerateRulesetForShow).toHaveBeenCalledTimes(1);
  expect(fetchWithRetry).toHaveBeenCalledTimes(1);
});

it("does not attempt ruleset generation for empty search results", async () => {
  setRules([]);
  mockSearch({});
  await fetchSearchResultsById(show, null, null, 100, 0);
  await fetchSearchResultsById(show, null, null, 100, 0);
  expect(getOrGenerateRulesetForShow).not.toHaveBeenCalled();
  expect(fetchWithRetry).toHaveBeenCalledTimes(1);
});
