import { mediathekCache } from "@/lib/cache";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { getSetting } from "@/lib/settings";
import { getShowInfoByTvdbId } from "./shows";
import {
  ensureRulesetsLoaded,
  getRulesetsForTopic,
  getRulesetsForTopicAndTvdbId,
  getAllTopics,
  getOrGenerateRulesetForShow,
} from "./rulesets";
import {
  generateRssItems,
  generateMovieRssItems,
  generateGenericRssItems,
  convertItemsToRss,
  serializeRss,
  getEmptyRssResult,
  QualityPreference,
} from "./newznab";
import { matchMovieItems } from "./movie-matcher";
import { searchMovieByTitle } from "./tmdb";
import type {
  ApiResultItem,
  MediathekApiResponse,
  TvdbData,
  TvdbEpisode,
  TmdbMovieData,
  Ruleset,
  MatchedEpisodeInfo,
  NewznabItem,
  Filter,
  TitleRegexRule,
  MatchType,
  TitleRegexRuleType,
  MatchingStrategy,
} from "@/types";
import {
  findEpisodeByAirDate,
  findEpisodesByAirYear,
  findEpisodesBySeason,
  findEpisodeBySeasonAndNumber,
} from "@/types";

const MEDIATHEK_API_URL = "https://mediathekviewweb.de/api/query";
const QUERY_FIELDS = ["topic", "title"];
const VALID_QUALITIES: QualityPreference[] = ["all", "best", "1080p", "720p", "480p"];

async function isHlsEnabled(): Promise<boolean> {
  const setting = await getSetting("download.enableHLS");
  return setting === "true";
}

async function getQualityPreference(): Promise<QualityPreference> {
  const setting = await getSetting("download.quality");
  if (setting && VALID_QUALITIES.includes(setting as QualityPreference)) {
    return setting as QualityPreference;
  }
  return "all"; // Default to all qualities
}

