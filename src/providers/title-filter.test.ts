import { describe, expect, it } from "vitest";
import { createSkipKeywordMatcher } from "./title-filter";

const isSkipped = createSkipKeywordMatcher(["Trailer", "Teaser", "Preview", "Clip", "Ausschnitt"]);

describe("createSkipKeywordMatcher", () => {
  it.each([
    "Clip: Soko Kitzbühel",
    "TRAILER: Soko Kitzbühel",
    "Soko Kitzbühel (Teaser)",
    "Soko Kitzbühel - Ausschnitt",
    "Preview zur neuen Staffel",
    "Die besten Clips der Woche",
    "Ausschnitte aus der Pressestunde",
    "Teasers & Trailers",
    "Kurzclip: Wetter",
    "Videoclip zum Song",
    "Kinotrailer: Der Bockerer",
    "Filmausschnitt aus Vorstadtweiber",
    "Making-of-Clip",
    "Clip_01",
  ])("skips %j", (title) => {
    expect(isSkipped(title)).toBe(true);
  });

  it.each([
    "Eclipse",
    "Total Eclipse of the Heart",
    "Clipper Race",
    "Trailerpark-Geschichten",
    "Previewer",
    "Teaserin",
    "Clipüberblick",
    "Soko Kitzbühel: Schöpfung",
  ])("keeps %j", (title) => {
    expect(isSkipped(title)).toBe(false);
  });

  it("escapes regex characters in keywords", () => {
    const matches = createSkipKeywordMatcher(["(klare Sprache)"]);
    expect(matches("Tagesschau (klare Sprache)")).toBe(true);
    expect(matches("Tagesschau klare Sprache")).toBe(false);
  });
});
