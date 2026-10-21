import { describe, expect, it, vi } from "vitest";
import type { ApiResultItem, TmdbMovieData } from "@/types";

vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

import { matchMovieItems } from "./movie-matcher";

const movie: TmdbMovieData = {
  tmdbId: 28,
  imdbId: "tt0000028",
  title: "Documentary",
  germanTitle: "Documentary",
  runtime: 45,
  releaseDate: "2026-07-12",
};

function makeItem(duration: number, id: string): ApiResultItem {
  return {
    channel: "ARD",
    topic: "Documentary",
    title: "Documentary",
    description: "",
    filmlisteTimestamp: 1_700_000_000,
    duration,
    size: 1_000_000,
    url_website: `https://example.com/${id}`,
    url_video: `https://example.com/${id}.mp4`,
    url_video_low: "",
    url_video_hd: "",
  };
}

function makeBroadcast(topic: string, title: string, minutes: number): ApiResultItem {
  return {
    ...makeItem(minutes * 60, `${topic}-${title}-${minutes}`),
    topic,
    title,
  };
}

function makeMovie(germanTitle: string, runtime: number | null, title = germanTitle) {
  return { ...movie, title, germanTitle, runtime };
}

async function matchedTitles(items: ApiResultItem[], movieData: TmdbMovieData) {
  const matches = await matchMovieItems(items, movieData, 0);
  return matches.map((match) => `${match.item.title} (${match.item.duration / 60} min)`);
}

describe("matchMovieItems – minimum duration", () => {
  it("compares durations in seconds at the configured boundary", async () => {
    const matches = await matchMovieItems(
      [makeItem(2699, "short"), makeItem(2700, "boundary")],
      movie,
      2700
    );

    expect(matches.map((match) => match.item.url_video)).toEqual([
      "https://example.com/boundary.mp4",
    ]);
  });

  it("does not filter by duration when the setting is zero", async () => {
    const matches = await matchMovieItems(
      [makeItem(120, "short")],
      makeMovie("Documentary", null),
      0
    );

    expect(matches).toHaveLength(1);
  });
});

describe("matchMovieItems – TMDB runtime", () => {
  const theGeneral = makeMovie("Der General", 79, "The General");

  it("rejects broadcasts whose duration clearly differs from the runtime", async () => {
    const titles = await matchedTitles(
      [
        makeBroadcast("Filme", "Der General", 45),
        makeBroadcast("Filme", "Der General", 58),
        makeBroadcast("Filme", "Der General", 59),
        makeBroadcast("Filme", "Der General", 99),
        makeBroadcast("Filme", "Der General", 100),
      ],
      theGeneral
    );

    // 25 % of 79 minutes is less than twice the default tolerance of 10 minutes
    expect(titles).toEqual(["Der General (59 min)", "Der General (99 min)"]);
  });

  it("allows TV versions that differ by up to a quarter of a long runtime", async () => {
    const titles = await matchedTitles(
      [
        makeBroadcast("Filme", "Metropolis", 111),
        makeBroadcast("Filme", "Metropolis", 110),
        makeBroadcast("Megacitys", "Metropolis", 43),
      ],
      makeMovie("Metropolis", 148)
    );

    expect(titles).toEqual(["Metropolis (111 min)"]);
  });

  it("keeps exact title matches when TMDB has no runtime", async () => {
    const titles = await matchedTitles(
      [makeBroadcast("Dokumentationen", "Das geheime Wesen der Katzen", 43)],
      makeMovie("Das geheime Wesen der Katzen", null)
    );

    expect(titles).toEqual(["Das geheime Wesen der Katzen (43 min)"]);
  });
});

