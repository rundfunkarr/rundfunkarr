/**
 * Builds a case-insensitive matcher for skip keywords (trailers, clips, …)
 * in provider titles.
 *
 * A plain substring check also hits unrelated words ("Eclipse" contains
 * "clip"), so a keyword only counts when it is:
 * - a whole word, e.g. "Clip: Tatort" or "Tatort (Trailer)",
 * - optionally followed by a plural/inflection ending (-s, -e, -n, -en,
 *   -es), e.g. "Clips", "Ausschnitte",
 * - or the last part of a German compound, e.g. "Kurzclip", "Kinotrailer",
 *   "Filmausschnitt". In German compounds the last part is the head noun
 *   and decides what the whole word is, so these are still clips/trailers.
 *
 * A keyword at the start or in the middle of a longer word is not a match
 * ("Clipper", "Trailerpark", "Eclipse"); there the keyword is only a
 * modifier or plain letters. Letters are matched with Unicode classes, so
 * umlauts and ß count as part of a word ("Clipüber" is one word).
 */
export function createSkipKeywordMatcher(keywords: readonly string[]): (title: string) => boolean {
  const escaped = keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?:${escaped.join("|")})(?:s|e|n|en|es)?(?![\\p{L}\\p{N}])`, "iu");
  return (title) => pattern.test(title);
}
