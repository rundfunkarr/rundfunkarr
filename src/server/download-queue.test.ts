import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createServer, type ServerResponse } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { clearSettingsCache } from "@/lib/settings";
import {
  startDownloadProcessing,
  controlDownload,
  setQueuePaused,
  recoverDownloads,
} from "./download-queue";
import { processDownload } from "./download-manager";

const { testDir } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  return { testDir: await mkdtemp(`${tmpdir()}/rundfunkarr-queue-`) };
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: `file:${testDir}/queue.db` }) };
});

const bytes = Buffer.from([1, 2, 3, 4]);
let requests: string[] = [];
const blocked = new Set<string>();
const pending = new Set<ServerResponse>();
let active = 0;
let maximum = 0;
let base = "";
const source = createServer((request, response) => {
  const url = request.url!;
  requests.push(url);
  if (url === "/missing.mp4") {
    response.writeHead(404);
    response.end();
    return;
  }
  if (
    url === "/unavailable.mp4" ||
    (url === "/retry.mp4" && requests.filter((entry) => entry === url).length === 1)
  ) {
    response.writeHead(503);
    response.end();
    return;
  }
  active++;
  maximum = Math.max(maximum, active);
  response.once("close", () => {
    active--;
    pending.delete(response);
  });
  response.writeHead(200, { "Content-Length": bytes.length });
  response.write(bytes.subarray(0, 2));
  if (blocked.has(url)) pending.add(response);
  else response.end(bytes.subarray(2));
});

