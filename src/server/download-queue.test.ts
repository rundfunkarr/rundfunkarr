import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createServer, type ServerResponse } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import * as fsp from "fs/promises";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { clearSettingsCache } from "@/lib/settings";
import { GET as getApi } from "@/app/api/route";
import { GET as getDownloadApi } from "@/app/api/download/route";
import {
  startDownloadProcessing,
  controlDownload,
  setQueuePaused,
  recoverDownloads,
} from "./download-queue";
import { processDownload } from "./download-manager";
import { deleteHistoryItem, retryDownload } from "@/services/download";

const { testDir, fetchSubtitle } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  return { testDir: await mkdtemp(`${tmpdir()}/rundfunkarr-queue-`), fetchSubtitle: vi.fn() };
});
vi.mock("./subtitle-fetch", () => ({ fetchSubtitle }));
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: `file:${testDir}/queue.db` });
  // Wrap these proxy methods so individual tests can inject query failures or delays.
  Object.assign(prisma.download, {
    count: vi.fn(prisma.download.count),
    findFirst: vi.fn(prisma.download.findFirst),
  });
  return { prisma };
});

const bytes = Buffer.from([1, 2, 3, 4]);
const subtitleText = "WEBVTT\n\n00:01.000 --> 00:02.000\nSubtitle\n";
const mediaMetadata = JSON.stringify({
  subtitleUrl: "https://example.org/subtitles.vtt",
  audioLanguage: "eng",
});
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
  vi.clearAllMocks();
  fetchSubtitle.mockReset().mockResolvedValue(subtitleText);
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
  options: { priority?: number; status?: string; mediaMetadata?: string } = {}
) =>
  prisma.download.create({
    data: { id, title: "Gleicher Titel", url: base + route, category: "tv", ...options },
  });

async function enableSubtitles() {
  await prisma.config.create({ data: { key: "download.subtitleMode", value: "sidecar" } });
  clearSettingsCache();
}

