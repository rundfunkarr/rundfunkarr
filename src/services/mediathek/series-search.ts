import { mediathekCache } from "@/lib/cache";
import { getMinDurationSeconds, isSeriesUmlautStrippingEnabled } from "@/lib/settings";
import { queryContent } from "../content-search";
import {
  ensureRulesetsLoaded,
  getRulesetsForTopicAndTvdbId,
  getAllTopics,
  getOrGenerateRulesetForShow,
} from "../rulesets";
import {
  generateRssItems,
  generateGenericRssItems,
  convertItemsToRss,
  serializeRss,
  getEmptyRssResult,
} from "../newznab";
import type {
  ApiResultItem,
  TvdbData,
  TvdbEpisode,
  Ruleset,
  MatchedEpisodeInfo,
  NewznabItem,
  Filter,
  TitleRegexRule,
} from "@/types";
import {
  findEpisodeByAirDate,
  findEpisodesByAirYear,
  findEpisodesBySeason,
  findEpisodeBySeasonAndNumber,
} from "@/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("Mediathek");
import { QUERY_FIELDS, getMatchingSettings, getQualityPreference } from "./preferences";
import { applyRulesetFilters } from "./ruleset-filter";

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

// Only omit an extra topic search when every matching title necessarily includes
// the series name. For example, "Frühling - (.*)" under the broad "Film" topic.
function titleRequiresSeriesName(ruleset: Ruleset, seriesName: string): boolean {
  try {
    const filters: Filter[] = JSON.parse(ruleset.filters);
    if (
      filters.some(
        (filter) =>
          filter.attribute === "title" &&
          (filter.type === "Contains" || filter.type === "ExactMatch") &&
          String(filter.value).toLowerCase().includes(seriesName.toLowerCase())
      )
    )
      return true;
    const rules: TitleRegexRule[] = JSON.parse(ruleset.titleRegexRules);
    if (rules.length !== 1 || rules[0].type !== "regex" || rules[0].field !== "title") return false;
    const prefix = rules[0].pattern?.match(/^\^?([\p{L}\p{N} _:-]+)\(\.\*\)\$?$/u)?.[1];
    return !!prefix && prefix.toLowerCase().includes(seriesName.toLowerCase());
  } catch {
    return false;
  }
}