beforeAll(async () => {
  const schema = await readFile("init-db.sql", "utf8");
  for (const table of ["Config", "Download"]) {
    const sql = schema.match(
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\);`)
    )![0];
    await prisma.$executeRawUnsafe(sql);
  }
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(source.address() as { port: number }).port}`;
});
beforeEach(async () => {
  requests = [];
  blocked.clear();
  maximum = 0;
  await prisma.config.createMany({
    data: [
      { key: "download.path", value: `${testDir}/downloads` },
      { key: "download.convertToMkv", value: "false" },
      { key: "download.parallel", value: "2" },
      { key: "download.maxRetries", value: "1" },
    ],
  });
  clearSettingsCache();
});
afterEach(async () => {
  await setQueuePaused(true);
  for (const job of await prisma.download.findMany()) await controlDownload(job.id, "cancel");
  for (const response of pending) response.end(bytes.subarray(2));
  await startDownloadProcessing();
  await prisma.download.deleteMany();
  await prisma.config.deleteMany();
  clearSettingsCache();
});
afterAll(async () => {
  await prisma.$disconnect();
  await new Promise<void>((resolve) => source.close(() => resolve()));
  await rm(testDir, { recursive: true, force: true });
});
const job = (
  id: string,
  route = `/${id}.mp4`,
  options: { priority?: number; status?: string } = {}
) =>
  prisma.download.create({
    data: { id, title: "Gleicher Titel", url: base + route, category: "tv", ...options },
  });

describe("Warteschlange mit SQLite und echten HTTP-Übertragungen", () => {
  it("begrenzt Parallelität, beachtet Priorität und trennt gleichnamige Dateien", async () => {
    await job("a");
    await job("b", "/b.mp4", { priority: 10 });
    await job("c");
    blocked.add("/a.mp4");
    blocked.add("/b.mp4");
    const processing = startDownloadProcessing();
    await vi.waitFor(() => expect(requests).toEqual(["/b.mp4", "/a.mp4"]));
    expect(await prisma.download.count({ where: { status: "downloading" } })).toBe(2);
    expect(await prisma.download.count({ where: { status: "queued" } })).toBe(1);
    for (const response of pending) response.end(bytes.subarray(2));
    await processing;
    expect(maximum).toBeLessThanOrEqual(2);
    expect(requests).toHaveLength(3);
    const finished = await prisma.download.findMany();
    expect(finished.every((entry) => entry.status === "completed")).toBe(true);
    expect(new Set(finished.map((entry) => entry.filePath)).size).toBe(3);
    for (const entry of finished) expect(await readFile(entry.filePath!)).toEqual(bytes);
  });

  it("stoppt einen laufenden Download beim Pausieren und startet ihn beim Fortsetzen erneut", async () => {
    await job("pause");
    blocked.add("/pause.mp4");
    const processing = startDownloadProcessing();
    await vi.waitFor(async () =>
      expect((await prisma.download.findUnique({ where: { id: "pause" } }))?.progress).toBe(50)
    );
    expect(await controlDownload("pause", "pause")).toBe(true);
    await processing;
    expect((await prisma.download.findUnique({ where: { id: "pause" } }))?.status).toBe("paused");
    expect(requests).toHaveLength(1);
    blocked.clear();
    await controlDownload("pause", "resume");
    await startDownloadProcessing();
    expect(await prisma.download.findUnique({ where: { id: "pause" } })).toMatchObject({
      status: "completed",
      attempts: 1,
    });
    expect(requests).toHaveLength(2);
  });

  it("beendet aktive Aufträge beim Abbrechen ohne eine fertige Datei zu melden", async () => {
    await job("cancel");
    blocked.add("/cancel.mp4");
    const processing = startDownloadProcessing();
    await vi.waitFor(() => expect(requests).toEqual(["/cancel.mp4"]));
    await controlDownload("cancel", "cancel");
    await processing;
    expect(await prisma.download.findUnique({ where: { id: "cancel" } })).toMatchObject({
      status: "cancelled",
      filePath: null,
    });
    expect(await controlDownload("cancel", "resume")).toBe(false);
  });

  it("plant HTTP 503 erneut ein, begrenzt Versuche und wiederholt HTTP 404 nicht", async () => {
    await job("retry", "/retry.mp4");
    await job("exhausted", "/unavailable.mp4");
    await job("missing", "/missing.mp4");
    await startDownloadProcessing();
    const retry = await prisma.download.findUniqueOrThrow({ where: { id: "retry" } });
    expect(retry.status).toBe("queued");
    expect(retry.attempts).toBe(1);
    expect(retry.nextRetryAt!.getTime()).toBeGreaterThan(Date.now() + 25000);
    expect(await prisma.download.findUnique({ where: { id: "missing" } })).toMatchObject({
      status: "failed",
      attempts: 1,
      nextRetryAt: null,
    });
    await prisma.download.updateMany({
      where: { id: { in: ["retry", "exhausted"] } },
      data: { nextRetryAt: new Date(0) },
    });
    await startDownloadProcessing();
    expect(await prisma.download.findUnique({ where: { id: "retry" } })).toMatchObject({
      status: "completed",
      attempts: 2,
    });
    expect(await prisma.download.findUnique({ where: { id: "exhausted" } })).toMatchObject({
      status: "failed",
      attempts: 2,
      nextRetryAt: null,
    });
  });

  it("stellt unterbrochene Aufträge wieder her und lässt individuell pausierte Aufträge stehen", async () => {
    await setQueuePaused(true);
    await startDownloadProcessing();
    await job("unterbrochen", undefined, { status: "downloading" });
    await job("konvertierung", undefined, { status: "converting" });
    await job("pausiert", undefined, { status: "paused" });
    await recoverDownloads();
    await startDownloadProcessing();
    expect(await prisma.download.count({ where: { status: "queued" } })).toBe(2);
    expect((await prisma.download.findUnique({ where: { id: "pausiert" } }))?.status).toBe(
      "paused"
    );
    await setQueuePaused(false);
    await startDownloadProcessing();
    expect(await prisma.download.count({ where: { status: "completed" } })).toBe(2);
    expect(requests).toHaveLength(2);
  });

  it("beansprucht denselben Auftrag auch bei zwei gleichzeitigen Aufrufen nur einmal", async () => {
    await job("doppelt");
    await Promise.all([processDownload("doppelt"), processDownload("doppelt")]);
    expect(requests).toEqual(["/doppelt.mp4"]);
  });

  it("verarbeitet weitere Aufträge, wenn der Fehlerstatus eines Auftrags nicht gespeichert werden kann", async () => {
    await job("defekt", undefined, { priority: 10 });
    await job("ok");
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER block_job BEFORE UPDATE ON Download WHEN OLD.id = 'defekt' BEGIN SELECT RAISE(FAIL, 'Test-Schreibfehler'); END"
    );
    try {
      await startDownloadProcessing();
      expect((await prisma.download.findUnique({ where: { id: "ok" } }))?.status).toBe("completed");
      expect(requests).toEqual(["/ok.mp4"]);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER block_job");
    }
  });
});
