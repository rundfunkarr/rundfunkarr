import { promises as fs } from "fs";
import path from "path";
import type { Ruleset, TvdbData } from "@/types";
import {
  getGeneratedRulesets,
  generateRulesetForShow,
  getGeneratedRulesetByTvdbId,
} from "./ruleset-generator";

// In-memory storage for rulesets indexed by topic
let rulesetsByTopic: Map<string, Ruleset[]> = new Map();
let generatedRulesetsByTopic: Map<string, Ruleset[]> = new Map();
let lastFetchTime: number = 0;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// GitHub raw URLs for auto-update
const GITHUB_RULESETS_URL =
  process.env.RULESETS_URL ||
  "https://raw.githubusercontent.com/rundfunkarr/rundfunkarr/main/data/rulesets.json";

async function fetchFromGitHub(): Promise<Ruleset[] | null> {
  try {
    console.log(`[Rulesets] Fetching from GitHub: ${GITHUB_RULESETS_URL}`);
    const response = await fetch(GITHUB_RULESETS_URL, {
      headers: { "User-Agent": "RundfunkArr" },
    });

    if (!response.ok) {
      console.warn(`[Rulesets] GitHub fetch failed: ${response.status}`);
      return null;
    }

    const rulesets: Ruleset[] = await response.json();
    console.log(`[Rulesets] Fetched ${rulesets.length} rulesets from GitHub`);
    return rulesets;
  } catch (error) {
    console.warn("[Rulesets] Error fetching from GitHub:", error);
    return null;
  }
}

async function loadFromLocalFile(): Promise<Ruleset[]> {
  const rulesetsPath = path.join(process.cwd(), "data", "rulesets.json");
  const fileContent = await fs.readFile(rulesetsPath, "utf-8");
  const rulesets: Ruleset[] = JSON.parse(fileContent);
  console.log(`[Rulesets] Loaded ${rulesets.length} rulesets from local file`);
  return rulesets;
}

function indexRulesets(allRulesets: Ruleset[]): void {
  // Clear and rebuild the topic map
  rulesetsByTopic = new Map();

  // Group rulesets by topic and sort by priority
  for (const ruleset of allRulesets) {
    const existing = rulesetsByTopic.get(ruleset.topic) || [];
    existing.push(ruleset);
    rulesetsByTopic.set(ruleset.topic, existing);
  }

  // Sort each topic's rulesets by priority
  for (const [topic, rulesets] of rulesetsByTopic) {
    rulesetsByTopic.set(
      topic,
      rulesets.sort((a, b) => a.priority - b.priority)
    );
  }

  console.log(
    `[Rulesets] Indexed ${allRulesets.length} rulesets for ${rulesetsByTopic.size} topics`
  );
}

export async function loadRulesets(): Promise<void> {
  try {
    // Try GitHub first, fall back to local file
    let allRulesets = await fetchFromGitHub();

    if (!allRulesets) {
      console.log("[Rulesets] Falling back to local file");
      allRulesets = await loadFromLocalFile();
    }

    indexRulesets(allRulesets);

    // Also load generated rulesets from database
    await loadGeneratedRulesets();

    lastFetchTime = Date.now();
  } catch (error) {
    console.error("[Rulesets] Error loading rulesets:", error);
  }
}

async function loadGeneratedRulesets(): Promise<void> {
  try {
    const generated = await getGeneratedRulesets();
    generatedRulesetsByTopic = new Map();

    for (const ruleset of generated) {
      const existing = generatedRulesetsByTopic.get(ruleset.topic) || [];
      existing.push(ruleset);
      generatedRulesetsByTopic.set(ruleset.topic, existing);
    }

    if (generated.length > 0) {
      console.log(
        `[Rulesets] Loaded ${generated.length} generated rulesets for ${generatedRulesetsByTopic.size} topics`
      );
    }
  } catch (error) {
    console.warn("[Rulesets] Error loading generated rulesets:", error);
  }
}

let refreshPromise: Promise<void> | null = null;

