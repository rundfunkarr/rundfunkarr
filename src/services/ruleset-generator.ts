import { prisma } from "@/lib/db";
import { queryContent } from "./content-search";
import type { Ruleset, TvdbData, ApiResultItem } from "@/types";

// Common German show name patterns in MediathekView
const SEASON_EPISODE_PATTERNS = [
  /\(S(\d{1,4})\/E(\d{1,4})\)/, // (S01/E01) or (S1/E1)
  /\bS(\d{1,4})E(\d{1,4})\b/, // S01E01
  /Staffel\s*(\d+).*Folge\s*(\d+)/i, // Staffel 1 Folge 1
  /Staffel\s*(\d+).*Episode\s*(\d+)/i, // Staffel 1 Episode 1
];

const DATE_PATTERNS = [
  /vom\s+(\d{1,2}\.\s*\w+\s*\d{4})/, // vom 15. Januar 2024
  /vom\s+(\d{1,2}\.\d{1,2}\.\d{4})/, // vom 15.01.2024
  /\b(\d{1,2}\.\d{1,2}\.\d{4})\b/, // 15.01.2024 (standalone)
  /\b(\d{1,2}\.\s*\w+\s*\d{4})\b/, // 15. Januar 2024 (standalone)
];

const ABSOLUTE_EPISODE_PATTERNS = [
  /Episode\s*(\d+)/i, // Episode 123
  /(?<!\/)Folge\s*(\d+)/i, // Folge 123 (but not after / as in S01/E01 Folge)
  /Teil\s*(\d+)/i, // Teil 123
];

/**
 * Search MediathekView API directly (shared client - see its own doc
 * comment for why this used to be a separate, buggy reimplementation).
 */
async function searchMediathekApi(query: string): Promise<ApiResultItem[]> {
  return (
    (await queryContent([{ fields: ["topic"], query }], 50, {
      sortBy: "timestamp",
      future: false,
    })) ?? []
  );
}

/**
 * Find the best matching topic from MediathekView results
 */
function findBestMatchingTopic(results: ApiResultItem[], showInfo: TvdbData): string | null {
  if (results.length === 0) return null;

  // Get unique topics
  const topics = [...new Set(results.map((r) => r.topic))];

  // Try to match German name first, then English name
  const searchNames = [
    showInfo.germanName?.toLowerCase(),
    showInfo.name.toLowerCase(),
    ...showInfo.aliases.map((a) => a.name.toLowerCase()),
  ].filter(Boolean) as string[];

  // Exact match
  for (const topic of topics) {
    const topicLower = topic.toLowerCase();
    for (const name of searchNames) {
      if (topicLower === name) {
        console.log(`[RulesetGenerator] Exact topic match: "${topic}"`);
        return topic;
      }
    }
  }

  // Contains match
  for (const topic of topics) {
    const topicLower = topic.toLowerCase();
    for (const name of searchNames) {
      if (topicLower.includes(name) || name.includes(topicLower)) {
        console.log(`[RulesetGenerator] Partial topic match: "${topic}"`);
        return topic;
      }
    }
  }

  // If only one topic in results, use it
  if (topics.length === 1) {
    console.log(`[RulesetGenerator] Using single topic: "${topics[0]}"`);
    return topics[0];
  }

  console.log(`[RulesetGenerator] No matching topic found. Available: ${topics.join(", ")}`);
  return null;
}

interface StrategyAnalysis {
  seasonEpisodeCount: number;
  dateCount: number;
  absoluteEpisodeCount: number;
  topicPrefixCount: number;
  colonSeparatorCount: number;
}

/**
 * Analyze title patterns in results
 */