async function getMinDuration(): Promise<number> {
  const setting = await getSetting("matching.minDuration");
  if (setting) {
    const parsed = parseInt(setting, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 300; // Default: 5 minutes
}

// Keywords that are always skipped (trailers, outtakes, etc.)
const SKIP_KEYWORDS = ["Trailer", "Outtakes:", "(klare Sprache)"];

async function fetchMediathekViewApiResponse(
  queries: Array<{ fields: string[]; query: string }>,
  size: number
): Promise<string> {
  const requestBody = {
    queries,
    sortBy: "filmlisteTimestamp",
    sortOrder: "desc",
    future: true,
    offset: 0,
    size,
  };

  try {
    const response = await fetchWithRetry(MEDIATHEK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      return await response.text();
    }
    console.error(`[Mediathek] API request failed with status ${response.status}`);
  } catch (error) {
    console.error("[Mediathek] Error fetching from API:", error);
  }

  return "";
}

function shouldSkipItem(
  item: ApiResultItem,
  minDuration: number,
  hlsEnabled: boolean = false
): boolean {
  // Skip m3u8 streams unless HLS is enabled, items with skip keywords, and items shorter than minDuration
  if (!hlsEnabled && item.url_video.endsWith(".m3u8")) return true;
  if (SKIP_KEYWORDS.some((kw) => item.title.includes(kw))) return true;
  if (minDuration > 0 && item.duration < minDuration) return true;
  return false;
}

function getFieldValue(item: ApiResultItem, fieldName: string): string {
  switch (fieldName) {
    case "channel":
      return item.channel;
    case "topic":
      return item.topic;
    case "title":
      return item.title;
    case "description":
      return item.description;
    case "timestamp":
      return item.filmlisteTimestamp.toString();
    case "duration":
      return item.duration.toString();
    case "size":
      return item.size.toString();
    case "url_website":
      return item.url_website;
    case "url_video":
      return item.url_video;
    case "url_video_low":
      return item.url_video_low;
    case "url_video_hd":
      return item.url_video_hd;
    default:
      return "";
  }
}

function filterMatches(item: ApiResultItem, filter: Filter): boolean {
  const attributeValue = getFieldValue(item, filter.attribute);
  const filterValue = String(filter.value);

  switch (filter.type) {
    case "ExactMatch" as MatchType:
      return attributeValue.toLowerCase() === filterValue.toLowerCase();
    case "Contains" as MatchType:
      return attributeValue.toLowerCase().includes(filterValue.toLowerCase());
    case "Regex" as MatchType:
      try {
        return new RegExp(filterValue).test(attributeValue);
      } catch {
        return false;
      }
    case "GreaterThan" as MatchType: {
      const attrNum = parseFloat(attributeValue);
      const filterNum = parseFloat(filterValue);
      return !isNaN(attrNum) && !isNaN(filterNum) && attrNum > filterNum * 60;
    }
    case "LessThan" as MatchType: {
      const attrNum = parseFloat(attributeValue);
      const filterNum = parseFloat(filterValue);
      return !isNaN(attrNum) && !isNaN(filterNum) && attrNum < filterNum * 60;
    }
    default:
      return false;
  }
}

function extractValueUsingRegex(item: ApiResultItem, pattern: string | null): string | null {
  if (!pattern) return null;

  const fieldValue = getFieldValue(item, "title");
  if (!fieldValue) return null;

  try {
    const match = fieldValue.match(pattern);
    return match && match.length > 1 ? match[1] : null;
  } catch {
    return null;
  }
}

function buildTitleFromRegexRules(item: ApiResultItem, rulesJson: string): string | null {
  let rules: TitleRegexRule[];
  try {
    rules = JSON.parse(rulesJson);
  } catch {
    return null;
  }

  const parts: string[] = [];

  for (const rule of rules) {
    if (rule.type === ("static" as TitleRegexRuleType)) {
      if (rule.value) {
        parts.push(rule.value);
      }
    } else if (rule.type === ("regex" as TitleRegexRuleType)) {
      if (rule.pattern && rule.field) {
        const fieldValue = getFieldValue(item, rule.field);
        if (fieldValue) {
          try {
            const match = fieldValue.match(rule.pattern);
            if (match && match.length > 0) {
              // Use the last group
              parts.push(match[match.length - 1]);
            } else {
              return null; // Abort if regex match failed
            }
          } catch {
            return null;
          }
        }
      }
    }
  }

  return parts.join("");
}

function formatTitle(title: string): string {
  let formatted = title
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue");

  formatted = formatted.replace(/&/g, "and");
  formatted = formatted.replace(/[/:;,""''@#?$%^*+=!|<>,()]/g, "");
  formatted = formatted.replace(/\s+/g, ".").replace(/\.\./g, ".");

  return formatted;
}

// String similarity using Levenshtein distance
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

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
}

type MatchingStrategyPreference = "fuzzy" | "strict";

async function getMatchingSettings(): Promise<{
  strategy: MatchingStrategyPreference;
  threshold: number;
}> {
  const [strategySetting, thresholdSetting] = await Promise.all([
    getSetting("matching.strategy"),
    getSetting("matching.threshold"),
  ]);

  const strategy: MatchingStrategyPreference = strategySetting === "strict" ? "strict" : "fuzzy";

  let threshold = 0.7;
  if (thresholdSetting) {
    // Handle both "0.7" and "0,7" formats
    const parsed = parseFloat(thresholdSetting.replace(",", "."));
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      threshold = parsed;
    }
  }

  return { strategy, threshold };
}

function tryParseDate(dateString: string): Date | null {
  // Supported German date formats:
  // - "d. MMMM yyyy" (e.g., "7. Juni 2024")
  // - "dd.MM.yyyy" (e.g., "31.12.2017")
  // - "yyyy-MM-dd" (e.g., "2017-12-01")
  // - "yyyyMMdd" (e.g., "20171201")

  const germanMonths: Record<string, number> = {
    januar: 0,
    februar: 1,
    märz: 2,
    april: 3,
    mai: 4,
    juni: 5,
    juli: 6,
    august: 7,
    september: 8,
    oktober: 9,
    november: 10,
    dezember: 11,
  };

  // Try "d. MMMM yyyy" format
  const match1 = dateString.match(/^(\d{1,2})\. (\w+) (\d{4})$/);
  if (match1) {
    const day = parseInt(match1[1]);
    const month = germanMonths[match1[2].toLowerCase()];
    const year = parseInt(match1[3]);
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }

  // Try "dd.MM.yyyy" format
  const match2 = dateString.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match2) {
    return new Date(parseInt(match2[3]), parseInt(match2[2]) - 1, parseInt(match2[1]));
  }

  // Try "yyyy-MM-dd" format
  const match3 = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match3) {
    return new Date(parseInt(match3[1]), parseInt(match3[2]) - 1, parseInt(match3[3]));
  }

  // Try "yyyyMMdd" format
  const match4 = dateString.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match4) {
    return new Date(parseInt(match4[1]), parseInt(match4[2]) - 1, parseInt(match4[3]));
  }

  return null;
}

async function matchesSeasonAndEpisode(
  item: ApiResultItem,
  ruleset: Ruleset
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getShowInfoByTvdbId(ruleset.media.media_tvdbId);
  if (!tvdbData?.episodes?.length) return null;

  const season = extractValueUsingRegex(item, ruleset.seasonRegex);
  const episode = extractValueUsingRegex(item, ruleset.episodeRegex);

  if (!season || !episode) return null;

  const seasonNum = parseInt(season);
  const episodeNum = parseInt(episode);
  if (isNaN(seasonNum) || isNaN(episodeNum)) return null;

  const matchedEpisode = findEpisodeBySeasonAndNumber(tvdbData, seasonNum, episodeNum);
  if (!matchedEpisode) return null;

  return {
    episode: matchedEpisode,
    item,
    showName: tvdbData.name || tvdbData.germanName || "",
    matchedTitle: `S${season}E${episode}`,
    tvdbId: ruleset.media.media_tvdbId,
  };
}

