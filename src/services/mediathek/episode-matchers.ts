import { getShowInfoByTvdbId } from "../shows";
import type { ApiResultItem, TvdbData, TvdbEpisode, Ruleset, MatchedEpisodeInfo } from "@/types";
import { findEpisodeByAirDate, findEpisodeBySeasonAndNumber } from "@/types";
import { buildTitleFromRegexRules, extractValueUsingRegex } from "./item-filters";
import { formatTitle, stringSimilarity, tryParseDate } from "./title-parsing";

export type ShowLookup = (tvdbId: number) => Promise<TvdbData | null>;

// Memoises show lookups (including misses) for one matching pass. Name searches
// and RSS sync match every item against every ruleset of its topic, so an
// uncached miss would otherwise repeat the lookup for each item.
export function createShowLookup(): ShowLookup {
  const lookups = new Map<number, Promise<TvdbData | null>>();
  return (tvdbId) => {
    let lookup = lookups.get(tvdbId);
    if (!lookup) {
      lookup = getShowInfoByTvdbId(tvdbId);
      lookups.set(tvdbId, lookup);
    }
    return lookup;
  };
}

export async function matchesSeasonAndEpisode(
  item: ApiResultItem,
  ruleset: Ruleset,
  getShow: ShowLookup
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getShow(ruleset.media.media_tvdbId);
  if (!tvdbData?.episodes?.length) return null;

  const season = await extractValueUsingRegex(item, ruleset.seasonRegex);
  const episode = await extractValueUsingRegex(item, ruleset.episodeRegex);

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

export async function matchesItemTitleIncludes(
  item: ApiResultItem,
  ruleset: Ruleset,
  getShow: ShowLookup,
  threshold: number = 0.7
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getShow(ruleset.media.media_tvdbId);
  if (!tvdbData?.episodes?.length) return null;

  const constructedTitle = await buildTitleFromRegexRules(item, ruleset.titleRegexRules);
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

export async function matchesItemTitleExact(
  item: ApiResultItem,
  ruleset: Ruleset,
  getShow: ShowLookup,
  threshold: number = 0.95
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getShow(ruleset.media.media_tvdbId);
  if (!tvdbData?.episodes?.length) return null;

  const constructedTitle = await buildTitleFromRegexRules(item, ruleset.titleRegexRules);
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

export async function matchesItemTitleEqualsAirdate(
  item: ApiResultItem,
  ruleset: Ruleset,
  getShow: ShowLookup
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getShow(ruleset.media.media_tvdbId);
  if (!tvdbData?.episodes?.length) return null;

  const constructedTitle = await buildTitleFromRegexRules(item, ruleset.titleRegexRules);
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