function analyzeResults(results: ApiResultItem[], topic: string): StrategyAnalysis {
  const analysis: StrategyAnalysis = {
    seasonEpisodeCount: 0,
    dateCount: 0,
    absoluteEpisodeCount: 0,
    topicPrefixCount: 0,
    colonSeparatorCount: 0,
  };

  const topicLower = topic.toLowerCase();

  for (const result of results.slice(0, 15)) {
    const title = result.title;
    const titleLower = title.toLowerCase();

    // Check for season/episode patterns
    for (const pattern of SEASON_EPISODE_PATTERNS) {
      if (pattern.test(title)) {
        analysis.seasonEpisodeCount++;
        break;
      }
    }

    // Check for date patterns
    for (const pattern of DATE_PATTERNS) {
      if (pattern.test(title)) {
        analysis.dateCount++;
        break;
      }
    }

    // Check for absolute episode patterns
    for (const pattern of ABSOLUTE_EPISODE_PATTERNS) {
      if (pattern.test(title)) {
        analysis.absoluteEpisodeCount++;
        break;
      }
    }

    // Check if title starts with topic name (e.g., "Weltspiegel extra: ...")
    if (titleLower.startsWith(topicLower)) {
      analysis.topicPrefixCount++;
    }

    // Check for colon separator pattern (e.g., "Topic: Episode Title")
    if (title.includes(":") || title.includes(" - ")) {
      analysis.colonSeparatorCount++;
    }
  }

  return analysis;
}

/**
 * Detect the best matching strategy based on sample results
 */