async function matchesItemTitleIncludes(
  item: ApiResultItem,
  ruleset: Ruleset,
  threshold: number = 0.7
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getShowInfoByTvdbId(ruleset.media.media_tvdbId);
  if (!tvdbData?.episodes?.length) return null;

  const constructedTitle = buildTitleFromRegexRules(item, ruleset.titleRegexRules);
  if (!constructedTitle) return null;

  const formattedConstructed = formatTitle(constructedTitle).toLowerCase();

  // First try exact contains match
  let matchedEpisode = tvdbData.episodes.find((ep) =>
    formatTitle(ep.name).toLowerCase().includes(formattedConstructed)
  );

  // If no exact match, try fuzzy matching with threshold
  if (!matchedEpisode && threshold < 1.0) {
    let bestSimilarity = 0;
    for (const ep of tvdbData.episodes) {
      const similarity = stringSimilarity(formatTitle(ep.name), formattedConstructed);
      if (similarity >= threshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        matchedEpisode = ep;
      }
    }
  }

  if (!matchedEpisode) return null;

  return {
    episode: matchedEpisode,
    item,
    showName: tvdbData.name || tvdbData.germanName || "",
    matchedTitle: constructedTitle,
    tvdbId: ruleset.media.media_tvdbId,
  };
}

async function matchesItemTitleExact(
  item: ApiResultItem,
  ruleset: Ruleset,
  threshold: number = 0.95
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getShowInfoByTvdbId(ruleset.media.media_tvdbId);
  if (!tvdbData?.episodes?.length) return null;

  const constructedTitle = buildTitleFromRegexRules(item, ruleset.titleRegexRules);
  if (!constructedTitle) return null;

  const formattedTitle = formatTitle(constructedTitle).toLowerCase();

  // First try exact match
  let matchedEpisodes = tvdbData.episodes.filter(
    (ep) => formatTitle(ep.name).toLowerCase() === formattedTitle
  );

  // If no exact match and threshold allows, try very high similarity matching
  if (matchedEpisodes.length === 0 && threshold < 1.0) {
    const highThreshold = Math.max(threshold, 0.9); // At least 90% for "exact" matching
    matchedEpisodes = tvdbData.episodes.filter((ep) => {
      const similarity = stringSimilarity(formatTitle(ep.name).toLowerCase(), formattedTitle);
      return similarity >= highThreshold;
    });
  }

  let matchedEpisode: TvdbEpisode | undefined;
  if (matchedEpisodes.length === 1) {
    matchedEpisode = matchedEpisodes[0];
  } else if (matchedEpisodes.length > 1) {
    // Try to match by aired date
    const itemDate = new Date(item.filmlisteTimestamp * 1000);
    matchedEpisode = matchedEpisodes.find((ep) => {
      if (!ep.aired) return false;
      const epDate = new Date(ep.aired);
      return epDate.toDateString() === itemDate.toDateString();
    });
    // Fallback to newest
    if (!matchedEpisode) {
      matchedEpisode = matchedEpisodes.sort((a, b) => {
        const aDate = a.aired ? new Date(a.aired).getTime() : 0;
        const bDate = b.aired ? new Date(b.aired).getTime() : 0;
        return bDate - aDate;
      })[0];
    }
  }

  if (!matchedEpisode) return null;

  return {
    episode: matchedEpisode,
    item,
    showName: tvdbData.name || tvdbData.germanName || "",
    matchedTitle: constructedTitle,
    tvdbId: ruleset.media.media_tvdbId,
  };
}

async function matchesItemTitleEqualsAirdate(
  item: ApiResultItem,
  ruleset: Ruleset
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getShowInfoByTvdbId(ruleset.media.media_tvdbId);
  if (!tvdbData?.episodes?.length) return null;

  const constructedTitle = buildTitleFromRegexRules(item, ruleset.titleRegexRules);
  if (!constructedTitle) return null;

  const parsedDate = tryParseDate(constructedTitle);
  if (!parsedDate) return null;

  const matchedEpisode = findEpisodeByAirDate(tvdbData, parsedDate);
  if (!matchedEpisode) return null;

  return {
    episode: matchedEpisode,
    item,
    showName: tvdbData.name || tvdbData.germanName || "",
    matchedTitle: constructedTitle,
    tvdbId: ruleset.media.media_tvdbId,
  };
}