export async function fetchSearchResultsById(
  tvdbData: TvdbData,
  season: string | null,
  episodeNumber: string | null,
  limit: number,
  offset: number
): Promise<string> {
  const [quality, minDuration, matchingSettings, stripSeriesUmlauts] = await Promise.all([
    getQualityPreference(),
    getMinDurationSeconds(),
    getMatchingSettings(),
    isSeriesUmlautStrippingEnabled(),
  ]);
  const searchQuery = tvdbData.germanName || tvdbData.name;
  await ensureRulesetsLoaded();
  const rulesetSnapshot = new Map(
    getAllTopics()
      .map((topic) => [topic, getRulesetsForTopicAndTvdbId(topic, tvdbData.id)] as const)
      .filter(([, rulesets]) => rulesets.length > 0)
  );
  const topics = [...rulesetSnapshot.keys()]
    .filter((topic) => topic.trim() && topic.toLowerCase() !== searchQuery.toLowerCase())
    .filter(
      (topic) =>
        !rulesetSnapshot
          .get(topic)!
          .every((ruleset) => titleRequiresSeriesName(ruleset, searchQuery))
    )
    .sort();
  // Separate requests make these alternatives rather than AND conditions.
  const searchQueries = [
    { fields: QUERY_FIELDS, query: searchQuery },
    ...topics.map((topic) => ({ fields: ["topic"], query: topic })),
  ];
  log.debug(
    `fetchSearchResultsById: tvdbId=${tvdbData.id}, name="${tvdbData.name}", germanName="${tvdbData.germanName}", season=${season}, episode=${episodeNumber}, quality=${quality}, minDuration=${minDuration}`
  );

  const cacheKey = `tvdb_${tvdbData.id}_${season ?? "null"}_${episodeNumber ?? "null"}_${limit}_${offset}_${quality}_${minDuration}_${matchingSettings.threshold}_${JSON.stringify(searchQueries)}_${JSON.stringify([...rulesetSnapshot])}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached && typeof cached === "object" && "response" in cached) {
    log.debug(`Returning cached response for ${cacheKey}`);
    return (cached as { response: string }).response;
  }

  const desiredEpisodes = getDesiredEpisodes(tvdbData, season, episodeNumber);
  log.debug(`Desired episodes: ${desiredEpisodes?.length ?? 0}`);
  if (season && desiredEpisodes?.length === 0) {
    log.debug(`No desired episodes found for season=${season}, returning empty`);
    const response = serializeRss(getEmptyRssResult());
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  const resultsPerQuery = await Promise.all(
    searchQueries.map(async (query) => {
      const apiCacheKey = `mediathekapi_${tvdbData.id}_${JSON.stringify(query)}`;
      const cachedApi = mediathekCache.get(apiCacheKey);
      if (cachedApi) {
        return (cachedApi as { results: ApiResultItem[] }).results;
      }

      log.debug(`Searching MediathekView API with query: "${query.query}"`);
      try {
        const results = await queryContent([query], 10000, { deduplicate: false });
        if (results !== null) mediathekCache.set(apiCacheKey, { results });
        return results;
      } catch (error) {
        log.error(`Query failed for "${query.query}":`, error);
        return null;
      }
    })
  );
  const hasFailedQuery = resultsPerQuery.some((results) => results === null);
  const results = resultsPerQuery
    .flatMap((items) => items ?? [])
    .sort((a, b) => b.filmlisteTimestamp - a.filmlisteTimestamp);

  if (results.length === 0) {
    const response = serializeRss(getEmptyRssResult());
    if (!hasFailedQuery) mediathekCache.set(cacheKey, { response });
    return response;
  }

  log.debug(`API returned ${results.length} results`);
  if (results.length > 0) {
    const uniqueTopics = [...new Set(results.map((r) => r.topic))];
    log.debug(
      `Unique topics in results: ${uniqueTopics.slice(0, 10).join(", ")}${uniqueTopics.length > 10 ? ` ... (${uniqueTopics.length} total)` : ""}`
    );
  }

  // Generate only when uncached candidates actually need matching. A cached
  // response (including an empty one) must not trigger fresh discovery requests.
  if (rulesetSnapshot.size === 0) {
    const generated = await getOrGenerateRulesetForShow(tvdbData.id, tvdbData);
    if (generated) {
      rulesetSnapshot.set(generated.topic, [generated]);
    } else {
      // Another first-time search may have registered the rule while we waited.
      for (const topic of getAllTopics()) {
        const rulesets = getRulesetsForTopicAndTvdbId(topic, tvdbData.id);
        if (rulesets.length > 0) rulesetSnapshot.set(topic, rulesets);
      }
    }
  }
  const { matchedEpisodes } = await applyRulesetFilters(results, tvdbData, rulesetSnapshot);
  log.debug(`Matched episodes after ruleset filtering: ${matchedEpisodes.length}`);

  const matchedDesiredEpisodes = applyDesiredEpisodeFilter(matchedEpisodes, desiredEpisodes);
  log.debug(`Matched desired episodes: ${matchedDesiredEpisodes.length}`);

  // A duplicate URL can carry different metadata: keep all candidates until
  // ruleset, skip and desired-episode filtering have selected valid matches.
  const seenUrls = new Set<string>();
  const uniqueEpisodes = matchedDesiredEpisodes.filter(({ item }) => {
    if (seenUrls.has(item.url_video)) return false;
    seenUrls.add(item.url_video);
    return true;
  });
  const newznabItems: NewznabItem[] = uniqueEpisodes.flatMap((info) =>
    generateRssItems(info, quality, stripSeriesUmlauts)
  );
  log.info(`Generated ${newznabItems.length} Newznab items (quality: ${quality})`);

  const response = convertItemsToRss(newznabItems, limit, offset);

  if (!hasFailedQuery) mediathekCache.set(cacheKey, { response });
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
  const [quality, minDuration, matchingSettings, stripSeriesUmlauts] = await Promise.all([
    getQualityPreference(),
    getMinDurationSeconds(),
    getMatchingSettings(),
    isSeriesUmlautStrippingEnabled(),
  ]);
  const cacheKey = `q_${trimmedQ ?? "null"}_${season ?? "null"}_${limit}_${offset}_${quality}_${minDuration}_${matchingSettings.threshold}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached) {
    return (cached as { response: string }).response;
  }

  const apiCacheKey = `mediathekapi_${trimmedQ ?? "null"}_${season ?? "null"}`;
  let results: ApiResultItem[] | null;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi) {
    results = (cachedApi as { results: ApiResultItem[] }).results;
  } else {
    const queries: Array<{ fields: string[]; query: string }> = [];

    if (trimmedQ) {
      queries.push({ fields: QUERY_FIELDS, query: trimmedQ });
    }

    if (season) {
      const zeroPadded = season.length >= 2 ? season : `0${season}`;
      queries.push({ fields: ["title"], query: `S${zeroPadded}` });
    }

    results = await queryContent(queries, 1500);
    if (results === null) {
      return serializeRss(getEmptyRssResult());
    }
    mediathekCache.set(apiCacheKey, { results });
  }

  const { matchedEpisodes, unmatchedItems } = await applyRulesetFilters(results);
  const newznabItems: NewznabItem[] = matchedEpisodes.flatMap((info) =>
    generateRssItems(info, quality, stripSeriesUmlauts)
  );

  // Generic (no-ruleset) results are only meaningful for an actual text search.
  // A season-only query (e.g. tvsearch&season=01 with no q) would otherwise emit
  // every title that merely contains "S01" across unrelated shows. Gate on a
  // non-empty q to keep the previous (matched-only) behavior for those queries.
  const hasTextQuery = !!trimmedQ;
  const genericItems: NewznabItem[] = hasTextQuery
    ? unmatchedItems.flatMap((item) => generateGenericRssItems(item, quality, stripSeriesUmlauts))
    : [];

  const allItems = [...newznabItems, ...genericItems];
  const response = convertItemsToRss(allItems, limit, offset);

  mediathekCache.set(cacheKey, { response });
  return response;
}

export async function fetchSearchResultsForRssSync(limit: number, offset: number): Promise<string> {
  const [quality, minDuration, matchingSettings, stripSeriesUmlauts] = await Promise.all([
    getQualityPreference(),
    getMinDurationSeconds(),
    getMatchingSettings(),
    isSeriesUmlautStrippingEnabled(),
  ]);
  const cacheKey = `rss_${limit}_${offset}_${quality}_${minDuration}_${matchingSettings.threshold}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached) {
    return (cached as { response: string }).response;
  }

  const apiCacheKey = "rss_mediathekview_results";
  let results: ApiResultItem[] | null;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi) {
    results = (cachedApi as { results: ApiResultItem[] }).results;
  } else {
    results = await queryContent([], 6000);
    if (results === null) {
      return serializeRss(getEmptyRssResult());
    }
    mediathekCache.set(apiCacheKey, { results });
  }

  const { matchedEpisodes } = await applyRulesetFilters(results);
  const newznabItems: NewznabItem[] = matchedEpisodes.flatMap((info) =>
    generateRssItems(info, quality, stripSeriesUmlauts)
  );
  const response = convertItemsToRss(newznabItems, limit, offset);

  mediathekCache.set(cacheKey, { response });
  return response;
}
