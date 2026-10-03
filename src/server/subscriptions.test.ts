import { NextRequest } from "next/server";
import { GET } from "@/app/api/subscriptions/route";
import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { prisma } from "@/lib/db";
import {
  checkSubscription,
  saveSubscription,
  subscriptionInput,
  downloadSubscriptionMatch,
  runDueSubscriptions,
} from "./subscriptions";
const { folder, queryContent, startDownloadProcessing } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  return {
    folder: await mkdtemp(`${tmpdir()}/rundfunkarr-subscriptions-`),
    queryContent: vi.fn(),
    startDownloadProcessing: vi.fn(async () => {}),
  };
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: `file:${folder}/subscriptions.db` }) };
});
vi.mock("@/services/content-search", () => ({ queryContent }));
vi.mock("@/lib/settings", () => ({ getSetting: async () => "false" }));
vi.mock("./download-manager", () => ({ startDownloadProcessing }));
const entry = (i: number) => ({
  channel: "ZDF",
  topic: "Natur",
  title: `Sendung ${i}`,
  description: "",
  timestamp: 1000 + i,
  filmlisteTimestamp: 2000,
  duration: 1800,
  size: 1,
  url_video: `https://example.org/${i}.mp4`,
  url_video_hd: `https://example.org/${i}-hd.mp4`,
  url_video_low: "",
  url_website: "https://example.org/sendung",
});
const input = () =>
  subscriptionInput.parse({
    name: "Naturfilme",
    query: "Natur",
    action: "download",
    category: "tv",
  });
