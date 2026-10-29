import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResultItem, TvdbData } from "@/types";
import {
  generateRegexPatterns,
  generateRulesetForShow,
  getGeneratedRulesetByTopic,
  getGeneratedRulesetByTvdbId,
  getGeneratedRulesets,
} from "./ruleset-generator";

const { queryContent, findFirst, findUnique, findMany, create } = vi.hoisted(() => ({
  queryContent: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
}));

vi.mock("./content-search", () => ({ queryContent }));
vi.mock("@/lib/db", () => ({
  prisma: { generatedRuleset: { findFirst, findUnique, findMany, create } },
}));

const UUID = "0000002a-1111-4222-8333-444455556666";

function item(title: string, topic = "Die Bergretter"): ApiResultItem {
  return {
    channel: "ZDF",
    topic,
    title,
    description: "",
    filmlisteTimestamp: 0,
    duration: 2700,
    size: 0,
    url_website: "",
    url_video: "",
    url_video_low: "",
    url_video_hd: "",
  };
}

function show(overrides: Partial<TvdbData> = {}): TvdbData {
  return {
    id: 4711,
    name: "The Mountain Medic",
    germanName: "Die Bergretter",
    aliases: [],
    episodes: [],
    ...overrides,
  };
}

function lastGroup(pattern: string, text: string): string | undefined {
  const match = text.match(new RegExp(pattern));
  return match?.[match.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(null);
  findUnique.mockResolvedValue(null);
  create.mockImplementation(async ({ data }) => ({ id: UUID, ...data }));
});

describe("generateRegexPatterns", () => {
  it("builds season and episode regexes for the (S01/E02) MediathekView notation", () => {
    const patterns = generateRegexPatterns(
      [item("Lawinengefahr (S14/E03)")],
      "SeasonAndEpisodeNumber",
      "Die Bergretter"
    );

    expect(lastGroup(patterns.seasonRegex, "Lawinengefahr (S14/E03)")).toBe("14");
    expect(lastGroup(patterns.episodeRegex, "Lawinengefahr (S14/E03)")).toBe("03");
    expect(patterns.titleRegexRules).toBe("[]");
  });

  it("builds regexes for compact S01E02 and spelled-out Staffel/Folge notations", () => {
    const compact = generateRegexPatterns([item("Lawine S02E11")], "SeasonAndEpisodeNumber", "X");
    expect(lastGroup(compact.seasonRegex, "Lawine S02E11")).toBe("02");
    expect(lastGroup(compact.episodeRegex, "Lawine S02E11")).toBe("11");

    const spelled = generateRegexPatterns(
      [item("Staffel 3, Folge 7: Absturz")],
      "SeasonAndEpisodeNumber",
      "X"
    );
    expect(lastGroup(spelled.seasonRegex, "Staffel 3, Folge 7: Absturz")).toBe("3");
    expect(lastGroup(spelled.episodeRegex, "Staffel 3, Folge 7: Absturz")).toBe("7");
  });

  it.each([
    ["Sendung vom 15. Januar 2024", "15. Januar 2024"],
    ["Sendung vom 15.01.2024", "15.01.2024"],
    ["heute journal 15.01.2024", "15.01.2024"],
  ])("extracts the air date from %s", (title, expected) => {
    const { titleRegexRules } = generateRegexPatterns([item(title)], "ItemTitleEqualsAirdate", "X");
    const [rule] = JSON.parse(titleRegexRules);
    expect(rule).toMatchObject({ type: "regex", field: "title" });
    expect(lastGroup(rule.pattern, title)).toBe(expected);
  });

  it.each([
    ["Sturm der Liebe Episode 4211", "4211"],
    ["Rote Rosen Folge 3901", "3901"],
    ["Die Chronik Teil 12", "12"],
  ])("extracts absolute episode numbers from %s", (title, expected) => {
    const patterns = generateRegexPatterns([item(title)], "ByAbsoluteEpisodeNumber", "X");
    expect(patterns.seasonRegex).toBe("");
    expect(lastGroup(patterns.episodeRegex, title)).toBe(expected);
  });

  it("anchors ItemTitleExact rules on the escaped topic for colon and dash separators", () => {
    const topic = "Weltspiegel (extra)";
    const colon = generateRegexPatterns(
      [item("Weltspiegel (extra): Ukraine")],
      "ItemTitleExact",
      topic
    );
    const [colonRule] = JSON.parse(colon.titleRegexRules);
    expect(lastGroup(colonRule.pattern, "Weltspiegel (extra): Ukraine")).toBe("Ukraine");
    // The topic's parentheses must be escaped, not treated as a regex group.
    expect(colonRule.pattern.startsWith("^Weltspiegel \\(extra\\)")).toBe(true);

    const dash = generateRegexPatterns(
      [item("Weltspiegel (extra) - Ukraine")],
      "ItemTitleExact",
      topic
    );
    const [dashRule] = JSON.parse(dash.titleRegexRules);
    expect(lastGroup(dashRule.pattern, "Weltspiegel (extra) - Ukraine")).toBe("Ukraine");
  });

  it("falls back to whole-title matching when a strategy finds no supported notation", () => {
    const patterns = generateRegexPatterns(
      [item("Ohne Nummer")],
      "SeasonAndEpisodeNumber",
      "Die Bergretter"
    );
    const [rule] = JSON.parse(patterns.titleRegexRules);

    expect(patterns.episodeRegex).toBe("");
    expect(lastGroup(rule.pattern, "Ohne Nummer")).toBe("Ohne Nummer");
  });
});