async function applyRulesetFilters(
  results: ApiResultItem[],
  tvdbData?: TvdbData
): Promise<{ matchedEpisodes: MatchedEpisodeInfo[]; unmatchedItems: ApiResultItem[] }> {
  await ensureRulesetsLoaded();
  const minDuration = await getMinDuration();
  const matchingSettings = await getMatchingSettings();
  const hlsEnabled = await isHlsEnabled();
  console.log(
    `[Mediathek] Matching settings: strategy=${matchingSettings.strategy}, threshold=${matchingSettings.threshold}, minDuration=${minDuration}s, hlsEnabled=${hlsEnabled}`
  );

  const matchedEpisodes: MatchedEpisodeInfo[] = [];
  const unmatchedItems: ApiResultItem[] = [...results];

  // Log available rulesets for debugging
  if (tvdbData) {
    const allTopics = getAllTopics();
    console.log(`[Mediathek] Rulesets available: ${allTopics.length} topics`);

    // Check if any ruleset exists for this TVDB ID
    let foundRulesetForTvdbId = false;
    for (const topic of allTopics) {
      const rulesets = getRulesetsForTopicAndTvdbId(topic, tvdbData.id);
      if (rulesets.length > 0) {
        console.log(
          `[Mediathek] Found ${rulesets.length} ruleset(s) for topic "${topic}" with tvdbId ${tvdbData.id}`
        );
        foundRulesetForTvdbId = true;
      }
    }
    if (!foundRulesetForTvdbId) {
      console.log(
        `[Mediathek] No rulesets found for tvdbId ${tvdbData.id} (${tvdbData.name}), attempting auto-generation...`
      );

      // Try to auto-generate a ruleset
      const generatedRuleset = await getOrGenerateRulesetForShow(tvdbData.id, tvdbData);
      if (generatedRuleset) {
        console.log(
          `[Mediathek] Auto-generated ruleset for topic "${generatedRuleset.topic}" -> TVDB ${tvdbData.id}`
        );
        foundRulesetForTvdbId = true;
      } else {
        console.log(`[Mediathek] Could not auto-generate ruleset for ${tvdbData.name}`);
      }
    }
  }

  let checkedCount = 0;
  for (const item of results) {
    if (shouldSkipItem(item, minDuration, hlsEnabled)) {
      const idx = unmatchedItems.indexOf(item);
      if (idx > -1) unmatchedItems.splice(idx, 1);
      continue;
    }

    const rulesets = tvdbData
      ? getRulesetsForTopicAndTvdbId(item.topic, tvdbData.id)
      : getRulesetsForTopic(item.topic);

    // Log first few items to show what's being checked
    if (checkedCount < 5) {
      console.log(
        `[Mediathek] Checking item: topic="${item.topic}", title="${item.title}", rulesets found: ${rulesets.length}`
      );
      checkedCount++;
    }

    for (const ruleset of rulesets) {
      // Parse filters from JSON string
      let filters: Filter[];
      try {
        filters = JSON.parse(ruleset.filters);
      } catch {
        filters = [];
      }

      if (!filters.every((filter) => filterMatches(item, filter))) {
        const idx = unmatchedItems.indexOf(item);
        if (idx > -1) unmatchedItems.splice(idx, 1);
        continue;
      }

      let matchInfo: MatchedEpisodeInfo | null = null;

      // Apply matching with threshold from settings
      const threshold = matchingSettings.threshold;

      switch (ruleset.matchingStrategy) {
        case "SeasonAndEpisodeNumber" as MatchingStrategy:
          matchInfo = await matchesSeasonAndEpisode(item, ruleset);
          break;
        case "ItemTitleIncludes" as MatchingStrategy:
          matchInfo = await matchesItemTitleIncludes(item, ruleset, threshold);
          break;
        case "ItemTitleExact" as MatchingStrategy:
          // For strict strategy, require higher threshold
          const exactThreshold =
            matchingSettings.strategy === "strict" ? Math.max(threshold, 0.95) : threshold;
          matchInfo = await matchesItemTitleExact(item, ruleset, exactThreshold);
          break;
        case "ItemTitleEqualsAirdate" as MatchingStrategy:
          matchInfo = await matchesItemTitleEqualsAirdate(item, ruleset);
          break;
      }

      if (matchInfo) {
        matchedEpisodes.push(matchInfo);
        const idx = unmatchedItems.indexOf(item);
        if (idx > -1) unmatchedItems.splice(idx, 1);
        break;
      } else {
        const idx = unmatchedItems.indexOf(item);
        if (idx > -1) unmatchedItems.splice(idx, 1);
      }
    }
  }

  return { matchedEpisodes, unmatchedItems };
}

