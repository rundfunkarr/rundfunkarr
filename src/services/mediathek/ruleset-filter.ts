import { getMinDurationSeconds } from "@/lib/settings";
import {
  ensureRulesetsLoaded,
  getRulesetsForTopic,
  getRulesetsForTopicAndTvdbId,
  getAllTopics,
  getOrGenerateRulesetForShow,
} from "../rulesets";
import type {
  ApiResultItem,
  TvdbData,
  Ruleset,
  MatchedEpisodeInfo,
  Filter,
  MatchingStrategy,
} from "@/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("Mediathek");
import { getMatchingSettings, isHlsEnabled } from "./preferences";
import { firstRejectedFilter, shouldSkipItem } from "./item-filters";
import {
  createShowLookup,
  matchesAbsoluteEpisodeNumber,
  matchesItemTitleEqualsAirdate,
  matchesItemTitleExact,
  matchesItemTitleIncludes,
  matchesSeasonAndEpisode,
} from "./episode-matchers";

export async function applyRulesetFilters(
  results: ApiResultItem[],
  tvdbData?: TvdbData,
  rulesetSnapshot?: Map<string, Ruleset[]>
): Promise<{ matchedEpisodes: MatchedEpisodeInfo[]; unmatchedItems: ApiResultItem[] }> {
  if (!rulesetSnapshot) await ensureRulesetsLoaded();
  const minDuration = await getMinDurationSeconds();
  const matchingSettings = await getMatchingSettings();
  const hlsEnabled = await isHlsEnabled();
  log.debug(
    `Matching settings: strategy=${matchingSettings.strategy}, threshold=${matchingSettings.threshold}, minDuration=${minDuration}s, hlsEnabled=${hlsEnabled}`
  );

  const matchedEpisodes: MatchedEpisodeInfo[] = [];
  const unmatchedItems: ApiResultItem[] = [...results];
  const getShow = createShowLookup();

  // Log available rulesets for debugging
  if (tvdbData && !rulesetSnapshot) {
    const allTopics = getAllTopics();
    log.debug(`Rulesets available: ${allTopics.length} topics`);

    // Check if any ruleset exists for this TVDB ID
    let foundRulesetForTvdbId = false;
    for (const topic of allTopics) {
      const rulesets = getRulesetsForTopicAndTvdbId(topic, tvdbData.id);
      if (rulesets.length > 0) {
        log.debug(
          `Found ${rulesets.length} ruleset(s) for topic "${topic}" with tvdbId ${tvdbData.id}`
        );
        foundRulesetForTvdbId = true;
      }
    }
    if (!foundRulesetForTvdbId) {
      log.debug(
        `No rulesets found for tvdbId ${tvdbData.id} (${tvdbData.name}), attempting auto-generation...`
      );

      // Try to auto-generate a ruleset
      const generatedRuleset = await getOrGenerateRulesetForShow(tvdbData.id, tvdbData);
      if (generatedRuleset) {
        log.debug(
          `Auto-generated ruleset for topic "${generatedRuleset.topic}" -> TVDB ${tvdbData.id}`
        );
        foundRulesetForTvdbId = true;
      } else {
        log.debug(`Could not auto-generate ruleset for ${tvdbData.name}`);
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
      ? (rulesetSnapshot?.get(item.topic) ??
        (rulesetSnapshot ? [] : getRulesetsForTopicAndTvdbId(item.topic, tvdbData.id)))
      : getRulesetsForTopic(item.topic);

    // Log first few items to show what's being checked
    if (checkedCount < 5) {
      log.debug(
        `Checking item: topic="${item.topic}", title="${item.title}", rulesets found: ${rulesets.length}`
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

      if (await firstRejectedFilter(item, filters)) {
        const idx = unmatchedItems.indexOf(item);
        if (idx > -1) unmatchedItems.splice(idx, 1);
        continue;
      }

      let matchInfo: MatchedEpisodeInfo | null = null;

      // Apply matching with threshold from settings
      const threshold = matchingSettings.threshold;

      switch (ruleset.matchingStrategy) {
        case "SeasonAndEpisodeNumber" as MatchingStrategy:
          matchInfo = await matchesSeasonAndEpisode(item, ruleset, getShow);
          break;
        case "ItemTitleIncludes" as MatchingStrategy:
          matchInfo = await matchesItemTitleIncludes(item, ruleset, getShow, threshold);
          break;
        case "ItemTitleExact" as MatchingStrategy:
          // For strict strategy, require higher threshold
          const exactThreshold =
            matchingSettings.strategy === "strict" ? Math.max(threshold, 0.95) : threshold;
          matchInfo = await matchesItemTitleExact(item, ruleset, getShow, exactThreshold);
          break;
        case "ItemTitleEqualsAirdate" as MatchingStrategy:
          matchInfo = await matchesItemTitleEqualsAirdate(item, ruleset, getShow);
          break;
        case "ByAbsoluteEpisodeNumber" as MatchingStrategy:
          matchInfo = await matchesAbsoluteEpisodeNumber(item, ruleset, getShow);
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