export async function refreshRulesetsIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - lastFetchTime > REFRESH_INTERVAL_MS) {
    console.log("[Rulesets] Refreshing rulesets (hourly update)");
    if (!refreshPromise) {
      refreshPromise = loadRulesets().finally(() => {
        refreshPromise = null;
      });
    }
    await refreshPromise;
  }
}

export function getRulesetsForTopic(topic: string): Ruleset[] {
  // Check generated rulesets first (higher priority for user-specific matches)
  const generated = generatedRulesetsByTopic.get(topic) || [];
  const external = rulesetsByTopic.get(topic) || [];

  // Generated rulesets take priority, then external
  return [...generated, ...external];
}

export function getRulesetsForTopicAndTvdbId(topic: string, tvdbId: number): Ruleset[] {
  const topicRulesets = getRulesetsForTopic(topic);
  const filtered = topicRulesets.filter((r) => r.media?.media_tvdbId === tvdbId);
  return filtered;
}

export function getAllTopics(): string[] {
  // Combine topics from both sources
  const externalTopics = Array.from(rulesetsByTopic.keys());
  const generatedTopics = Array.from(generatedRulesetsByTopic.keys());
  return [...new Set([...externalTopics, ...generatedTopics])];
}

/**
 * Check if we have a ruleset for a TVDB ID (from any source)
 */
export function hasRulesetForTvdbId(tvdbId: number): boolean {
  // Check generated rulesets
  for (const rulesets of generatedRulesetsByTopic.values()) {
    if (rulesets.some((r) => r.media?.media_tvdbId === tvdbId)) {
      return true;
    }
  }

  // Check external rulesets
  for (const rulesets of rulesetsByTopic.values()) {
    if (rulesets.some((r) => r.media?.media_tvdbId === tvdbId)) {
      return true;
    }
  }

  return false;
}

/**
 * Add a generated ruleset to the in-memory cache
 */
export function addGeneratedRuleset(ruleset: Ruleset): void {
  const existing = generatedRulesetsByTopic.get(ruleset.topic) || [];
  existing.push(ruleset);
  generatedRulesetsByTopic.set(ruleset.topic, existing);
  console.log(`[Rulesets] Added generated ruleset for topic "${ruleset.topic}"`);
}

/**
 * Get or generate a ruleset for a show
 * This is the main entry point for auto-generating rulesets
 */
export async function getOrGenerateRulesetForShow(
  tvdbId: number,
  showInfo: TvdbData
): Promise<Ruleset | null> {
  // First check if we already have a ruleset (external or generated)
  if (hasRulesetForTvdbId(tvdbId)) {
    console.log(`[Rulesets] Already have ruleset for TVDB ${tvdbId}`);
    return null; // Return null to indicate existing ruleset should be used
  }

  // Check if we have a generated ruleset in database
  const existingGenerated = await getGeneratedRulesetByTvdbId(tvdbId);
  if (existingGenerated) {
    // Add to cache if not already there
    addGeneratedRuleset(existingGenerated);
    return existingGenerated;
  }

  // Try to auto-generate a new ruleset
  console.log(`[Rulesets] No ruleset found for TVDB ${tvdbId}, attempting auto-generation...`);
  const generated = await generateRulesetForShow(tvdbId, showInfo);

  if (generated) {
    // Add to in-memory cache
    addGeneratedRuleset(generated);
    return generated;
  }

  return null;
}

export function isRulesetsLoaded(): boolean {
  return rulesetsByTopic.size > 0;
}

// Initialize rulesets on first import
let initPromise: Promise<void> | null = null;

export async function ensureRulesetsLoaded(): Promise<void> {
  if (initPromise) {
    await initPromise;
    return;
  }
  if (isRulesetsLoaded()) {
    // Discovery must see the completed refresh before selecting topics.
    await refreshRulesetsIfNeeded();
    return;
  }

  if (!initPromise) {
    initPromise = loadRulesets().finally(() => {
      initPromise = null;
    });
  }

  await initPromise;
}
