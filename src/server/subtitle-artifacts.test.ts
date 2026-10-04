import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";

const { getSetting, findUnique, deleteDownload, spawn, ffmpegAvailable, fetchSubtitle } =
  vi.hoisted(() => ({
    getSetting: vi.fn(),
    findUnique: vi.fn(),
    deleteDownload: vi.fn(),
    spawn: vi.fn(),
    ffmpegAvailable: vi.fn(),
    fetchSubtitle: vi.fn(),
  }));
vi.mock("./subtitle-fetch", () => ({ fetchSubtitle }));
vi.mock("@/lib/settings", () => ({ getSetting }));
vi.mock("@/lib/db", () => ({
  prisma: { download: { findUnique, delete: deleteDownload } },
}));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("./ffmpeg", () => ({
  ensureFfmpegExists: ffmpegAvailable,
  getFfmpegPath: () => "ffmpeg",
}));

import { processSubtitles } from "./subtitles";
import { deleteHistoryItem } from "@/services/download";

const metadata = JSON.stringify({ subtitleUrl: "https://example.org/subtitles.vtt" });
let directory: string;
let video: string;

beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(path.join(tmpdir(), "rundfunkarr-subtitle-artifacts-"));
  video = path.join(directory, "A.mkv");
  await writeFile(video, "completed video");
  getSetting.mockResolvedValue("sidecar");
  ffmpegAvailable.mockResolvedValue(false);
  fetchSubtitle.mockReset().mockResolvedValue("WEBVTT\n\n00:01.000 --> 00:02.000\nSubtitle\n");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

describe("subtitle artifact ownership", () => {
  it.each(["A.subtitles.mkv", "A.srt.tmp"])(
    "preserves an unrelated %s when fetching subtitles fails",
    async (filename) => {
      const unrelated = path.join(directory, filename);
      await writeFile(unrelated, "unrelated file");
      fetchSubtitle.mockRejectedValueOnce(new Error("Untertitelabruf fehlgeschlagen (HTTP 503)."));

      await processSubtitles(video, metadata);

      await expect(readFile(unrelated, "utf8")).resolves.toBe("unrelated file");
      await expect(readFile(video, "utf8")).resolves.toBe("completed video");
    }
  );

  it("does not replace a sidecar created by another download", async () => {
    const unrelated = path.join(directory, "A.srt");
    await writeFile(unrelated, "existing subtitles");

    const result = await processSubtitles(video, metadata);

    await expect(readFile(unrelated, "utf8")).resolves.toBe("existing subtitles");
    expect(result.warning).toContain("nicht überschrieben");
    expect(result.artifact).toBeNull();
    expect((await readdir(directory)).sort()).toEqual(["A.mkv", "A.srt"]);
  });

  it("does not infer sidecar ownership from a subtitle URL when deleting history", async () => {
    const unrelated = path.join(directory, "A.srt");
    await writeFile(unrelated, "existing subtitles");
    findUnique.mockResolvedValue({
      id: "download",
      filePath: video,
      mediaMetadata: metadata,
      subtitleArtifact: null,
    });

    await deleteHistoryItem("download", true);

    await expect(readFile(unrelated, "utf8")).resolves.toBe("existing subtitles");
  });

  it.each(["sidecar", "embed"])("records and deletes its own SRT in %s mode", async (mode) => {
    getSetting.mockResolvedValue(mode);
    const result = await processSubtitles(video, metadata);
    const sidecar = path.join(directory, "A.srt");
    expect(result.artifact?.path).toBe(sidecar);
    expect(result.warning).toEqual(mode === "embed" ? expect.stringContaining("FFmpeg") : null);
    await expect(readFile(sidecar, "utf8")).resolves.toContain("Subtitle");
    expect((await readdir(directory)).sort()).toEqual(["A.mkv", "A.srt"]);
    findUnique.mockResolvedValue({
      filePath: video,
      subtitleArtifact: JSON.stringify(result.artifact),
    });

    await deleteHistoryItem("download", false);
    await expect(access(sidecar)).resolves.toBeUndefined();
    await deleteHistoryItem("download", true);
    await expect(access(sidecar)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(video)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["replace", "modify", "symlink"])(
    "preserves a previously owned SRT after a %s operation",
    async (operation) => {
      const result = await processSubtitles(video, metadata);
      const sidecar = path.join(directory, "A.srt");
      const replacement = path.join(directory, "replacement.srt");
      await writeFile(replacement, "another download");
      if (operation === "replace") await rename(replacement, sidecar);
      else if (operation === "modify") await writeFile(sidecar, "another download");
      else {
        await rm(sidecar);
        await symlink(replacement, sidecar);
      }
      findUnique.mockResolvedValue({
        filePath: video,
        subtitleArtifact: JSON.stringify(result.artifact),
      });

      await deleteHistoryItem("download", true);

      await expect(readFile(sidecar, "utf8")).resolves.toBe("another download");
    }
  );

  it("embeds via its own temporary directory and preserves existing sibling files", async () => {
    getSetting.mockResolvedValue("embed");
    ffmpegAvailable.mockResolvedValue(true);
    for (const name of ["A.subtitles.mkv", "A.srt", "A.srt.tmp"])
      await writeFile(path.join(directory, name), "unrelated file");
    spawn.mockImplementation((_binary: string, args: string[]) => {
      const proc = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: vi.fn() });
      setImmediate(() => {
        void writeFile(args.at(-1)!, "video with subtitles")
          .then(() => proc.emit("close", 0))
          .catch((error) => proc.emit("error", error));
      });
      return proc;
    });

    expect(await processSubtitles(video, metadata)).toEqual({ warning: null, artifact: null });

    await expect(readFile(video, "utf8")).resolves.toBe("video with subtitles");
    for (const name of ["A.subtitles.mkv", "A.srt", "A.srt.tmp"])
      await expect(readFile(path.join(directory, name), "utf8")).resolves.toBe("unrelated file");
    expect((await readdir(directory)).sort()).toEqual([
      "A.mkv",
      "A.srt",
      "A.srt.tmp",
      "A.subtitles.mkv",
    ]);
  });
});
