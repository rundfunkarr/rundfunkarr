import { getSetting } from "@/lib/settings";
import type { QualityPreference } from "../newznab";

export const QUERY_FIELDS = ["topic", "title"];
const VALID_QUALITIES: QualityPreference[] = ["all", "best", "1080p", "720p", "480p"];

export async function isHlsEnabled(): Promise<boolean> {
  const setting = await getSetting("download.enableHLS");
  return setting === "true";
}

export async function getQualityPreference(): Promise<QualityPreference> {
  const setting = await getSetting("download.quality");
  if (setting && VALID_QUALITIES.includes(setting as QualityPreference)) {
    return setting as QualityPreference;
  }
  return "all"; // Default to all qualities
}

type MatchingStrategyPreference = "fuzzy" | "strict";

export async function getMatchingSettings(): Promise<{
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