describe("matchMovieItems – title", () => {
  const theGeneral = makeMovie("Der General", 79, "The General");

  it("does not accept the movie title as a substring of another title", async () => {
    const titles = await matchedTitles(
      [
        makeBroadcast("Filme in der ARD", "Die Diebin & der General", 88),
        makeBroadcast("phoenix parlament", "Olaf Scholz in der Generaldebatte", 80),
        makeBroadcast("Alle meine Töchter", "Der Generalflop (S03/E06)", 80),
        makeBroadcast("Story", "Soldat Nr. 1 – Der General und die Zeitenwende", 80),
      ],
      theGeneral
    );

    expect(titles).toEqual([]);
  });

  it("treats version notes like an exact title, even without a TMDB runtime", async () => {
    const items = [
      makeBroadcast("Filme im Ersten", "Der General - Audiodeskription", 70),
      makeBroadcast("Kino - Filme", "Der General (Originalversion mit Untertitel)", 70),
      makeBroadcast("Spielfilm", "Der General - Spielfilm, USA 1926", 70),
    ];

    const matches = await matchMovieItems(items, theGeneral, 0);
    expect(matches.map((match) => match.titleMatch)).toEqual(["exact", "exact", "exact"]);
    expect(await matchedTitles(items, makeMovie("Der General", null))).toHaveLength(3);
  });

  it("requires a runtime within the tolerance for other title parts", async () => {
    const items = [
      makeBroadcast("Kunst & Kultur", "Metropolis - Valencia", 44),
      makeBroadcast("Spielfilm", "Metropolis - Die restaurierte Fassung", 145),
      makeBroadcast("Spielfilm", "Metropolis - Die Kinofassung", 125),
    ];

    expect(await matchedTitles(items, makeMovie("Metropolis", 148))).toEqual([
      "Metropolis - Die restaurierte Fassung (145 min)",
    ]);
    expect(await matchedTitles(items, makeMovie("Metropolis", null))).toEqual([]);
  });

  it("treats a title part as weak even when the whole title is similar", async () => {
    // "Metropolis - XL" is about 77 % similar to "Metropolis"
    const items = [makeBroadcast("Spielfilm", "Metropolis - XL", 125)];

    expect(await matchedTitles(items, makeMovie("Metropolis", 148))).toEqual([]);
    expect(await matchedTitles(items, makeMovie("Metropolis", null))).toEqual([]);
  });

  it("does not accept a topic named like the movie with another title", async () => {
    const weniger = makeMovie("Weniger ist mehr", null);

    expect(
      await matchedTitles(
        [
          makeBroadcast("Weniger ist mehr", "Guggen spielen um die Ehre", 22),
          makeBroadcast("Weniger ist mehr", "Kurios", 22),
        ],
        weniger
      )
    ).toEqual([]);
    expect(
      await matchedTitles([makeBroadcast("Weniger ist mehr", "Audiodeskription", 86)], weniger)
    ).toEqual(["Audiodeskription (86 min)"]);
  });

  it("accepts production notes only when they describe a film", async () => {
    const titles = await matchedTitles(
      [
        makeBroadcast("Kunst & Kultur", "Metropolis - Valencia, Spanien 2024", 44),
        makeBroadcast("Spielfilm", "Metropolis - Spielfilm, Deutschland 1927", 145),
        makeBroadcast("Fernsehfilm", "Metropolis - Ein Stummfilmkrimi, Deutschland 1927", 145),
      ],
      makeMovie("Metropolis", null)
    );

    expect(titles).toEqual([
      "Metropolis - Spielfilm, Deutschland 1927 (145 min)",
      "Metropolis - Ein Stummfilmkrimi, Deutschland 1927 (145 min)",
    ]);
  });

  it("matches titles that contain separators or span topic and title", async () => {
    const mission = await matchedTitles(
      [makeBroadcast("Spielfilm", "Mission: Impossible (Audiodeskription)", 110)],
      makeMovie("Mission: Impossible", 110)
    );
    const klaraSonntag = await matchedTitles(
      [makeBroadcast("Klara Sonntag", "Liebe macht blind - Fernsehfilm, Deutschland 2022", 88)],
      makeMovie("Klara Sonntag - Liebe macht blind", 89)
    );

    expect(mission).toEqual(["Mission: Impossible (Audiodeskription) (110 min)"]);
    expect(klaraSonntag).toEqual(["Liebe macht blind - Fernsehfilm, Deutschland 2022 (88 min)"]);
  });

  it("prefers an exact original title over a German title part", async () => {
    // "Paris" is only a part of the title, "Paris - Je t'aime" is the whole title
    const matches = await matchMovieItems(
      [makeBroadcast("Kino", "Paris - Je t'aime", 120)],
      makeMovie("Paris", null, "Paris, je t'aime"),
      0
    );

    expect(matches.map((match) => match.titleMatch)).toEqual(["exact"]);
  });
});