function detectMatchingStrategy(results: ApiResultItem[], topic: string): string {
  if (results.length === 0) return "ItemTitleIncludes";

  const analysis = analyzeResults(results, topic);
  const total = results.slice(0, 15).length;

  console.log(
    `[RulesetGenerator] Analysis: seasonEp=${analysis.seasonEpisodeCount}, date=${analysis.dateCount}, ` +
      `absEp=${analysis.absoluteEpisodeCount}, topicPrefix=${analysis.topicPrefixCount}, colon=${analysis.colonSeparatorCount}`
  );

  // Clear season/episode pattern wins
  if (analysis.seasonEpisodeCount >= 3 && analysis.seasonEpisodeCount > analysis.dateCount) {
    console.log(
      `[RulesetGenerator] Detected strategy: SeasonAndEpisodeNumber (${analysis.seasonEpisodeCount}/${total} matches)`
    );
    return "SeasonAndEpisodeNumber";
  }

  // Clear date pattern wins
  if (analysis.dateCount >= 3 && analysis.dateCount > analysis.seasonEpisodeCount) {
    console.log(
      `[RulesetGenerator] Detected strategy: ItemTitleEqualsAirdate (${analysis.dateCount}/${total} matches)`
    );
    return "ItemTitleEqualsAirdate";
  }

  // Absolute episode number pattern (daily shows like Sturm der Liebe)
  if (analysis.absoluteEpisodeCount >= 3) {
    console.log(
      `[RulesetGenerator] Detected strategy: ByAbsoluteEpisodeNumber (${analysis.absoluteEpisodeCount}/${total} matches)`
    );
    return "ByAbsoluteEpisodeNumber";
  }

  // Topic prefix with colon separator suggests extractable episode titles
  // Lower threshold - if at least 20% have topic prefix and 30% have colon separator
  if (analysis.topicPrefixCount >= 3 && analysis.colonSeparatorCount >= total * 0.3) {
    console.log(
      `[RulesetGenerator] Detected strategy: ItemTitleExact (topic prefix pattern, ${analysis.topicPrefixCount}/${total})`
    );
    return "ItemTitleExact";
  }

  // Default to ItemTitleIncludes - most flexible for matching
  console.log(`[RulesetGenerator] Detected strategy: ItemTitleIncludes (default fallback)`);
  return "ItemTitleIncludes";
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate regex patterns based on detected format
 */
export function generateRegexPatterns(
  results: ApiResultItem[],
  strategy: string,
  topic: string
): { episodeRegex: string; seasonRegex: string; titleRegexRules: string } {
  const escapedTopic = escapeRegex(topic);

  if (strategy === "SeasonAndEpisodeNumber") {
    // Check which pattern is used
    for (const result of results.slice(0, 5)) {
      // (S01/E01) pattern
      if (/\(S\d{1,4}\/E\d{1,4}\)/.test(result.title)) {
        return {
          episodeRegex: "(?<=E)(\\d{1,4})(?=\\))",
          seasonRegex: "(?<=S)(\\d{1,4})(?=/E)",
          titleRegexRules: "[]",
        };
      }
      // S01E01 pattern
      if (/\bS\d{1,4}E\d{1,4}\b/.test(result.title)) {
        return {
          episodeRegex: "(?<=E)(\\d{1,4})",
          seasonRegex: "(?<=S)(\\d{1,4})(?=E)",
          titleRegexRules: "[]",
        };
      }
      // Staffel X Folge Y pattern
      if (/Staffel\s*\d+.*Folge\s*\d+/i.test(result.title)) {
        return {
          episodeRegex: "Folge\\s*(\\d+)",
          seasonRegex: "Staffel\\s*(\\d+)",
          titleRegexRules: "[]",
        };
      }
    }
  }

  if (strategy === "ItemTitleEqualsAirdate") {
    // Try to detect date format
    for (const result of results.slice(0, 5)) {
      // "vom 15. Januar 2024" pattern
      if (/vom\s+\d{1,2}\.\s*\w+\s*\d{4}/.test(result.title)) {
        return {
          episodeRegex: "",
          seasonRegex: "",
          titleRegexRules: JSON.stringify([
            {
              type: "regex",
              field: "title",
              pattern: `vom\\s+(\\d{1,2}\\.\\s*\\w+\\s*\\d{4})`,
            },
          ]),
        };
      }
      // "vom 15.01.2024" pattern
      if (/vom\s+\d{1,2}\.\d{1,2}\.\d{4}/.test(result.title)) {
        return {
          episodeRegex: "",
          seasonRegex: "",
          titleRegexRules: JSON.stringify([
            {
              type: "regex",
              field: "title",
              pattern: `vom\\s+(\\d{1,2}\\.\\d{1,2}\\.\\d{4})`,
            },
          ]),
        };
      }
      // Standalone date "15.01.2024" pattern
      if (/\b\d{1,2}\.\d{1,2}\.\d{4}\b/.test(result.title)) {
        return {
          episodeRegex: "",
          seasonRegex: "",
          titleRegexRules: JSON.stringify([
            {
              type: "regex",
              field: "title",
              pattern: `(\\d{1,2}\\.\\d{1,2}\\.\\d{4})`,
            },
          ]),
        };
      }
    }
  }

  if (strategy === "ByAbsoluteEpisodeNumber") {
    // Check which absolute episode pattern is used
    for (const result of results.slice(0, 5)) {
      if (/Episode\s*\d+/i.test(result.title)) {
        return {
          episodeRegex: "Episode\\s*(\\d+)",
          seasonRegex: "",
          titleRegexRules: "[]",
        };
      }
      if (/Folge\s*\d+/i.test(result.title)) {
        return {
          episodeRegex: "Folge\\s*(\\d+)",
          seasonRegex: "",
          titleRegexRules: "[]",
        };
      }
      if (/Teil\s*\d+/i.test(result.title)) {
        return {
          episodeRegex: "Teil\\s*(\\d+)",
          seasonRegex: "",
          titleRegexRules: "[]",
        };
      }
    }
  }

  if (strategy === "ItemTitleExact") {
    // Generate title extraction regex for "Topic: Title" or "Topic - Title" patterns
    for (const result of results.slice(0, 5)) {
      // "Topic: Title" pattern
      if (result.title.includes(":")) {
        return {
          episodeRegex: "",
          seasonRegex: "",
          titleRegexRules: JSON.stringify([
            {
              type: "regex",
              field: "title",
              pattern: `^${escapedTopic}[^:]*:\\s*(.+)`,
              value: "",
            },
          ]),
        };
      }
      // "Topic - Title" pattern
      if (result.title.includes(" - ")) {
        return {
          episodeRegex: "",
          seasonRegex: "",
          titleRegexRules: JSON.stringify([
            {
              type: "regex",
              field: "title",
              pattern: `^${escapedTopic}[^-]*-\\s*(.+)`,
              value: "",
            },
          ]),
        };
      }
    }
  }

  // ItemTitleIncludes fallback. An empty titleRegexRules here makes
  // buildTitleFromRegexRules() always return "" (join of zero parts), which
  // matchesItemTitleIncludes() then treats as "no title, no match" for every
  // single item - so this strategy needs *some* extraction rule to ever
  // match anything. The ItemTitleExact branch above only generates one when
  // the title starts with the literal topic string, which real MediathekView
  // topics often don't (e.g. topic "Soko Kitzbühel Staffel 17" vs. title
  // "Soko Kitzbühel (8/15): Schöpfung" - the season suffix and episode
  // numbering break a literal prefix match even though the colon-separated
  // episode title is right there). Extract "everything after the last colon
  // or dash" instead, without anchoring on the topic text at all - simpler
  // and doesn't depend on the topic string appearing verbatim in the title.
  for (const result of results.slice(0, 5)) {
    if (result.title.includes(":")) {
      return {
        episodeRegex: "",
        seasonRegex: "",
        titleRegexRules: JSON.stringify([
          { type: "regex", field: "title", pattern: `:\\s*([^:]+)$`, value: "" },
        ]),
      };
    }
    if (result.title.includes(" - ")) {
      return {
        episodeRegex: "",
        seasonRegex: "",
        titleRegexRules: JSON.stringify([
          { type: "regex", field: "title", pattern: `-\\s*([^-]+)$`, value: "" },
        ]),
      };
    }
  }

  // No separator found either - fall back to matching the whole title
  // verbatim against each TMDB/TVDB episode name.
  return {
    episodeRegex: "",
    seasonRegex: "",
    titleRegexRules: JSON.stringify([
      { type: "regex", field: "title", pattern: `(.+)`, value: "" },
    ]),
  };
}

/**
 * Convert database model to Ruleset type
 */
function convertToRuleset(dbRuleset: {
  id: string;
  topic: string;
  tvdbId: number;
  showName: string;
  germanName: string | null;
  matchingStrategy: string;
  filters: string;
  episodeRegex: string;
  seasonRegex: string;
  titleRegexRules: string;
}): Ruleset {
  return {
    id: parseInt(dbRuleset.id.replace(/-/g, "").slice(0, 8), 16) || 99999,
    mediaId: dbRuleset.tvdbId,
    topic: dbRuleset.topic,
    priority: 0,
    filters: dbRuleset.filters,
    titleRegexRules: dbRuleset.titleRegexRules,
    episodeRegex: dbRuleset.episodeRegex || null,
    seasonRegex: dbRuleset.seasonRegex || null,
    matchingStrategy: dbRuleset.matchingStrategy as Ruleset["matchingStrategy"],
    media: {
      media_id: dbRuleset.tvdbId,
      media_name: dbRuleset.showName,
      media_type: "show",
      media_tvdbId: dbRuleset.tvdbId,
      media_tmdbId: null,
      media_imdbId: null,
    },
  };
}

/**
 * Generate a ruleset for a show if one doesn't exist
 */
export async function generateRulesetForShow(
  tvdbId: number,
  showInfo: TvdbData
): Promise<Ruleset | null> {
  console.log(
    `[RulesetGenerator] Attempting to generate ruleset for "${showInfo.germanName || showInfo.name}" (TVDB: ${tvdbId})`
  );

  // Check if we already have a generated ruleset for this TVDB ID
  const existingByTvdbId = await prisma.generatedRuleset.findFirst({
    where: { tvdbId },
  });

  if (existingByTvdbId) {
    console.log(
      `[RulesetGenerator] Found existing ruleset for TVDB ${tvdbId}: topic="${existingByTvdbId.topic}"`
    );
    return convertToRuleset(existingByTvdbId);
  }

  // Search MediathekView for the show
  const searchQuery = showInfo.germanName || showInfo.name;
  console.log(`[RulesetGenerator] Searching MediathekView for: "${searchQuery}"`);

  const results = await searchMediathekApi(searchQuery);
  console.log(`[RulesetGenerator] MediathekView returned ${results.length} results`);

  if (results.length === 0) {
    // Try English name if German search failed
    if (showInfo.germanName && showInfo.name !== showInfo.germanName) {
      console.log(`[RulesetGenerator] Trying English name: "${showInfo.name}"`);
      const englishResults = await searchMediathekApi(showInfo.name);
      if (englishResults.length > 0) {
        return generateRulesetFromResults(tvdbId, showInfo, englishResults);
      }
    }
    console.log("[RulesetGenerator] No results found in MediathekView");
    return null;
  }

  return generateRulesetFromResults(tvdbId, showInfo, results);
}

async function generateRulesetFromResults(
  tvdbId: number,
  showInfo: TvdbData,
  results: ApiResultItem[]
): Promise<Ruleset | null> {
  // Find the best matching topic
  const matchingTopic = findBestMatchingTopic(results, showInfo);
  if (!matchingTopic) {
    console.log("[RulesetGenerator] Could not find matching topic");
    return null;
  }

  // Check if ruleset for this topic already exists
  const existingByTopic = await prisma.generatedRuleset.findUnique({
    where: { topic: matchingTopic },
  });

  if (existingByTopic) {
    // Update TVDB ID if different
    if (existingByTopic.tvdbId !== tvdbId) {
      console.log(
        `[RulesetGenerator] Topic "${matchingTopic}" exists with different TVDB ID (${existingByTopic.tvdbId} vs ${tvdbId})`
      );
    }
    return convertToRuleset(existingByTopic);
  }

  // Detect matching strategy
  const topicResults = results.filter((r) => r.topic === matchingTopic);
  const strategy = detectMatchingStrategy(topicResults, matchingTopic);
  const patterns = generateRegexPatterns(topicResults, strategy, matchingTopic);

  // Create new ruleset
  console.log(
    `[RulesetGenerator] Creating new ruleset: topic="${matchingTopic}", strategy="${strategy}"`
  );

  const newRuleset = await prisma.generatedRuleset.create({
    data: {
      topic: matchingTopic,
      tvdbId,
      showName: showInfo.name,
      germanName: showInfo.germanName,
      matchingStrategy: strategy,
      filters: '[{"attribute":"duration","type":"GreaterThan","value":"15"}]',
      episodeRegex: patterns.episodeRegex,
      seasonRegex: patterns.seasonRegex,
      titleRegexRules: patterns.titleRegexRules,
    },
  });

  console.log(`[RulesetGenerator] Created ruleset with ID: ${newRuleset.id}`);
  return convertToRuleset(newRuleset);
}

/**
 * Get all generated rulesets from the database
 */
export async function getGeneratedRulesets(): Promise<Ruleset[]> {
  const dbRulesets = await prisma.generatedRuleset.findMany();
  return dbRulesets.map(convertToRuleset);
}

/**
 * Get generated ruleset for a specific topic
 */
export async function getGeneratedRulesetByTopic(topic: string): Promise<Ruleset | null> {
  const dbRuleset = await prisma.generatedRuleset.findUnique({
    where: { topic },
  });
  return dbRuleset ? convertToRuleset(dbRuleset) : null;
}

/**
 * Get generated ruleset for a specific TVDB ID
 */
export async function getGeneratedRulesetByTvdbId(tvdbId: number): Promise<Ruleset | null> {
  const dbRuleset = await prisma.generatedRuleset.findFirst({
    where: { tvdbId },
  });
  return dbRuleset ? convertToRuleset(dbRuleset) : null;
}
