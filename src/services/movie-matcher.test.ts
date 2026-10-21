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
    const matches = await matchMovieItems([makeItem(120, "short")], movie, 0);

    expect(matches).toHaveLength(1);
  });
});

describe("matchMovieItems – partial title matches", () => {
  const metropolis: TmdbMovieData = {
    tmdbId: 19,
    imdbId: "tt0017136",
    title: "Metropolis",
    germanTitle: "Metropolis",
    runtime: 153,
    releaseDate: "1927-01-10",
  };

  function broadcast(title: string, minutes: number, id: string): ApiResultItem {
    return { ...makeItem(minutes * 60, id), topic: "Kunst & Kultur", title };
  }

  it("rejects partial matches whose runtime does not fit the movie", async () => {
    const matches = await matchMovieItems(
      [
        broadcast("Metropolis - Valencia", 44, "magazine"),
        broadcast('"Metropolis" - ein Meilenstein der Science-Fiction', 14, "report"),
      ],
      metropolis,
      300
    );

    expect(matches).toEqual([]);
  });

  it("keeps partial matches within twice the duration tolerance", async () => {
    const matches = await matchMovieItems(
      [
        broadcast("Metropolis (restaurierte Fassung)", 145, "film"),
        broadcast("Metropolis - Stummfilmklassiker", 133, "edge"),
        broadcast("Metropolis - Valencia", 132, "outside"),
      ],
      metropolis,
      300
    );

    expect(matches.map((match) => match.item.url_website)).toEqual([
      "https://example.com/film",
      "https://example.com/edge",
    ]);
    expect(matches.every((match) => match.titleMatch === "partial")).toBe(true);
  });

  it("keeps exact title matches regardless of runtime", async () => {
    const matches = await matchMovieItems([broadcast("Metropolis", 44, "exact")], metropolis, 300);

    expect(matches).toHaveLength(1);
    expect(matches[0].titleMatch).toBe("exact");
  });
});