function getDesiredEpisodes(
  tvdbData: TvdbData,
  season: string | null,
  episodeNumber: string | null
): TvdbEpisode[] | null {
  if (!season) return null;

  const desiredEpisodes: TvdbEpisode[] = [];

  if (!episodeNumber) {
    const seasonNum = parseInt(season);
    if (!isNaN(seasonNum)) {
      desiredEpisodes.push(...findEpisodesBySeason(tvdbData, seasonNum));
    }

    // Check if season is a year
    if (season.length === 4) {
      const year = parseInt(season);
      if (year >= 1900 && year <= 2100) {
        const yearEpisodes = findEpisodesByAirYear(tvdbData, year);
        for (const ep of yearEpisodes) {
          if (
            !desiredEpisodes.some(
              (d) => d.seasonNumber === ep.seasonNumber && d.episodeNumber === ep.episodeNumber
            )
          ) {
            desiredEpisodes.push(ep);
          }
        }
      }
    }
  } else {
    // Handle daily format (season is year, episode is MM/DD)
    if (season.length === 4 && episodeNumber.includes("/")) {
      const parts = episodeNumber.split("/");
      if (parts.length === 2) {
        const dateStr = `${season}-${parts[0]}-${parts[1]}`;
        const searchDate = new Date(dateStr);
        if (!isNaN(searchDate.getTime())) {
          const ep = findEpisodeByAirDate(tvdbData, searchDate);
          if (ep) desiredEpisodes.push(ep);
        }
      }
    } else {
      const seasonNum = parseInt(season);
      const episodeNum = parseInt(episodeNumber);
      if (!isNaN(seasonNum) && !isNaN(episodeNum)) {
        const ep = findEpisodeBySeasonAndNumber(tvdbData, seasonNum, episodeNum);
        if (ep) desiredEpisodes.push(ep);
      }
    }
  }

  return desiredEpisodes;
}

function applyDesiredEpisodeFilter(
  matchedEpisodes: MatchedEpisodeInfo[],
  desiredEpisodes: TvdbEpisode[] | null
): MatchedEpisodeInfo[] {
  if (!desiredEpisodes) return matchedEpisodes;

  return matchedEpisodes.filter((matched) =>
    desiredEpisodes.some(
      (desired) =>
        desired.seasonNumber === matched.episode.seasonNumber &&
        desired.episodeNumber === matched.episode.episodeNumber
    )
  );
}

export async function fetchSearchResultsById(
  tvdbData: TvdbData,
  season: string | null,
  episodeNumber: string | null,
  limit: number,
  offset: number
): Promise<string> {
  const quality = await getQualityPreference();
  const minDuration = await getMinDuration();
  const matchingSettings = await getMatchingSettings();
  console.log(
    `[Mediathek] fetchSearchResultsById: tvdbId=${tvdbData.id}, name="${tvdbData.name}", germanName="${tvdbData.germanName}", season=${season}, episode=${episodeNumber}, quality=${quality}, minDuration=${minDuration}`
  );

  const cacheKey = `tvdb_${tvdbData.id}_${season ?? "null"}_${episodeNumber ?? "null"}_${limit}_${offset}_${quality}_${minDuration}_${matchingSettings.threshold}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached && typeof cached === "object" && "response" in cached) {
    console.log(`[Mediathek] Returning cached response for ${cacheKey}`);
    return (cached as { response: string }).response;
  }

  const desiredEpisodes = getDesiredEpisodes(tvdbData, season, episodeNumber);
  console.log(`[Mediathek] Desired episodes: ${desiredEpisodes?.length ?? 0}`);
  if (season && desiredEpisodes?.length === 0) {
    console.log(`[Mediathek] No desired episodes found for season=${season}, returning empty`);
    const response = serializeRss(getEmptyRssResult());
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Check for cached API response
  const apiCacheKey = `mediathekapi_${tvdbData.id}`;
  let apiResponse: string;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi) {
    console.log(`[Mediathek] Using cached API response for ${apiCacheKey}`);
    apiResponse = (cachedApi as { response: string }).response;
  } else {
    const searchQuery = tvdbData.germanName || tvdbData.name;
    console.log(`[Mediathek] Searching MediathekView API with query: "${searchQuery}"`);
    const queries = [{ fields: QUERY_FIELDS, query: searchQuery }];
    apiResponse = await fetchMediathekViewApiResponse(queries, 10000);

    if (!apiResponse) {
      return serializeRss(getEmptyRssResult());
    }

    mediathekCache.set(apiCacheKey, { response: apiResponse });
  }

  let results: ApiResultItem[];
  try {
    const parsed: MediathekApiResponse = JSON.parse(apiResponse);
    results = parsed.result?.results || [];
    console.log(`[Mediathek] API returned ${results.length} results`);
    if (results.length > 0) {
      const uniqueTopics = [...new Set(results.map((r) => r.topic))];
      console.log(
        `[Mediathek] Unique topics in results: ${uniqueTopics.slice(0, 10).join(", ")}${uniqueTopics.length > 10 ? ` ... (${uniqueTopics.length} total)` : ""}`
      );
    }
  } catch {
    console.log(`[Mediathek] Failed to parse API response`);
    return serializeRss(getEmptyRssResult());
  }

  const { matchedEpisodes } = await applyRulesetFilters(results, tvdbData);
  console.log(`[Mediathek] Matched episodes after ruleset filtering: ${matchedEpisodes.length}`);

  const matchedDesiredEpisodes = applyDesiredEpisodeFilter(matchedEpisodes, desiredEpisodes);
  console.log(`[Mediathek] Matched desired episodes: ${matchedDesiredEpisodes.length}`);

  const newznabItems: NewznabItem[] = matchedDesiredEpisodes.flatMap((info) =>
    generateRssItems(info, quality)
  );
  console.log(`[Mediathek] Generated ${newznabItems.length} Newznab items (quality: ${quality})`);

  const response = convertItemsToRss(newznabItems, limit, offset);

  mediathekCache.set(cacheKey, { response });
  return response;
}

export async function fetchSearchResultsByString(
  q: string | null,
  season: string | null,
  limit: number,
  offset: number
): Promise<string> {
  // Normalize once: a whitespace-only q is treated as no query everywhere
  // (API query, cache keys, and generic gating) so behavior stays consistent.
  const trimmedQ = q?.trim() || null;
  const quality = await getQualityPreference();
  const minDuration = await getMinDuration();
  const matchingSettings = await getMatchingSettings();
  const cacheKey = `q_${trimmedQ ?? "null"}_${season ?? "null"}_${limit}_${offset}_${quality}_${minDuration}_${matchingSettings.threshold}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached) {
    return (cached as { response: string }).response;
  }

  const apiCacheKey = `mediathekapi_${trimmedQ ?? "null"}_${season ?? "null"}`;
  let apiResponse: string;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi) {
    apiResponse = (cachedApi as { response: string }).response;
  } else {
    const queries: Array<{ fields: string[]; query: string }> = [];

    if (trimmedQ) {
      queries.push({ fields: QUERY_FIELDS, query: trimmedQ });
    }

    if (season) {
      const zeroPadded = season.length >= 2 ? season : `0${season}`;
      queries.push({ fields: ["title"], query: `S${zeroPadded}` });
    }

    apiResponse = await fetchMediathekViewApiResponse(queries, 1500);

    if (!apiResponse) {
      return serializeRss(getEmptyRssResult());
    }

    mediathekCache.set(apiCacheKey, { response: apiResponse });
  }

  let results: ApiResultItem[];
  try {
    const parsed: MediathekApiResponse = JSON.parse(apiResponse);
    results = parsed.result?.results || [];
  } catch {
    return serializeRss(getEmptyRssResult());
  }

  const { matchedEpisodes, unmatchedItems } = await applyRulesetFilters(results);
  const newznabItems: NewznabItem[] = matchedEpisodes.flatMap((info) =>
    generateRssItems(info, quality)
  );

  // Generic (no-ruleset) results are only meaningful for an actual text search.
  // A season-only query (e.g. tvsearch&season=01 with no q) would otherwise emit
  // every title that merely contains "S01" across unrelated shows. Gate on a
  // non-empty q to keep the previous (matched-only) behavior for those queries.
  const hasTextQuery = !!trimmedQ;
  const genericItems: NewznabItem[] = hasTextQuery
    ? unmatchedItems.flatMap((item) => generateGenericRssItems(item, quality))
    : [];

  const allItems = [...newznabItems, ...genericItems];
  const response = convertItemsToRss(allItems, limit, offset);

  mediathekCache.set(cacheKey, { response });
  return response;
}