describe("generateRulesetForShow", () => {
  it("returns an existing ruleset for the TVDB id without searching", async () => {
    findFirst.mockResolvedValue({
      id: UUID,
      topic: "Die Bergretter",
      tvdbId: 4711,
      showName: "The Mountain Medic",
      germanName: "Die Bergretter",
      matchingStrategy: "SeasonAndEpisodeNumber",
      filters: "[]",
      episodeRegex: "",
      seasonRegex: "",
      titleRegexRules: "[]",
    });

    const ruleset = await generateRulesetForShow(4711, show());

    expect(queryContent).not.toHaveBeenCalled();
    expect(ruleset).toMatchObject({
      id: 0x2a,
      mediaId: 4711,
      topic: "Die Bergretter",
      // Empty regexes are normalised to null so the matcher skips them.
      episodeRegex: null,
      seasonRegex: null,
      media: { media_type: "show", media_tvdbId: 4711, media_name: "The Mountain Medic" },
    });
  });

  it("detects SeasonAndEpisodeNumber, stores a ruleset with a duration filter and sorted query", async () => {
    queryContent.mockResolvedValue([
      item("Abgestürzt (S14/E01)"),
      item("Vermisst (S14/E02)"),
      item("Lawine (S14/E03)"),
      item("Making-of", "Die Bergretter - Hinter den Kulissen"),
    ]);

    const ruleset = await generateRulesetForShow(4711, show());

    expect(queryContent).toHaveBeenCalledWith(
      [{ fields: ["topic"], query: "Die Bergretter" }],
      50,
      {
        sortBy: "timestamp",
        future: false,
      }
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        topic: "Die Bergretter",
        tvdbId: 4711,
        matchingStrategy: "SeasonAndEpisodeNumber",
        filters: '[{"attribute":"duration","type":"GreaterThan","value":"15"}]',
      }),
    });
    expect(ruleset?.matchingStrategy).toBe("SeasonAndEpisodeNumber");
    expect(ruleset?.seasonRegex).not.toBeNull();
  });

  it("prefers the date strategy when air dates outnumber episode markers", async () => {
    queryContent.mockResolvedValue([
      item("Sendung vom 01.02.2024", "Markus Lanz"),
      item("Sendung vom 02.02.2024", "Markus Lanz"),
      item("Sendung vom 03.02.2024", "Markus Lanz"),
    ]);

    const ruleset = await generateRulesetForShow(1, show({ germanName: "Markus Lanz" }));

    expect(ruleset?.matchingStrategy).toBe("ItemTitleEqualsAirdate");
  });

  it("detects absolute numbering for daily soaps", async () => {
    queryContent.mockResolvedValue([
      item("Folge 4210", "Sturm der Liebe"),
      item("Folge 4211", "Sturm der Liebe"),
      item("Folge 4212", "Sturm der Liebe"),
    ]);

    const ruleset = await generateRulesetForShow(2, show({ germanName: "Sturm der Liebe" }));

    expect(ruleset?.matchingStrategy).toBe("ByAbsoluteEpisodeNumber");
    expect(lastGroup(ruleset!.episodeRegex!, "Folge 4212")).toBe("4212");
  });

  it("uses ItemTitleExact when titles repeat the topic with a separator", async () => {
    queryContent.mockResolvedValue([
      item("Weltspiegel extra: Ukraine", "Weltspiegel extra"),
      item("Weltspiegel extra: Gaza", "Weltspiegel extra"),
      item("Weltspiegel extra: Taiwan", "Weltspiegel extra"),
    ]);

    const ruleset = await generateRulesetForShow(3, show({ germanName: "Weltspiegel extra" }));

    expect(ruleset?.matchingStrategy).toBe("ItemTitleExact");
  });

  it("defaults to ItemTitleIncludes for unstructured titles", async () => {
    queryContent.mockResolvedValue([item("Ein Tag am Berg"), item("Nebel")]);

    expect((await generateRulesetForShow(4711, show()))?.matchingStrategy).toBe(
      "ItemTitleIncludes"
    );
  });

  it("matches topics case-insensitively and via aliases or partial names", async () => {
    queryContent.mockResolvedValue([item("A", "DIE BERGRETTER"), item("B", "Andere Sendung")]);
    expect((await generateRulesetForShow(4711, show()))?.topic).toBe("DIE BERGRETTER");

    queryContent.mockResolvedValue([item("A", "Bergretter Spezial"), item("B", "Andere Sendung")]);
    const viaAlias = await generateRulesetForShow(
      4711,
      show({ germanName: null, name: "X", aliases: [{ language: "deu", name: "Bergretter" }] })
    );
    expect(viaAlias?.topic).toBe("Bergretter Spezial");
  });

  it("uses a single returned topic even when its name differs", async () => {
    queryContent.mockResolvedValue([item("A", "Bergrettung im Einsatz")]);

    expect((await generateRulesetForShow(4711, show()))?.topic).toBe("Bergrettung im Einsatz");
  });

  it("gives up when several unrelated topics are returned", async () => {
    queryContent.mockResolvedValue([item("A", "Tatort"), item("B", "Polizeiruf 110")]);

    expect(await generateRulesetForShow(4711, show())).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("retries with the English name when the German search returns nothing", async () => {
    queryContent
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([item("Pilot (S01/E01)", "The Mountain Medic")]);

    const ruleset = await generateRulesetForShow(4711, show());

    expect(queryContent).toHaveBeenNthCalledWith(
      2,
      [{ fields: ["topic"], query: "The Mountain Medic" }],
      50,
      expect.anything()
    );
    expect(ruleset?.topic).toBe("The Mountain Medic");
  });

  it("returns null when neither name finds anything or the API is unavailable", async () => {
    queryContent.mockResolvedValue([]);
    expect(await generateRulesetForShow(4711, show())).toBeNull();
    expect(queryContent).toHaveBeenCalledTimes(2);

    queryContent.mockClear();
    queryContent.mockResolvedValue(null);
    expect(await generateRulesetForShow(4711, show({ germanName: null }))).toBeNull();
    expect(queryContent).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing ruleset for the matched topic instead of creating a duplicate", async () => {
    queryContent.mockResolvedValue([item("A")]);
    findUnique.mockResolvedValue({
      id: UUID,
      topic: "Die Bergretter",
      tvdbId: 9999,
      showName: "Other",
      germanName: null,
      matchingStrategy: "ItemTitleIncludes",
      filters: "[]",
      episodeRegex: "x",
      seasonRegex: "y",
      titleRegexRules: "[]",
    });

    const ruleset = await generateRulesetForShow(4711, show());

    expect(create).not.toHaveBeenCalled();
    expect(ruleset?.mediaId).toBe(9999);
  });
});

describe("generated ruleset lookups", () => {
  const row = {
    id: "not-hex-at-all",
    topic: "Die Bergretter",
    tvdbId: 4711,
    showName: "The Mountain Medic",
    germanName: null,
    matchingStrategy: "ItemTitleIncludes",
    filters: "[]",
    episodeRegex: "",
    seasonRegex: "",
    titleRegexRules: "[]",
  };

  it("maps database rows and falls back to a fixed numeric id for non-hex ids", async () => {
    findMany.mockResolvedValue([row]);

    const [ruleset] = await getGeneratedRulesets();

    expect(ruleset.id).toBe(99999);
    expect(ruleset.topic).toBe("Die Bergretter");
  });

  it("returns null for unknown topics and TVDB ids", async () => {
    expect(await getGeneratedRulesetByTopic("Unbekannt")).toBeNull();
    expect(await getGeneratedRulesetByTvdbId(1)).toBeNull();

    findUnique.mockResolvedValue(row);
    findFirst.mockResolvedValue(row);
    expect((await getGeneratedRulesetByTopic("Die Bergretter"))?.mediaId).toBe(4711);
    expect((await getGeneratedRulesetByTvdbId(4711))?.topic).toBe("Die Bergretter");
  });
});
