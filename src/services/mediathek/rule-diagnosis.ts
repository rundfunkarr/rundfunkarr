import { isStreamingUrl } from "@/lib/stream-url";
import { getMinDurationSeconds } from "@/lib/settings";
import type { ApiResultItem, TvdbData, Ruleset, Filter } from "@/types";
import { isHlsEnabled } from "./preferences";
import { SKIP_KEYWORDS, firstRejectedFilter } from "./item-filters";
import { applyRulesetFilters } from "./ruleset-filter";

export interface RuleDiagnosis {
  title: string;
  topic: string;
  duration: number;
  url: string;
  status: "matched" | "filtered" | "unmatched";
  reason: string;
  episode?: { season: number; episode: number; title: string };
}

// Die Vorschau verwendet denselben Matcher wie die Newznab-Suche.
export async function diagnoseRuleset(
  item: ApiResultItem,
  rule: Ruleset,
  show: TvdbData
): Promise<RuleDiagnosis> {
  const result: RuleDiagnosis = {
    title: item.title,
    topic: item.topic,
    duration: item.duration,
    url: item.url_website,
    status: "filtered",
    reason: "",
  };
  const minDuration = await getMinDurationSeconds();
  if (!(await isHlsEnabled()) && isStreamingUrl(item.url_video))
    return { ...result, reason: "HLS-Downloads sind ausgeschaltet." };
  if (SKIP_KEYWORDS.some((keyword) => item.title.includes(keyword)))
    return { ...result, reason: "Titel enthält einen ausgeschlossenen Zusatz, etwa Trailer." };
  if (item.duration < minDuration)
    return {
      ...result,
      reason: `Laufzeit liegt unter dem globalen Minimum von ${Math.ceil(minDuration / 60)} Minuten.`,
    };
  if (item.topic !== rule.topic)
    return { ...result, reason: "Das Mediathek-Thema stimmt nicht mit der Regel überein." };
  const filters = JSON.parse(rule.filters) as Filter[];
  const rejected = await firstRejectedFilter(item, filters);
  if (rejected)
    return {
      ...result,
      reason: `Regelfilter nicht erfüllt: ${rejected.attribute} ${rejected.type} ${rejected.value}`,
    };
  const { matchedEpisodes } = await applyRulesetFilters(
    [item],
    show,
    new Map([[rule.topic, [rule]]])
  );
  const match = matchedEpisodes[0];
  if (!match)
    return {
      ...result,
      status: "unmatched",
      reason:
        "Keine Episode zugeordnet. Titelregeln, Nummern und vorhandene Serienmetadaten prüfen.",
    };
  return {
    ...result,
    status: "matched",
    reason: `Zugeordnet über ${rule.matchingStrategy}.`,
    episode: {
      season: match.episode.seasonNumber,
      episode: match.episode.episodeNumber,
      title: match.episode.name,
    },
  };
}