beforeAll(async () => {
  const sql = await readFile("init-db.sql", "utf8");
  for (const statement of sql
    .split(";")
    .map((s) => s.trim())
    .filter(
      (s) =>
        s &&
        /CREATE TABLE IF NOT EXISTS (?:Download|"SearchSubscription"|"SubscriptionMatch")|CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "(?:SearchSubscription|SubscriptionMatch)_/.test(
          s
        )
    ))
    await prisma.$executeRawUnsafe(statement);
});
beforeEach(async () => {
  await prisma.subscriptionMatch.deleteMany();
  await prisma.searchSubscription.deleteMany();
  await prisma.download.deleteMany();
  queryContent.mockReset().mockResolvedValue([entry(1)]);
  startDownloadProcessing.mockClear();
});
afterAll(async () => {
  await prisma.$disconnect();
  await rm(folder, { recursive: true, force: true });
});
it("merkt den Altbestand vor und lädt nur später neue Treffer einmal herunter, auch nach neuer Datenbankverbindung", async () => {
  const sub = await saveSubscription(input());
  await checkSubscription(sub.id);
  expect(await prisma.download.count()).toBe(0);
  expect((await prisma.subscriptionMatch.findFirst())?.state).toBe("baseline");
  queryContent.mockResolvedValue([entry(1), entry(2)]);
  await checkSubscription(sub.id);
  await checkSubscription(sub.id);
  expect(await prisma.download.count()).toBe(1);
  expect(await prisma.download.findFirst()).toMatchObject({
    category: "tv",
    url: "https://example.org/2-hd.mp4",
  });
  await prisma.$disconnect();
  await prisma.$connect();
  queryContent.mockResolvedValue([
    { ...entry(2), url_video: "https://example.org/2.mp4?token=neu" },
    entry(1),
  ]);
  await checkSubscription(sub.id);
  expect(await prisma.download.count()).toBe(1);
});
it("führt gleichzeitige Prüfungen desselben Suchabos zusammen", async () => {
  const sub = await saveSubscription(input());
  const first = checkSubscription(sub.id),
    second = checkSubscription(sub.id);
  expect(first).toBe(second);
  await Promise.all([first, second]);
  expect(queryContent).toHaveBeenCalledTimes(1);
});
it("erhält Meldungen dauerhaft und fügt einen manuell gewählten Treffer nur einmal hinzu", async () => {
  const sub = await saveSubscription({ ...input(), action: "notify" });
  await checkSubscription(sub.id);
  queryContent.mockResolvedValue([entry(1), entry(2)]);
  await checkSubscription(sub.id);
  const match = await prisma.subscriptionMatch.findFirstOrThrow({ where: { state: "new" } });
  expect(await prisma.download.count()).toBe(0);
  const [a, b] = await Promise.all([
    downloadSubscriptionMatch(match.id),
    downloadSubscriptionMatch(match.id),
  ]);
  expect(a).toBe(b);
  expect(await prisma.download.count()).toBe(1);
});
it("ändert einen fehlgeschlagenen ersten Abgleich nicht in einen leeren Altbestand", async () => {
  queryContent.mockResolvedValue(null);
  const sub = await saveSubscription(input());
  await checkSubscription(sub.id);
  const saved = await prisma.searchSubscription.findUniqueOrThrow({ where: { id: sub.id } });
  expect(saved.initialized).toBe(false);
  expect(saved.lastError).toContain("fehlgeschlagen");
  expect(saved.nextCheckAt.getTime()).toBeGreaterThan(Date.now() + 290000);
});
it("übernimmt nach einer Pause während des Abrufs keine neuen Downloads", async () => {
  const sub = await saveSubscription(input());
  await checkSubscription(sub.id);
  queryContent.mockImplementationOnce(async () => {
    await prisma.searchSubscription.update({ where: { id: sub.id }, data: { paused: true } });
    return [entry(1), entry(2)];
  });
  await checkSubscription(sub.id);
  expect(await prisma.download.count()).toBe(0);
});
it("beginnt nach geänderten Suchfiltern einen neuen Vormerklauf und behält fertige Download-Aufträge", async () => {
  const sub = await saveSubscription(input());
  await checkSubscription(sub.id);
  queryContent.mockResolvedValue([entry(1), entry(2)]);
  await checkSubscription(sub.id);
  await saveSubscription({ ...input(), query: "Wissen" }, sub.id);
  expect(await prisma.subscriptionMatch.count()).toBe(0);
  await checkSubscription(sub.id);
  expect(await prisma.download.count()).toBe(1);
  expect(await prisma.subscriptionMatch.count({ where: { state: "baseline" } })).toBe(2);
});
it("prüft nur fällige, aktive Abos und respektiert Laufzeitfilter", async () => {
  const due = await saveSubscription({ ...input(), minMinutes: 40 });
  const paused = await saveSubscription(input());
  await prisma.searchSubscription.update({ where: { id: paused.id }, data: { paused: true } });
  const later = await saveSubscription(input());
  await prisma.searchSubscription.update({
    where: { id: later.id },
    data: { nextCheckAt: new Date(Date.now() + 3600000) },
  });
  await runDueSubscriptions();
  expect(queryContent).toHaveBeenCalledTimes(1);
  expect((await prisma.searchSubscription.findUnique({ where: { id: due.id } }))?.initialized).toBe(
    true
  );
  expect(await prisma.subscriptionMatch.count()).toBe(0);
});

it("hält auch ältere Meldungen über Folgeseiten erreichbar", async () => {
  queryContent.mockResolvedValue([]);
  const sub = await saveSubscription({ ...input(), action: "notify" });
  await checkSubscription(sub.id);
  queryContent.mockResolvedValue(Array.from({ length: 55 }, (_, i) => entry(i)));
  await checkSubscription(sub.id);
  const first = await (
    await GET(new NextRequest(`http://localhost/api/subscriptions?id=${sub.id}`))
  ).json();
  const second = await (
    await GET(new NextRequest(`http://localhost/api/subscriptions?id=${sub.id}&offset=50`))
  ).json();
  expect(first.total).toBe(55);
  expect(first.matches).toHaveLength(50);
  expect(second.matches).toHaveLength(5);
  expect(new Set([...first.matches, ...second.matches].map((x) => x.id)).size).toBe(55);
  expect(
    (await GET(new NextRequest(`http://localhost/api/subscriptions?id=${sub.id}&offset=-1`))).status
  ).toBe(400);
});