describe("Warteschlange mit SQLite und echten HTTP-Übertragungen", () => {
  it.each([
    ["/api", getApi],
    ["/api/download", getDownloadApi],
  ])("zählt abgebrochene Downloads in den Historienseiten von %s mit", async (path, get) => {
    await prisma.download.createMany({
      data: ["completed", "failed", "cancelled", "queued", "paused"].map((status) => ({
        id: status,
        title: status,
        url: `${base}/${status}.mp4`,
        category: "tv",
        status,
        completedAt: new Date("2026-10-01T12:00:00Z"),
      })),
    });

    const first = await get(new NextRequest(`http://localhost${path}?mode=history&limit=2`));
    const second = await get(
      new NextRequest(`http://localhost${path}?mode=history&start=2&limit=2`)
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstPage = (await first.json()).history;
    const secondPage = (await second.json()).history;
    expect(firstPage.noofslots).toBe(3);
    expect(secondPage.noofslots).toBe(3);
    expect(firstPage.slots).toHaveLength(2);
    expect(secondPage.slots).toHaveLength(1);
    expect(
      [...firstPage.slots, ...secondPage.slots].map((item: { nzo_id: string }) => item.nzo_id)
    ).toEqual(["failed", "completed", "cancelled"]);
  });

  it("verarbeitet bei Parallelität eins jeden Auftrag einmal und benötigt keine Zählabfrage", async () => {
    await prisma.config.update({ where: { key: "download.parallel" }, data: { value: "1" } });
    clearSettingsCache();
    await job("first", undefined, { priority: 10 });
    await job("second");
    blocked.add("/first.mp4");
    const count = vi
      .mocked(prisma.download.count)
      .mockRejectedValue(new Error("Zusätzliche Zählabfrage nicht erreichbar"));
    const processing = startDownloadProcessing();
    try {
      await vi.waitFor(() => expect(requests).toEqual(["/first.mp4"]));
      expect(startDownloadProcessing()).toBe(processing);
      expect(startDownloadProcessing()).toBe(processing);
      for (const response of pending) response.end(bytes.subarray(2));
      await processing;
      expect(requests).toEqual(["/first.mp4", "/second.mp4"]);
      expect(maximum).toBe(1);
      expect(await prisma.download.findMany()).toEqual([
        expect.objectContaining({ status: "completed", attempts: 1 }),
        expect.objectContaining({ status: "completed", attempts: 1 }),
      ]);
      expect(count).not.toHaveBeenCalled();
    } finally {
      count.mockReset();
    }
  });

  it("kann nach einem Datenbankfehler erneut gestartet werden", async () => {
    await job("restart");
    const lookup = vi
      .mocked(prisma.download.findFirst)
      .mockRejectedValueOnce(new Error("Datenbank vorübergehend nicht erreichbar"));
    try {
      await expect(startDownloadProcessing()).rejects.toThrow("Datenbank");
      await startDownloadProcessing();
      expect(requests).toEqual(["/restart.mp4"]);
      expect(await prisma.download.findUnique({ where: { id: "restart" } })).toMatchObject({
        status: "completed",
        attempts: 1,
      });
    } finally {
      lookup.mockReset();
    }
  });

  it("berücksichtigt einen Auftrag, der während der letzten leeren Abfrage eingeht", async () => {
    let entered!: () => void;
    let release!: (value: null) => void;
    const lastLookupStarted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const lastLookup = new Promise<null>((resolve) => {
      release = resolve;
    });
    const lookup = vi
      .mocked(prisma.download.findFirst)
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(() => {
        entered();
        return lastLookup as ReturnType<typeof prisma.download.findFirst>;
      });
    const processing = startDownloadProcessing();
    try {
      await lastLookupStarted;
      await job("late");
      expect(startDownloadProcessing()).toBe(processing);
    } finally {
      release(null);
      try {
        await processing;
      } finally {
        lookup.mockReset();
      }
    }
    expect(requests).toEqual(["/late.mp4"]);
    expect(await prisma.download.findUnique({ where: { id: "late" } })).toMatchObject({
      status: "completed",
      attempts: 1,
    });
  });

  it("begrenzt Parallelität, beachtet Priorität und trennt gleichnamige Dateien", async () => {
    await enableSubtitles();
    await job("a", undefined, { mediaMetadata });
    await job("b", "/b.mp4", { priority: 10, mediaMetadata });
    await job("c", undefined, { mediaMetadata });
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
    const artifacts = finished.map((entry) => JSON.parse(entry.subtitleArtifact!));
    expect(new Set(artifacts.map((artifact) => artifact.path)).size).toBe(3);
    for (const artifact of artifacts)
      expect(await readFile(artifact.path, "utf8")).toContain("Subtitle");
    await deleteHistoryItem("a", true);
    await expect(fsp.access(`${testDir}/downloads/tv/a`)).rejects.toMatchObject({ code: "ENOENT" });
    for (const entry of finished.filter((entry) => entry.id !== "a")) {
      expect(await readFile(entry.filePath!)).toEqual(bytes);
      expect(await readFile(JSON.parse(entry.subtitleArtifact!).path, "utf8")).toContain(
        "Subtitle"
      );
    }
  });

  it("stoppt einen laufenden Download beim Pausieren und startet ihn beim Fortsetzen erneut", async () => {
    await enableSubtitles();
    await job("pause", undefined, { mediaMetadata });
    blocked.add("/pause.mp4");
    const processing = startDownloadProcessing();
    await vi.waitFor(async () =>
      expect((await prisma.download.findUnique({ where: { id: "pause" } }))?.progress).toBe(50)
    );
    expect(await controlDownload("pause", "pause")).toBe(true);
    await processing;
    expect((await prisma.download.findUnique({ where: { id: "pause" } }))?.status).toBe("paused");
    expect(requests).toHaveLength(1);
    expect(fetchSubtitle).not.toHaveBeenCalled();
    blocked.clear();
    await controlDownload("pause", "resume");
    await startDownloadProcessing();
    expect(await prisma.download.findUnique({ where: { id: "pause" } })).toMatchObject({
      status: "completed",
      attempts: 1,
    });
    expect(requests).toHaveLength(2);
    const finished = await prisma.download.findUniqueOrThrow({ where: { id: "pause" } });
    expect(finished.mediaMetadata).toBe(mediaMetadata);
    expect(await readFile(JSON.parse(finished.subtitleArtifact!).path, "utf8")).toContain(
      "Subtitle"
    );
    expect(fetchSubtitle).toHaveBeenCalledExactlyOnceWith("https://example.org/subtitles.vtt");
  });

  it("beendet aktive Aufträge beim Abbrechen ohne eine fertige Datei zu melden", async () => {
    await job("cancel");
    blocked.add("/cancel.mp4");
    const processing = startDownloadProcessing();
    await vi.waitFor(() => expect(requests).toEqual(["/cancel.mp4"]));
    expect(await controlDownload("cancel", "cancel")).toBe(true);
    await processing;
    expect(await prisma.download.findUnique({ where: { id: "cancel" } })).toMatchObject({
      status: "cancelled",
      filePath: null,
    });
    expect(await controlDownload("cancel", "resume")).toBe(false);
  });

  it.each(["pause", "cancel"] as const)(
    "meldet %s während des abschließenden Verschiebens nicht fälschlich als erfolgreich",
    async (action) => {
      await job("finalizing");
      const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
      let releaseMove = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseMove = resolve;
      });
      let moving = false;
      vi.mocked(fsp.rename).mockImplementationOnce(async (sourcePath, targetPath) => {
        moving = true;
        await gate;
        await actual.rename(sourcePath, targetPath);
      });
      const processing = startDownloadProcessing();
      try {
        await vi.waitFor(() => expect(moving).toBe(true));
        const controlled = controlDownload("finalizing", action);
        releaseMove();
        expect(await controlled).toBe(false);
        await processing;
        const finished = await prisma.download.findUniqueOrThrow({ where: { id: "finalizing" } });
        expect(finished.status).toBe("completed");
        expect(await readFile(finished.filePath!)).toEqual(bytes);
      } finally {
        releaseMove();
        await processing;
      }
    }
  );

  it.each(
    (
      [
        ["/api", true, getApi],
        ["/api", false, getApi],
        ["/api/download", true, getDownloadApi],
        ["/api/download", false, getDownloadApi],
      ] as const
    ).flatMap(([endpoint, delFiles, get]) =>
      ["move", "subtitles"].map((stage) => ({ endpoint, delFiles, get, stage }))
    )
  )(
    "deletes settled video/subtitle files via $endpoint during $stage (delete files: $delFiles)",
    async ({ endpoint, delFiles, get, stage }) => {
      const id = `history-finalizing-${endpoint === "/api" ? "root" : "download"}-${delFiles}-${stage}`;
      await enableSubtitles();
      await job(id, undefined, { mediaMetadata });
      const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
      let releaseMove = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseMove = resolve;
      });
      let publishedPath = "";
      let finalizationBlocked = false;
      vi.mocked(fsp.rename).mockImplementationOnce(async (sourcePath, targetPath) => {
        publishedPath = String(targetPath);
        if (stage === "move") {
          finalizationBlocked = true;
          await gate;
        }
        await actual.rename(sourcePath, targetPath);
      });
      fetchSubtitle.mockImplementationOnce(async () => {
        if (stage === "subtitles") {
          finalizationBlocked = true;
          await gate;
        }
        return subtitleText;
      });
      const abort = vi.spyOn(AbortController.prototype, "abort");
      const processing = startDownloadProcessing();
      let deletion: ReturnType<typeof get> | undefined;
      try {
        await vi.waitFor(() => expect(finalizationBlocked).toBe(true));
        expect(await prisma.download.findUnique({ where: { id } })).toMatchObject({
          status: "downloading",
          filePath: null,
        });
        deletion = get(
          new NextRequest(
            `http://localhost${endpoint}?mode=history&name=delete&value=${id}&del_files=${delFiles ? 1 : 0}`
          )
        );
        // Keep publication blocked until the delete request has read the active
        // record and requested cancellation. Completion then wins this race.
        await vi.waitFor(() => expect(abort).toHaveBeenCalledWith("cancel"));
        releaseMove();
        const response = await deletion;
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: true });
        await processing;
        expect(await prisma.download.findUnique({ where: { id } })).toBeNull();
        const sidecarPath = publishedPath.replace(/\.mp4$/, ".srt");
        if (delFiles) {
          await expect(fsp.access(publishedPath)).rejects.toMatchObject({ code: "ENOENT" });
          await expect(fsp.access(sidecarPath)).rejects.toMatchObject({ code: "ENOENT" });
          await expect(fsp.access(dirname(publishedPath))).rejects.toMatchObject({
            code: "ENOENT",
          });
        } else {
          expect(await readFile(publishedPath)).toEqual(bytes);
          expect(await readFile(sidecarPath, "utf8")).toContain("Subtitle");
        }
      } finally {
        releaseMove();
        await processing;
        await deletion;
        abort.mockRestore();
      }
    }
  );

  it.each(["pause", "cancel"] as const)(
    "reports completed output when %s arrives during subtitle finalization",
    async (action) => {
      const id = `subtitle-finalizing-${action}`;
      await enableSubtitles();
      await job(id, undefined, { mediaMetadata });
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started = false;
      fetchSubtitle.mockImplementationOnce(async () => {
        started = true;
        await gate;
        return subtitleText;
      });
      const abort = vi.spyOn(AbortController.prototype, "abort");
      const processing = startDownloadProcessing();
      let controlled: Promise<boolean> | undefined;
      try {
        await vi.waitFor(() => expect(started).toBe(true));
        controlled = controlDownload(id, action);
        await vi.waitFor(() => expect(abort).toHaveBeenCalledWith(action));
        release();
        expect(await controlled).toBe(false);
        await processing;
        const finished = await prisma.download.findUniqueOrThrow({
          where: { id },
        });
        expect(finished.status).toBe("completed");
        expect(finished.warning).toBeNull();
        expect(await readFile(finished.filePath!)).toEqual(bytes);
        expect(await readFile(JSON.parse(finished.subtitleArtifact!).path, "utf8")).toContain(
          "Subtitle"
        );
      } finally {
        release();
        await processing;
        await controlled;
        abort.mockRestore();
      }
    }
  );

  it.each(["failed", "cancelled"])(
    "preserves subtitle metadata when retrying a %s download",
    async (status) => {
      await enableSubtitles();
      await job("manual-retry", undefined, { status, mediaMetadata });
      const retried = await retryDownload("manual-retry");
      expect(retried).not.toBeNull();
      await startDownloadProcessing();
      const finished = await prisma.download.findUniqueOrThrow({ where: { id: retried!.id } });
      expect(finished.status).toBe("completed");
      expect(finished.mediaMetadata).toBe(mediaMetadata);
      expect(await readFile(JSON.parse(finished.subtitleArtifact!).path, "utf8")).toContain(
        "Subtitle"
      );
      expect(await prisma.download.findUnique({ where: { id: "manual-retry" } })).toBeNull();
    }
  );

  it("plant HTTP 503 erneut ein, begrenzt Versuche und wiederholt HTTP 404 nicht", async () => {
    await enableSubtitles();
    await job("retry", "/retry.mp4", { mediaMetadata });
    await job("exhausted", "/unavailable.mp4");
    await job("missing", "/missing.mp4");
    await startDownloadProcessing();
    const retry = await prisma.download.findUniqueOrThrow({ where: { id: "retry" } });
    expect(retry.status).toBe("queued");
    expect(retry.attempts).toBe(1);
    expect(retry.nextRetryAt!.getTime()).toBeGreaterThan(Date.now() + 25000);
    expect(retry.mediaMetadata).toBe(mediaMetadata);
    expect(fetchSubtitle).not.toHaveBeenCalled();
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
      mediaMetadata,
      subtitleArtifact: expect.any(String),
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
      expect((await prisma.download.findUnique({ where: { id: "defekt" } }))?.status).toBe(
        "queued"
      );
      expect(requests).toEqual(["/ok.mp4"]);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER block_job");
    }
  });
});
