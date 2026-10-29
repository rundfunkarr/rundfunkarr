import { describe, expect, it } from "vitest";
import {
  generateGenericRssItems,
  generateMovieRssItems,
  generateRssItems,
  getValidationRss,
  parseNewznabCategoryIds,
  type QualityPreference,
} from "./newznab";
import type { ApiResultItem, MatchedEpisodeInfo, TmdbMovieData } from "@/types";
import type { MovieMatchResult } from "./movie-matcher";

const apiItem: ApiResultItem = {
  channel: "ARD",
  topic: "Tatort",
  title: "Borowski und der Wiedergänger",
  description: "Krimi",
  filmlisteTimestamp: 1_700_000_000,
  duration: 5400,
  size: 1_000_000_000,
  url_website: "https://www.ardmediathek.de/video/1",
  url_video: "https://cdn.example/video_720.mp4",
  url_video_low: "https://cdn.example/video_480.mp4",
  url_video_hd: "https://cdn.example/video_1080.mp4",
};

const episodeInfo: MatchedEpisodeInfo = {
  showName: "Tatort",
  matchedTitle: "Borowski und der Wiedergänger",
  tvdbId: 83214,
  episode: {
    name: "Borowski und der Wiedergänger",
    aired: null,
    runtime: 90,
    seasonNumber: 3,
    episodeNumber: 7,
  },
  item: apiItem,
};

const movie: TmdbMovieData = {
  tmdbId: 387,
  imdbId: "tt0082096",
  title: "Das Boot",
  germanTitle: "Das Boot",
  runtime: 149,
  releaseDate: "1981-09-17",
};
const movieMatch = (item: ApiResultItem = apiItem): MovieMatchResult =>
  ({ item, score: 100, titleMatch: "exact", durationDiff: 0 }) as unknown as MovieMatchResult;

function qualities(titles: string[]): string[] {
  return titles.map((title) => title.match(/\.(1080p|720p|480p)\./)?.[1] ?? "?");
}

const preferences: Array<[QualityPreference, string[]]> = [
  ["all", ["1080p", "720p", "480p"]],
  ["best", ["1080p"]],
  ["1080p", ["1080p"]],
  ["720p", ["720p"]],
  ["480p", ["480p"]],
];

describe.each([
  [
    "episodes",
    (p: QualityPreference, item = apiItem) => generateRssItems({ ...episodeInfo, item }, p),
  ],
  [
    "movies",
    (p: QualityPreference, item = apiItem) => generateMovieRssItems(movieMatch(item), movie, p),
  ],
  ["generic items", (p: QualityPreference, item = apiItem) => generateGenericRssItems(item, p)],
] as const)("quality selection for %s", (_kind, generate) => {
  it.each(preferences)("preference %s yields %j", (preference, expected) => {
    expect(qualities(generate(preference).map((i) => i.title))).toEqual(expected);
  });

  it("falls back to the next best quality for 'best'", () => {
    expect(
      qualities(generate("best", { ...apiItem, url_video_hd: "" }).map((i) => i.title))
    ).toEqual(["720p"]);
    expect(
      qualities(
        generate("best", { ...apiItem, url_video_hd: "", url_video: "" }).map((i) => i.title)
      )
    ).toEqual(["480p"]);
  });

  it("returns nothing when the requested quality is missing", () => {
    expect(generate("1080p", { ...apiItem, url_video_hd: "" })).toEqual([]);
  });

  it("scales the advertised size with the quality", () => {
    const sizes = generate("all").map((i) => i.enclosure.length);
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThan(sizes[2]);
  });
});

describe("generateRssItems for year-numbered seasons", () => {
  const daily: MatchedEpisodeInfo = {
    ...episodeInfo,
    episode: { ...episodeInfo.episode, seasonNumber: 2024, aired: new Date("2024-03-05") },
  };

  it("adds a daily release named after the air date next to the SxxEyy release", () => {
    const titles = generateRssItems(daily, "720p").map((i) => i.title);

    expect(titles).toEqual([
      "Tatort.S2024E07.Borowski.und.der.Wiedergaenger.GERMAN.720p.WEB.h264-MEDiATHEK",
      "Tatort.2024-03-05.Borowski.und.der.Wiedergaenger.GERMAN.720p.WEB.h264-MEDiATHEK",
    ]);
  });

  it("does not invent an air date for episodes without one", () => {
    const titles = generateRssItems(
      { ...daily, episode: { ...daily.episode, aired: null } },
      "720p"
    ).map((i) => i.title);

    expect(titles).toEqual([
      "Tatort.S2024E07.Borowski.und.der.Wiedergaenger.GERMAN.720p.WEB.h264-MEDiATHEK",
    ]);
  });

  it("uses season attributes and the TVDB id", () => {
    const [item] = generateRssItems(daily, "720p");

    expect(item.attributes).toEqual(
      expect.arrayContaining([
        { name: "season", value: "2024" },
        { name: "tvdbid", value: "83214" },
      ])
    );
  });
});

