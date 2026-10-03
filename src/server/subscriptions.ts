import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { queryContent } from "@/services/content-search";
import { getSetting } from "@/lib/settings";
import { isStreamingUrl, withStreamQuality } from "@/lib/stream-url";
import type { ApiResultItem } from "@/types";
import type { Prisma } from "@prisma/client";
export const subscriptionInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    query: z.string().trim().min(2).max(200),
    channel: z.string().trim().max(100).default(""),
    minMinutes: z.number().int().min(0).max(1440).default(0),
    maxMinutes: z.number().int().min(0).max(1440).default(0),
    intervalMinutes: z.number().int().min(15).max(10080).default(60),
    quality: z.enum(["low", "standard", "high"]).default("high"),
    action: z.enum(["notify", "download"]).default("notify"),
    category: z.enum(["default", "tv", "movie"]).default("default"),
  })
  .refine((x) => !x.maxMinutes || x.maxMinutes >= x.minMinutes, "Ungültige Laufzeitgrenzen.");
export type SubscriptionInput = z.infer<typeof subscriptionInput>;
interface Scheduler {
  running: Map<string, Promise<void>>;
  timer?: ReturnType<typeof setInterval>;
  scanning?: boolean;
}
const shared = globalThis as typeof globalThis & { rundfunkarrSubscriptions?: Scheduler };
const scheduler: Scheduler = (shared.rundfunkarrSubscriptions ??= { running: new Map() });
function triggerDownloads() {
  void import("./download-manager").then((m) => m.startDownloadProcessing()).catch(console.error);
}
function title(topic: string, name: string) {
  return `${topic} - ${name}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 180);
}
function key(item: ApiResultItem) {
  const broadcast = (item as ApiResultItem & { timestamp?: number }).timestamp;
  return createHash("sha256")
    .update(JSON.stringify([item.channel, item.topic, item.title, broadcast ?? item.url_video]))
    .digest("hex");
}
async function queueMatch(
  tx: Prisma.TransactionClient,
  match: { id: string; title: string; topic: string; videoUrl: string },
  category: string
) {
  const download = await tx.download.create({
    data: { title: title(match.topic, match.title), url: match.videoUrl, category },
  });
  await tx.subscriptionMatch.update({
    where: { id: match.id },
    data: { state: "queued", downloadId: download.id },
  });
  return download.id;
}
export async function saveSubscription(input: SubscriptionInput, id?: string) {
  if (!id) return prisma.searchSubscription.create({ data: input });
  return prisma.$transaction(async (tx) => {
    const existing = await tx.searchSubscription.findUniqueOrThrow({ where: { id } });
    const reset = (["query", "channel", "minMinutes", "maxMinutes"] as const).some(
      (field) => existing[field] !== input[field]
    );
    if (reset) await tx.subscriptionMatch.deleteMany({ where: { subscriptionId: id } });
    return tx.searchSubscription.update({
      where: { id },
      data: {
        ...input,
        ...(reset
          ? { initialized: false, lastCheckedAt: null, lastError: null, nextCheckAt: new Date() }
          : {}),
      },
    });
  });
}
export function checkSubscription(id: string): Promise<void> {
  const current = scheduler.running.get(id);
  if (current) return current;
  const task = check(id).finally(() => scheduler.running.delete(id));
  scheduler.running.set(id, task);
  return task;
}
async function check(id: string) {
  const subscription = await prisma.searchSubscription.findUnique({ where: { id } });
  if (!subscription || subscription.paused) return;
  try {
    const queries = [{ fields: ["topic", "title"], query: subscription.query }];
    if (subscription.channel) queries.push({ fields: ["channel"], query: subscription.channel });
    const items = await queryContent(queries, 1000, { future: false });
    if (!items)
      throw new Error("Die aktivierten Mediatheken konnten nicht vollständig abgefragt werden.");
    const hls = (await getSetting("download.enableHLS")) === "true";
    const filtered = items.filter(
      (item) =>
        item.duration >= subscription.minMinutes * 60 &&
        (!subscription.maxMinutes || item.duration <= subscription.maxMinutes * 60) &&
        (!subscription.channel ||
          item.channel
            .toLocaleLowerCase("de")
            .includes(subscription.channel.toLocaleLowerCase("de"))) &&
        (hls || !isStreamingUrl(item.url_video))
    );
    let downloads = 0;
    await prisma.$transaction(
      async (tx) => {
        const latest = await tx.searchSubscription.findUnique({ where: { id } });
        // Während der Abfrage geänderte oder pausierte Suchen erst beim nächsten Lauf übernehmen.
        if (
          !latest ||
          latest.paused ||
          latest.updatedAt.getTime() !== subscription.updatedAt.getTime()
        )
          return;
        for (const item of filtered) {
          const sourceKey = key(item);
          if (
            await tx.subscriptionMatch.findUnique({
              where: { subscriptionId_sourceKey: { subscriptionId: id, sourceKey } },
            })
          )
            continue;
          const url =
            subscription.quality === "low"
              ? item.url_video_low || item.url_video
              : subscription.quality === "high"
                ? item.url_video_hd || item.url_video
                : item.url_video;
          const match = await tx.subscriptionMatch.create({
            data: {
              id: randomUUID(),
              subscriptionId: id,
              sourceKey,
              title: item.title,
              topic: item.topic,
              channel: item.channel,
              videoUrl: isStreamingUrl(url)
                ? withStreamQuality(url, subscription.quality as "low" | "standard" | "high")
                : url,
              websiteUrl: item.url_website,
              duration: item.duration,
              state: latest.initialized ? "new" : "baseline",
            },
          });
          if (latest.initialized && latest.action === "download") {
            await queueMatch(tx, match, latest.category);
            downloads++;
          }
        }
        await tx.searchSubscription.update({
          where: { id },
          data: {
            initialized: true,
            lastCheckedAt: new Date(),
            nextCheckAt: new Date(Date.now() + latest.intervalMinutes * 60000),
            lastError:
              items.length >= 1000
                ? "Die Abfrage hat 1.000 Quelltreffer erreicht. Suchbegriff oder Sender eingrenzen; weitere Treffer können fehlen."
                : null,
          },
        });
      },
      { timeout: 20000 }
    );
    if (downloads) triggerDownloads();
  } catch (error) {
    console.error("[Suchabos] Prüfung fehlgeschlagen:", error);
    await prisma.searchSubscription.updateMany({
      where: { id },
      data: {
        lastError: "Die Prüfung ist fehlgeschlagen. Der nächste Versuch erfolgt in fünf Minuten.",
        nextCheckAt: new Date(Date.now() + 300000),
      },
    });
  }
}
export async function runDueSubscriptions() {
  if (scheduler.scanning) return;
  scheduler.scanning = true;
  try {
    const due = await prisma.searchSubscription.findMany({
      where: { paused: false, nextCheckAt: { lte: new Date() } },
      orderBy: { nextCheckAt: "asc" },
      take: 10,
    });
    for (const item of due) await checkSubscription(item.id);
  } finally {
    scheduler.scanning = false;
  }
}
export function startSubscriptionScheduler() {
  if (scheduler.timer) return;
  void runDueSubscriptions().catch(console.error);
  scheduler.timer = setInterval(() => void runDueSubscriptions().catch(console.error), 60000);
  scheduler.timer.unref?.();
}
export async function downloadSubscriptionMatch(id: string) {
  const result = await prisma.$transaction(async (tx) => {
    const match = await tx.subscriptionMatch.findUniqueOrThrow({
      where: { id },
      include: { subscription: true },
    });
    if (match.downloadId) return match.downloadId;
    return queueMatch(tx, match, match.subscription.category);
  });
  triggerDownloads();
  return result;
}