export async function fetchSearchResultsForRssSync(limit: number, offset: number): Promise<string> {
  const quality = await getQualityPreference();
  const minDuration = await getMinDuration();
  const matchingSettings = await getMatchingSettings();
  const cacheKey = `rss_${limit}_${offset}_${quality}_${minDuration}_${matchingSettings.threshold}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached) {
    return (cached as { response: string }).response;
  }

  const apiCacheKey = "rss_mediathekview_results";
  let results: ApiResultItem[];
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi) {
    results = (cachedApi as { results: ApiResultItem[] }).results;
  } else {
    const apiResponse = await fetchMediathekViewApiResponse([], 6000);

    if (!apiResponse) {
      return serializeRss(getEmptyRssResult());
    }

    try {
      const parsed: MediathekApiResponse = JSON.parse(apiResponse);
      results = parsed.result?.results || [];
    } catch {
      return serializeRss(getEmptyRssResult());
    }

    mediathekCache.set(apiCacheKey, { results });
  }

  const { matchedEpisodes } = await applyRulesetFilters(results);
  const newznabItems: NewznabItem[] = matchedEpisodes.flatMap((info) =>
    generateRssItems(info, quality)
  );
  const response = convertItemsToRss(newznabItems, limit, offset);

  mediathekCache.set(cacheKey, { response });
  return response;
}

// ============== MOVIE SEARCH FUNCTIONS ==============

/**
 * Search for a movie in the Mediathek by TMDB data
 */
export async function fetchMovieSearchResults(
  movieData: TmdbMovieData,
  limit: number,
  offset: number
): Promise<string> {
  const quality = await getQualityPreference();
  console.log(
    `[Mediathek] fetchMovieSearchResults: tmdbId=${movieData.tmdbId}, title="${movieData.title}", germanTitle="${movieData.germanTitle}", runtime=${movieData.runtime} min, quality=${quality}`
  );

  const cacheKey = `movie_${movieData.tmdbId}_${limit}_${offset}_${quality}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached && typeof cached === "object" && "response" in cached) {
    console.log(`[Mediathek] Returning cached movie response for ${cacheKey}`);
    return (cached as { response: string }).response;
  }

  // Search by German title and original title in parallel
  const searchTerms = [movieData.germanTitle];
  if (movieData.title !== movieData.germanTitle) {
    searchTerms.push(movieData.title);
  }

  // Helper function to fetch results for a single search term
  async function fetchForTerm(searchTerm: string): Promise<ApiResultItem[]> {
    const apiCacheKey = `mediathekapi_movie_${searchTerm}`;
    let apiResponse: string;
    const cachedApi = mediathekCache.get(apiCacheKey);

    if (cachedApi) {
      console.log(`[Mediathek] Using cached API response for movie search: "${searchTerm}"`);
      apiResponse = (cachedApi as { response: string }).response;
    } else {
      console.log(`[Mediathek] Searching MediathekView API for movie: "${searchTerm}"`);
      const queries = [{ fields: QUERY_FIELDS, query: searchTerm }];
      apiResponse = await fetchMediathekViewApiResponse(queries, 500);

      if (apiResponse) {
        mediathekCache.set(apiCacheKey, { response: apiResponse });
      }
    }

    if (apiResponse) {
      try {
        const parsed: MediathekApiResponse = JSON.parse(apiResponse);
        const results = parsed.result?.results || [];
        console.log(`[Mediathek] API returned ${results.length} results for "${searchTerm}"`);
        return results;
      } catch {
        console.log(`[Mediathek] Failed to parse API response for movie search`);
      }
    }
    return [];
  }

  // Fetch all search terms in parallel
  const resultsPerTerm = await Promise.all(searchTerms.map(fetchForTerm));

  // Merge results, avoiding duplicates by URL
  const allResults: ApiResultItem[] = [];
  const existingUrls = new Set<string>();
  for (const results of resultsPerTerm) {
    for (const result of results) {
      if (!existingUrls.has(result.url_video)) {
        existingUrls.add(result.url_video);
        allResults.push(result);
      }
    }
  }

  if (allResults.length === 0) {
    console.log(`[Mediathek] No results found for movie`);
    const response = serializeRss(getEmptyRssResult());
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  console.log(`[Mediathek] Total results for movie matching: ${allResults.length}`);

  // Filter out trailers and other non-movie content
  const filteredResults = allResults.filter(
    (item) => !SKIP_KEYWORDS.some((kw) => item.title.includes(kw))
  );
  console.log(`[Mediathek] Results after filtering: ${filteredResults.length}`);

  if (filteredResults.length === 0) {
    console.log(`[Mediathek] No results after filtering for movie`);
    const response = serializeRss(getEmptyRssResult());
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Match results against movie data
  const matchResults = await matchMovieItems(filteredResults, movieData);

  if (matchResults.length === 0) {
    console.log(`[Mediathek] No matches found for movie`);
    const response = serializeRss(getEmptyRssResult());
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Generate RSS items for matches
  const newznabItems: NewznabItem[] = matchResults.flatMap((match) =>
    generateMovieRssItems(match, movieData, quality)
  );

  console.log(
    `[Mediathek] Generated ${newznabItems.length} Newznab items for movie (quality: ${quality})`
  );

  const response = convertItemsToRss(newznabItems, limit, offset);
  mediathekCache.set(cacheKey, { response });
  return response;
}

/**
 * Search for movies in the Mediathek by query string (for Radarr text search)
 * Filters by minimum duration to identify feature films
 */
export async function fetchMovieSearchByQuery(
  query: string,
  limit: number,
  offset: number
): Promise<string> {
  const quality = await getQualityPreference();
  const MOVIE_MIN_DURATION = 60 * 60; // 60 minutes in seconds

  // Strip trailing year from query (Radarr sends "Movie Title 2018")
  const cleanedQuery = query.replace(/\s+\d{4}$/, "").trim();
  const yearMatch = query.match(/\s+(\d{4})$/);
  const searchYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

  console.log(
    `[Mediathek] fetchMovieSearchByQuery: query="${query}", cleanedQuery="${cleanedQuery}", year=${searchYear}, quality=${quality}, minDuration=${MOVIE_MIN_DURATION}s`
  );

  // Try to find the movie on TMDB to get IDs for Radarr matching
  const tmdbMovie = await searchMovieByTitle(cleanedQuery, searchYear);
  if (tmdbMovie) {
    console.log(
      `[Mediathek] Found TMDB match: "${tmdbMovie.germanTitle}" (TMDB: ${tmdbMovie.tmdbId}, IMDB: ${tmdbMovie.imdbId})`
    );
  }

  const cacheKey = `movie_query_${cleanedQuery}_${searchYear || ""}_${limit}_${offset}_${quality}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached && typeof cached === "object" && "response" in cached) {
    console.log(`[Mediathek] Returning cached movie query response for ${cacheKey}`);
    return (cached as { response: string }).response;
  }

  // Search Mediathek by query (without year)
  const apiCacheKey = `mediathekapi_movie_query_${cleanedQuery}`;
  let apiResponse: string;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi) {
    console.log(`[Mediathek] Using cached API response for movie query: "${cleanedQuery}"`);
    apiResponse = (cachedApi as { response: string }).response;
  } else {
    console.log(`[Mediathek] Searching MediathekView API for movie query: "${cleanedQuery}"`);
    const queries = [{ fields: QUERY_FIELDS, query: cleanedQuery }];
    apiResponse = await fetchMediathekViewApiResponse(queries, 500);

    if (apiResponse) {
      mediathekCache.set(apiCacheKey, { response: apiResponse });
    }
  }

  if (!apiResponse) {
    console.log(`[Mediathek] No API response for movie query`);
    const response = serializeRss(getEmptyRssResult());
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  let results: ApiResultItem[];
  try {
    const parsed: MediathekApiResponse = JSON.parse(apiResponse);
    results = parsed.result?.results || [];
    console.log(
      `[Mediathek] API returned ${results.length} results for movie query "${cleanedQuery}"`
    );
  } catch {
    console.log(`[Mediathek] Failed to parse API response for movie query`);
    const response = serializeRss(getEmptyRssResult());
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Filter: skip trailers, m3u8 (unless HLS enabled), and apply movie minimum duration (60 min)
  const hlsEnabled = await isHlsEnabled();
  const filteredResults = results.filter((item) => {
    if (!hlsEnabled && item.url_video.endsWith(".m3u8")) return false;
    if (SKIP_KEYWORDS.some((kw) => item.title.includes(kw))) return false;
    if (item.duration < MOVIE_MIN_DURATION) return false;
    return true;
  });

  console.log(
    `[Mediathek] Results after movie filtering (min ${MOVIE_MIN_DURATION / 60} min): ${filteredResults.length}`
  );

  if (filteredResults.length === 0) {
    console.log(`[Mediathek] No movie results after filtering`);
    const response = serializeRss(getEmptyRssResult());
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Generate RSS items directly for the filtered results (as movies)
  const newznabItems: NewznabItem[] = [];

  for (const item of filteredResults) {
    // Format the release title
    const baseTitle = formatTitle(item.topic || item.title);
    const year = new Date(item.filmlisteTimestamp * 1000).getFullYear();

    // Calculate size
    const size = item.size > 0 ? item.size : item.duration * 500000;

    // Create item for each available quality
    const qualities: Array<{
      url: string;
      qualityName: string;
      category: string;
      sizeMultiplier: number;
    }> = [];

    if (item.url_video_hd && (quality === "all" || quality === "best" || quality === "1080p")) {
      qualities.push({
        url: item.url_video_hd,
        qualityName: "1080p",
        category: "2040",
        sizeMultiplier: 1.6,
      });
    }
    if (
      item.url_video &&
      (quality === "all" || quality === "720p" || (quality === "best" && !item.url_video_hd))
    ) {
      qualities.push({
        url: item.url_video,
        qualityName: "720p",
        category: "2040",
        sizeMultiplier: 1.0,
      });
    }
    if (item.url_video_low && (quality === "all" || quality === "480p")) {
      qualities.push({
        url: item.url_video_low,
        qualityName: "480p",
        category: "2030",
        sizeMultiplier: 0.5,
      });
    }

    for (const q of qualities) {
      const releaseTitle = `${baseTitle}.${year}.GERMAN.${q.qualityName}.WEB.h264-MEDiATHEK`;
      const adjustedSize = Math.floor(size * q.sizeMultiplier);

      const encodedTitle = Buffer.from(releaseTitle).toString("base64");
      const encodedUrl = Buffer.from(q.url).toString("base64");
      const fakeDownloadUrl = `/api/newznab/fake_nzb_download?encodedUrl=${encodedUrl}&encodedTitle=${encodedTitle}`;

      newznabItems.push({
        title: releaseTitle,
        guid: {
          isPermaLink: true,
          value: `${item.url_website || q.url}#movie-${q.qualityName}`,
        },
        link: q.url,
        comments: item.url_website || "",
        pubDate: new Date(item.filmlisteTimestamp * 1000).toUTCString(),
        category: q.category === "2030" ? "Movies > SD" : "Movies > HD",
        description: item.description || "",
        enclosure: {
          url: fakeDownloadUrl,
          length: adjustedSize,
          type: "application/x-nzb",
        },
        attributes: [
          { name: "category", value: "2000" },
          { name: "category", value: q.category },
          ...(tmdbMovie?.tmdbId ? [{ name: "tmdbid", value: tmdbMovie.tmdbId.toString() }] : []),
          ...(tmdbMovie?.imdbId ? [{ name: "imdbid", value: tmdbMovie.imdbId }] : []),
        ],
      });
    }
  }

  console.log(
    `[Mediathek] Generated ${newznabItems.length} Newznab items for movie query (quality: ${quality})`
  );

  const response = convertItemsToRss(newznabItems, limit, offset);
  mediathekCache.set(cacheKey, { response });
  return response;
}