describe("generateMovieRssItems", () => {
  it("names releases after the German title and year with TMDB and IMDb ids", () => {
    const [item] = generateMovieRssItems(
      movieMatch(),
      { ...movie, germanTitle: "Das Böse Boot" },
      "best"
    );

    expect(item.title).toBe("Das.Boese.Boot.1981.GERMAN.1080p.WEB.h264-MEDiATHEK");
    expect(item.attributes).toEqual(
      expect.arrayContaining([
        { name: "category", value: "2000" },
        { name: "tmdbid", value: "387" },
        { name: "imdbid", value: "tt0082096" },
      ])
    );
    expect(item.guid.value).toContain("movie-1080p");
  });

  it("omits a missing year and missing ids", () => {
    const [item] = generateMovieRssItems(
      movieMatch(),
      { ...movie, releaseDate: null, imdbId: null, tmdbId: 0 },
      "720p"
    );

    expect(item.title).toBe("Das.Boot.GERMAN.720p.WEB.h264-MEDiATHEK");
    expect(item.attributes.map((a) => a.name)).toEqual(["category", "category"]);
  });

  it("skips streaming URLs unless HLS is enabled", () => {
    const hls = { ...apiItem, url_video_hd: "https://cdn.example/master.m3u8" };

    expect(
      qualities(generateMovieRssItems(movieMatch(hls), movie, "all").map((i) => i.title))
    ).toEqual(["720p", "480p"]);
    expect(
      qualities(generateMovieRssItems(movieMatch(hls), movie, "all", true).map((i) => i.title))
    ).toEqual(["1080p", "720p", "480p"]);
  });
});

describe("generic items: episode numbers from Mediathek titles", () => {
  function release(title: string) {
    const [item] = generateGenericRssItems({ ...apiItem, topic: "Die Bergretter", title }, "720p");
    const attr = (name: string) => item.attributes.find((a) => a.name === name)?.value;
    return { title: item.title, season: attr("season"), episode: attr("episode") };
  }

  it.each([
    [
      "Lawinengefahr (S14/E03)",
      "Die.Bergretter.S14E03.Lawinengefahr.GERMAN.720p.WEB.h264-MEDiATHEK",
      "14",
      "03",
    ],
    ["Staffel 2 Folge 3", "Die.Bergretter.S02E03.GERMAN.720p.WEB.h264-MEDiATHEK", "02", "03"],
    [
      "Folge 5: Der Anfang",
      "Die.Bergretter.S01E05.Der.Anfang.GERMAN.720p.WEB.h264-MEDiATHEK",
      "01",
      "05",
    ],
    ["Absturz (4/6)", "Die.Bergretter.S01E04.Absturz.GERMAN.720p.WEB.h264-MEDiATHEK", "01", "04"],
    [
      "Folge 12: Nebel (Audiodeskription)",
      "Die.Bergretter.S01E12.Nebel.GERMAN.AD.720p.WEB.h264-MEDiATHEK",
      "01",
      "12",
    ],
  ])("parses %s", (title, expectedTitle, season, episode) => {
    expect(release(title)).toEqual({ title: expectedTitle, season, episode });
  });

  it("removes subtitle markers and separators from the episode name", () => {
    expect(release("Nebel | Teil Eins (mit Untertitel) (2/3)").title).toBe(
      "Die.Bergretter.S01E02.Nebel.Teil.Eins.GERMAN.720p.WEB.h264-MEDiATHEK"
    );
  });

  it("keeps the full title without season attributes when no episode is found", () => {
    expect(release("Hinter den Kulissen")).toEqual({
      title: "Die.Bergretter.Hinter.den.Kulissen.GERMAN.720p.WEB.h264-MEDiATHEK",
      season: undefined,
      episode: undefined,
    });
  });
});

describe("Newznab category handling", () => {
  it("keeps only numeric, unique category ids", () => {
    expect(parseNewznabCategoryIds("5000, 5040,abc,5000,,2000")).toEqual(["5000", "5040", "2000"]);
    expect(parseNewznabCategoryIds(null)).toEqual([]);
  });

  it("returns a TV validation item with the parent category added", () => {
    const xml = getValidationRss(["5040"], new Date("2026-01-01T00:00:00Z"));

    expect(xml).toContain("RundfunkArr.Validation.S01E01");
    expect(xml).toContain('name="category" value="5040"');
    expect(xml).toContain('name="category" value="5000"');
    expect(xml).toContain("Thu, 01 Jan 2026 00:00:00 GMT");
  });

  it("returns a movie validation item for movie-only requests", () => {
    const xml = getValidationRss(["2040"]);

    expect(xml).toContain("RundfunkArr.Validation.2024.GERMAN");
    expect(xml).toContain('name="category" value="2000"');
    expect(xml).not.toContain('name="category" value="5000"');
  });

  it("advertises both parents for unknown or missing categories", () => {
    const xml = getValidationRss(["9999"]);

    expect(xml).toContain('name="category" value="2000"');
    expect(xml).toContain('name="category" value="5000"');
    expect(xml).toContain("S01E01");
  });
});
