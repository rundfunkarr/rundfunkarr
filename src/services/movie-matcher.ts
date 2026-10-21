import { isStreamingUrl } from "@/lib/stream-url";
import type { ApiResultItem, TmdbMovieData } from "@/types";
import { getSetting } from "@/lib/settings";

async function isHlsEnabled(): Promise<boolean> {
  const setting = await getSetting("download.enableHLS");
  return setting === "true";
}

// Default duration tolerance in minutes
const DEFAULT_DURATION_TOLERANCE = 10;

/**
 * Get the duration tolerance setting
 */
async function getDurationTolerance(): Promise<number> {
  const setting = await getSetting("matching.movie.durationTolerance");
  if (setting) {
    const parsed = parseInt(setting, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_DURATION_TOLERANCE;
}

/**
 * Normalize a title for comparison
 * - Lowercase
 * - Remove special characters
 * - Normalize spaces
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[/:;,"'@#?$%^*+=!|<>()&""'']/g, "")
    .replace(/[-–—]/g, " ") // Normalize different dash types
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate string similarity (0-1)
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
}

// Separators between parts of a Mediathek title, e.g. "Der General (Audiodeskription)"
// or "Metropolis - Valencia". Hyphens inside words ("Science-Fiction") do not split.
const TITLE_PART_SEPARATOR = /\s+[-–—|/·]\s+|:\s+|[()[\]]/;

// Notes that broadcasters add to a film title without changing the film. Includes the
// audio labels known to audioVariant() in src/lib/media-metadata.ts.
const VERSION_NOTES = new Set([
  "audiodeskription",
  "mit audiodeskription",
  "hörfassung",
  "untertitel",
  "mit untertitel",
  "originalversion",
  "originalversion mit untertitel",
  "originalfassung",
  "originalfassung mit untertitel",
  "originalton",
  "omu",
  "ov",
  "ad",
  "gebärdensprache",
  "mit gebärdensprache",
  "englisch",
  "französisch",
]);
// Production notes such as "Spielfilm, Deutschland 2004", "Spielfilm, USA 1979/2019" or
// "Romantische Komödie, Deutschland 2022". The first phrase has to name a kind of film,
// optionally after up to two words ("Ein Nordseekrimi", "Historisches Drama").
const PRODUCTION_NOTE =
  /^(?:[\p{L}-]+ ){0,2}[\p{L}-]*(?:film|komödie|drama|thriller|krimi), [^,]+ (?:19|20)\d{2}(?:\/(?:19|20)\d{2})?$/iu;

function isVersionNote(part: string): boolean {
  return VERSION_NOTES.has(normalizeTitle(part)) || PRODUCTION_NOTE.test(part);
}

/**
 * Look for the movie title as one or more whole parts of a Mediathek title.
 * - "version": the other parts only describe the version, e.g. "Der General (Audiodeskription)"
 * - "part": other content remains, e.g. ARTE's magazine "Metropolis - Valencia"
 * - null: the title is no whole part, e.g. "Die Diebin & der General" or "in der Generaldebatte"
 */
function findTitleInParts(text: string, normalizedMovieTitle: string): "version" | "part" | null {
  if (!normalizedMovieTitle) return null;

  const rawParts = text
    .split(TITLE_PART_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => normalizeTitle(part));
  const parts = rawParts.map(normalizeTitle);
  let found: "part" | null = null;

  for (let start = 0; start < parts.length; start++) {
    // Join neighbouring parts so titles with separators ("Mission: Impossible") still match
    let joined = "";
    for (let end = start; end < parts.length; end++) {
      joined = joined ? `${joined} ${parts[end]}` : parts[end];
      if (joined === normalizedMovieTitle) {
        const otherParts = [...rawParts.slice(0, start), ...rawParts.slice(end + 1)];
        if (otherParts.every(isVersionNote)) return "version";
        found = "part";
      }
      if (joined.length >= normalizedMovieTitle.length) break;
    }
  }
  return found;
}

type TitleMatch = "exact" | "fuzzy" | "partial";

interface TitleScores {
  exact: number;
  fuzzy: number;
  partial: number;
}

// Matches on the original title score slightly lower than on the German title
const GERMAN_TITLE_SCORES: TitleScores = { exact: 100, fuzzy: 100, partial: 60 };
const ORIGINAL_TITLE_SCORES: TitleScores = { exact: 95, fuzzy: 90, partial: 55 };

function matchTitle(
  item: ApiResultItem,
  normalizedMovieTitle: string,
  scores: TitleScores
): { titleMatch: TitleMatch; titleScore: number } | null {
  const normalizedTitle = normalizeTitle(item.title);
  const combinedTitle = normalizeTitle(`${item.topic} ${item.title}`);

  // The topic alone is often the name of a series or magazine ("Weniger ist mehr" with
  // "Guggen spielen um die Ehre"), so it only counts together with the title.
  if (normalizedTitle === normalizedMovieTitle || combinedTitle === normalizedMovieTitle) {
    return { titleMatch: "exact", titleScore: scores.exact };
  }

  // The movie title may also span topic and title ("Klara Sonntag" + "Liebe macht blind")
  const partMatches = [item.title, `${item.topic} - ${item.title}`].map((text) =>
    findTitleInParts(text, normalizedMovieTitle)
  );
  if (partMatches.includes("version")) {
    // Rank the plain version above audio description and similar versions
    return { titleMatch: "exact", titleScore: scores.exact * 0.95 };
  }
  // Other content next to the movie title ("Metropolis - XL") stays a weak match,
  // even when the whole string is similar to the movie title
  if (partMatches.includes("part")) {
    return { titleMatch: "partial", titleScore: scores.partial };
  }

  const bestSimilarity = Math.max(
    stringSimilarity(normalizedTitle, normalizedMovieTitle),
    stringSimilarity(combinedTitle, normalizedMovieTitle)
  );
  if (bestSimilarity >= 0.9) {
    return { titleMatch: "exact", titleScore: bestSimilarity * scores.exact };
  }
  if (bestSimilarity >= 0.7) {
    return { titleMatch: "fuzzy", titleScore: bestSimilarity * scores.fuzzy };
  }

  // A plain substring like "in der Generaldebatte" is not enough
  return null;
}

/**
 * Largest runtime difference in minutes that still counts as the same movie.
 * TV versions often differ from the TMDB runtime by 10–15 %, so 25 % are
 * allowed, but at least twice the configured tolerance for short films.
 */
function getMaxRuntimeDifference(runtimeMinutes: number, durationTolerance: number): number {
  return Math.max(durationTolerance * 2, runtimeMinutes * 0.25);
}

export interface MovieMatchResult {
  item: ApiResultItem;
  score: number; // 0-100, higher is better
  titleMatch: TitleMatch;
  durationDiff: number; // Difference in minutes
}

/**
 * Match mediathek items to a movie
 * Returns items sorted by match score (best first)
 */
export async function matchMovieItems(
  items: ApiResultItem[],
  movieData: TmdbMovieData,
  minDurationSeconds: number
): Promise<MovieMatchResult[]> {
  const durationTolerance = await getDurationTolerance();
  const hlsEnabled = await isHlsEnabled();
  const results: MovieMatchResult[] = [];

  const normalizedGermanTitle = normalizeTitle(movieData.germanTitle);
  const normalizedOriginalTitle = normalizeTitle(movieData.title);
  const movieRuntimeMinutes = movieData.runtime || 0;
  const runtimeKnown = movieRuntimeMinutes > 0;
  const maxRuntimeDifference = getMaxRuntimeDifference(movieRuntimeMinutes, durationTolerance);
  let rejectedByRuntime = 0;

  console.log(
    `[MovieMatcher] Matching ${items.length} items against "${movieData.germanTitle}" (original: "${movieData.title}"), runtime: ${movieRuntimeMinutes} min, hlsEnabled: ${hlsEnabled}`
  );

  for (const item of items) {
    // Skip m3u8 streams unless HLS is enabled
    if (
      !hlsEnabled &&
      ![item.url_video, item.url_video_low, item.url_video_hd].some(
        (url) => url && !isStreamingUrl(url)
      )
    )
      continue;

    // Item duration in minutes. A duration of 0 means unknown (e.g. local Filmliste).
    const itemDurationMinutes = Math.floor(item.duration / 60);
    const durationDiff = Math.abs(movieRuntimeMinutes - itemDurationMinutes);
    const runtimeComparable = runtimeKnown && item.duration > 0;

    if (minDurationSeconds > 0 && item.duration < minDurationSeconds) continue;

    // Prefer the German title, but let the original title replace a weak title part
    let match = matchTitle(item, normalizedGermanTitle, GERMAN_TITLE_SCORES);
    if (
      (!match || match.titleMatch === "partial") &&
      normalizedOriginalTitle !== normalizedGermanTitle
    ) {
      const originalMatch = matchTitle(item, normalizedOriginalTitle, ORIGINAL_TITLE_SCORES);
      if (originalMatch && (!match || originalMatch.titleMatch !== "partial")) {
        match = originalMatch;
      }
    }

    if (!match) continue;
    const { titleMatch, titleScore } = match;

    // With known durations, a clearly different duration means a different broadcast
    if (runtimeComparable && durationDiff > maxRuntimeDifference) {
      rejectedByRuntime++;
      continue;
    }

    // A title part alone is weak evidence (e.g. ARTE's magazine "Metropolis - Valencia"),
    // so it only counts together with a runtime within the tolerance.
    if (titleMatch === "partial" && (!runtimeComparable || durationDiff > durationTolerance)) {
      rejectedByRuntime++;
      continue;
    }

    // Calculate duration score (0-20 points)
    let durationScore = 0;
    if (runtimeComparable) {
      if (durationDiff <= durationTolerance) {
        // Within tolerance: full points
        durationScore = 20;
      } else if (durationDiff <= durationTolerance * 2) {
        // Slightly outside tolerance: partial points
        durationScore = 10;
      }
      // Outside 2x tolerance: 0 points
    } else {
      // Runtime or broadcast duration unknown: give benefit of the doubt
      durationScore = 10;
    }

    // Total score (weighted)
    const totalScore = titleScore * 0.8 + durationScore;

    results.push({
      item,
      score: totalScore,
      titleMatch,
      durationDiff,
    });
  }

  // Sort by score (highest first)
  results.sort((a, b) => b.score - a.score);

  if (rejectedByRuntime > 0) {
    console.log(
      `[MovieMatcher] Rejected ${rejectedByRuntime} title matches whose duration does not confirm the TMDB runtime`
    );
  }
  console.log(`[MovieMatcher] Found ${results.length} matches`);
  if (results.length > 0) {
    const best = results[0];
    console.log(
      `[MovieMatcher] Best match: "${best.item.topic}" - "${best.item.title}" (score: ${best.score.toFixed(1)}, duration diff: ${best.durationDiff} min)`
    );
  }

  return results;
}
