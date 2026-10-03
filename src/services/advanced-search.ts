import { randomUUID } from "node:crypto";
import { z } from "zod";
import { queryContent } from "./content-search";
import { getCategoriesForTopics } from "./category";
import { getSetting } from "@/lib/settings";
import { isStreamingUrl, withStreamQuality } from "@/lib/stream-url";
import type { SearchResult } from "@/app/api/search/route";
import { addToQueue } from "./download";

const day = z
  .string()
  .refine(
    (value) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value)) &&
        new Date(value).toISOString().startsWith(value)),
    "Ungültiges Datum."
  );
export const searchFilters = z
  .object({
    q: z.string().trim().min(2).max(200),
    channel: z.string().trim().max(100).default(""),
    minMinutes: z.coerce.number().int().min(0).max(1440).default(0),
    maxMinutes: z.coerce.number().int().min(0).max(1440).default(0),
    from: day.default(""),
    to: day.default(""),
    sort: z.enum(["date", "title", "duration"]).default("date"),
  })
  .refine(
    (x) => !x.maxMinutes || x.maxMinutes >= x.minMinutes,
    "Die maximale Laufzeit muss mindestens der minimalen entsprechen."
  )
  .refine((x) => !x.from || !x.to || x.from <= x.to, "Der Zeitraum ist umgekehrt.");
export type SearchFilters = z.infer<typeof searchFilters>;
export type Quality = "low" | "standard" | "high";
interface SearchSnapshot {
  results: SearchResult[];
  expires: number;
  limited: boolean;
}
const shared = globalThis as typeof globalThis & {
  rundfunkarrSearches?: Map<string, SearchSnapshot>;
};
const snapshots = (shared.rundfunkarrSearches ??= new Map<string, SearchSnapshot>());
export const SEARCH_LIMIT = 1000;
export const PAGE_SIZE = 50;
function prune() {
  for (const [key, value] of snapshots) if (value.expires <= Date.now()) snapshots.delete(key);
  while (snapshots.size >= 16) snapshots.delete(snapshots.keys().next().value!);
}
export function getSearchSnapshot(id: string): SearchSnapshot | undefined {
  const value = snapshots.get(id);
  if (value && value.expires > Date.now()) return value;
  snapshots.delete(id);
}
export async function advancedSearch(filters: SearchFilters) {
  const queries = [{ fields: ["topic", "title"], query: filters.q }];
  if (filters.channel) queries.push({ fields: ["channel"], query: filters.channel });
  const items = await queryContent(queries, SEARCH_LIMIT, { sortBy: "timestamp", future: false });
  if (!items) throw new Error("Die Mediathek-Suche ist momentan nicht erreichbar.");
  const hls = (await getSetting("download.enableHLS")) === "true";
  const categories = await getCategoriesForTopics([...new Set(items.map((x) => x.topic))]);
  const from = filters.from ? Date.parse(filters.from) / 1000 : -Infinity;
  const to = filters.to ? Date.parse(filters.to) / 1000 + 86400 : Infinity;
  const results: SearchResult[] = items.flatMap((item) => {
    const timestamp =
      typeof item.timestamp === "number" && Number.isFinite(item.timestamp)
        ? item.timestamp
        : item.filmlisteTimestamp;
    if (
      (!hls && isStreamingUrl(item.url_video)) ||
      item.duration < filters.minMinutes * 60 ||
      (filters.maxMinutes && item.duration > filters.maxMinutes * 60) ||
      timestamp < from ||
      timestamp >= to ||
      (filters.channel &&
        !item.channel.toLocaleLowerCase("de").includes(filters.channel.toLocaleLowerCase("de")))
    )
      return [];
    return [{ ...item, id: randomUUID(), timestamp, category: categories.get(item.topic) }];
  });
  results.sort((a, b) =>
    filters.sort === "title"
      ? a.title.localeCompare(b.title, "de")
      : filters.sort === "duration"
        ? b.duration - a.duration
        : b.timestamp - a.timestamp
  );
  prune();
  const id = randomUUID();
  const value = {
    results,
    expires: Date.now() + 5 * 60_000,
    limited: items.length >= SEARCH_LIMIT,
  };
  snapshots.set(id, value);
  return { id, ...value };
}
export function resultVideoUrl(item: SearchResult, quality: Quality): string {
  const url =
    quality === "low"
      ? item.url_video_low || item.url_video
      : quality === "high"
        ? item.url_video_hd || item.url_video
        : item.url_video;
  return isStreamingUrl(url) ? withStreamQuality(url, quality) : url;
}
export function safeTitle(title: string): string {
  return (
    title
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .trim()
      .slice(0, 180) || "Mediathek-Download"
  );
}
export async function enqueueSelection(snapshotId: string, ids: string[], quality: Quality) {
  const snapshot = getSearchSnapshot(snapshotId);
  if (!snapshot) return null;
  const items = ids.map((id) => snapshot.results.find((item) => item.id === id));
  if (items.some((item) => !item)) throw new Error("Die Auswahl gehört nicht zu dieser Suche.");
  const results: Array<{ id: string; downloadId?: string; error?: string }> = [];
  for (const item of items as SearchResult[]) {
    try {
      const { id } = await addToQueue(
        resultVideoUrl(item, quality),
        safeTitle(`${item.topic} - ${item.title}`),
        item.category === "movie" ? "movie" : item.category === "tv" ? "tv" : "default"
      );
      results.push({ id: item.id, downloadId: id });
    } catch {
      results.push({ id: item.id, error: "Der Download konnte nicht hinzugefügt werden." });
    }
  }
  return results;
}
