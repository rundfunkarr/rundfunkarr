import { isStreamingUrl } from "@/lib/stream-url";
import { runRulesetRegex } from "@/server/ruleset-regex";
import type { ApiResultItem, Filter, TitleRegexRule, MatchType, TitleRegexRuleType } from "@/types";

// Keywords that are always skipped (trailers, outtakes, etc.)
export const SKIP_KEYWORDS = ["Trailer", "Outtakes:", "(klare Sprache)"];

export function shouldSkipItem(
  item: ApiResultItem,
  minDuration: number,
  hlsEnabled: boolean = false
): boolean {
  // Skip m3u8 streams unless HLS is enabled, items with skip keywords, and items shorter than minDuration
  if (!hlsEnabled && isStreamingUrl(item.url_video)) return true;
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

async function filterMatches(item: ApiResultItem, filter: Filter): Promise<boolean> {
  const attributeValue = getFieldValue(item, filter.attribute);
  const filterValue = String(filter.value);

  switch (filter.type) {
    case "ExactMatch" as MatchType:
      return attributeValue.toLowerCase() === filterValue.toLowerCase();
    case "Contains" as MatchType:
      return attributeValue.toLowerCase().includes(filterValue.toLowerCase());
    case "Regex" as MatchType:
      return runRulesetRegex("test", filterValue, attributeValue);
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

export async function firstRejectedFilter(
  item: ApiResultItem,
  filters: Filter[]
): Promise<Filter | null> {
  for (const filter of filters) {
    if (!(await filterMatches(item, filter))) return filter;
  }
  return null;
}

export async function extractValueUsingRegex(
  item: ApiResultItem,
  pattern: string | null
): Promise<string | null> {
  if (!pattern) return null;

  const fieldValue = getFieldValue(item, "title");
  if (!fieldValue) return null;

  return runRulesetRegex("first", pattern, fieldValue);
}

export async function buildTitleFromRegexRules(
  item: ApiResultItem,
  rulesJson: string
): Promise<string | null> {
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
          const value = await runRulesetRegex("last", rule.pattern, fieldValue);
          if (value === null) return null;
          parts.push(value);
        }
      }
    }
  }

  return parts.join("");
}
