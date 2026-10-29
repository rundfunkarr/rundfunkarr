import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import * as path from "node:path";

const { spawn, access, mkdir, unlink, rename, chmod, rm, readdir, pipeline } = vi.hoisted(() => ({
  spawn: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  chmod: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  readdir: vi.fn(),
  pipeline: vi.fn(async () => undefined),
}));
vi.mock("child_process", () => ({ spawn }));
vi.mock("fs/promises", () => ({ access, mkdir, unlink, rename, chmod, rm, readdir }));
vi.mock("fs", () => ({ createWriteStream: vi.fn(() => ({})) }));
vi.mock("stream/promises", () => ({ pipeline }));

import { convertMp4ToMkv, ensureFfmpegExists, getFfmpegPath, mergeVideoAudio } from "./ffmpeg";

type FakeProcess = EventEmitter & { stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
let processes: FakeProcess[];
const ffmpegPath = getFfmpegPath();
const fetchMock = vi.fn();

function dirent(name: string, directory = false) {
  return { name, isDirectory: () => directory };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation(() => {});
  processes = [];
  spawn.mockImplementation(() => {
    const proc = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    processes.push(proc);
    return proc;
  });
  access.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function nextProcess(index = 0): Promise<FakeProcess> {
  await vi.waitFor(() => expect(processes.length).toBeGreaterThan(index));
  return processes[index];
}

describe("ensureFfmpegExists", () => {
  it("uses an existing binary next to the app without downloading", async () => {
    expect(ffmpegPath).toBe(path.join(process.cwd(), "ffmpeg", "ffmpeg"));
    expect(await ensureFfmpegExists()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads, extracts and installs a static build when the binary is missing", async () => {
    access.mockRejectedValueOnce(new Error("ENOENT")).mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(new Response("archive"));
    const extracted = path.join(process.cwd(), "ffmpeg", "extracted");
    readdir.mockImplementation(async (dir: string) =>
      dir === extracted
        ? [dirent("ffmpeg-7.0-amd64-static", true)]
        : [dirent("readme.txt"), dirent("ffprobe"), dirent("ffmpeg")]
    );

    const result = ensureFfmpegExists();
    const tar = await nextProcess();
    expect(spawn).toHaveBeenCalledWith("tar", [
      "-xf",
      path.join(process.cwd(), "ffmpeg.tar.xz"),
      "-C",
      extracted,
    ]);
    tar.emit("close", 0);

    expect(await result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("amd64-static.tar.xz"));
    expect(rename).toHaveBeenCalledWith(
      path.join(extracted, "ffmpeg-7.0-amd64-static", "ffmpeg"),
      ffmpegPath
    );
    expect(chmod).toHaveBeenCalledWith(ffmpegPath, 0o755);
    expect(rm).toHaveBeenCalledWith(extracted, { recursive: true, force: true });
    // The downloaded archive is always removed.
    expect(unlink).toHaveBeenCalledWith(path.join(process.cwd(), "ffmpeg.tar.xz"));
  });

  it("reports failure when the download fails and still cleans up", async () => {
    access.mockRejectedValue(new Error("ENOENT"));
    fetchMock.mockResolvedValue(new Response(null, { status: 404, statusText: "Not Found" }));

    expect(await ensureFfmpegExists()).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(unlink).toHaveBeenCalled();
  });

  it("reports failure when tar exits with an error", async () => {
    access.mockRejectedValue(new Error("ENOENT"));
    fetchMock.mockResolvedValue(new Response("archive"));

    const result = ensureFfmpegExists();
    (await nextProcess()).emit("close", 2);

    expect(await result).toBe(false);
    expect(rename).not.toHaveBeenCalled();
  });

  it("reports failure when the archive contains no ffmpeg binary", async () => {
    access.mockRejectedValue(new Error("ENOENT"));
    fetchMock.mockResolvedValue(new Response("archive"));
    readdir.mockResolvedValue([dirent("ffprobe")]);

    const result = ensureFfmpegExists();
    (await nextProcess()).emit("close", 0);

    // Extraction succeeds, but the final access check still fails.
    expect(await result).toBe(false);
    expect(rename).not.toHaveBeenCalled();
  });
});

describe("convertMp4ToMkv", () => {
  it("stream-copies video and audio, reports progress and deletes the source", async () => {
    const progress: number[] = [];

    const result = convertMp4ToMkv("/media/in.mp4", "/media/out.mkv", (p) => progress.push(p));
    const proc = await nextProcess();
    expect(spawn).toHaveBeenCalledWith(
      ffmpegPath,
      ["-i", "/media/in.mp4", "-map", "0:v", "-map", "0:a?", "-c", "copy", "-y", "/media/out.mkv"],
      expect.anything()
    );
    proc.stderr.emit("data", Buffer.from("  Duration: 00:45:00.00, start: 0\n"));
    proc.stderr.emit("data", Buffer.from("frame=1 time=00:11:15.00 bitrate=1\n"));
    proc.stderr.emit("data", Buffer.from("frame=2 time=00:45:30.00 bitrate=1\n"));
    proc.emit("close", 0);

    expect(await result).toEqual({ success: true, outputPath: "/media/out.mkv" });
    expect(progress).toEqual([25, 100]);
    expect(unlink).toHaveBeenCalledWith("/media/in.mp4");
  });

  it("still succeeds when the source file cannot be deleted", async () => {
    unlink.mockRejectedValueOnce(new Error("EBUSY"));

    const result = convertMp4ToMkv("/media/in.mp4", "/media/out.mkv");
    (await nextProcess()).emit("close", 0);

    expect((await result).success).toBe(true);
  });

  it("keeps the source and reports the exit code when ffmpeg fails", async () => {
    const result = convertMp4ToMkv("/media/in.mp4", "/media/out.mkv");
    const proc = await nextProcess();
    proc.stderr.emit("data", Buffer.from("Invalid data found when processing input"));
    proc.emit("close", 1);

    expect(await result).toEqual({ success: false, error: "FFmpeg exited with code 1" });
    expect(unlink).not.toHaveBeenCalled();
  });

  it("reports spawn errors", async () => {
    const result = convertMp4ToMkv("/media/in.mp4", "/media/out.mkv");
    (await nextProcess()).emit("error", new Error("spawn EACCES"));

    expect(await result).toEqual({ success: false, error: "spawn EACCES" });
  });

  it("does not start ffmpeg for a missing source file", async () => {
    access.mockImplementation(async (file: string) => {
      if (file === "/media/missing.mp4") throw new Error("ENOENT");
    });

    expect(await convertMp4ToMkv("/media/missing.mp4", "/media/out.mkv")).toEqual({
      success: false,
      error: "Source file not found: /media/missing.mp4",
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("fails cleanly when ffmpeg is unavailable", async () => {
    access.mockRejectedValue(new Error("ENOENT"));
    fetchMock.mockRejectedValue(new Error("offline"));

    expect(await convertMp4ToMkv("/media/in.mp4", "/media/out.mkv")).toEqual({
      success: false,
      error: "FFmpeg not available",
    });
  });

  it("terminates ffmpeg when the download is cancelled", async () => {
    const controller = new AbortController();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

    const result = convertMp4ToMkv("/media/in.mp4", "/media/out.mkv", undefined, controller.signal);
    const proc = await nextProcess();
    Object.assign(proc, { pid: 4242 });
    controller.abort();
    proc.emit("close", null);

    expect(await result).toEqual({ success: false, error: "FFmpeg exited with code null" });
    if (process.platform !== "win32") expect(kill).toHaveBeenCalledWith(-4242, "SIGKILL");
  });
});

describe("mergeVideoAudio", () => {
  it("maps the first video and first audio stream without re-encoding", async () => {
    const result = mergeVideoAudio("/tmp/v.mp4", "/tmp/a.m4a", "/media/out.mkv");
    (await nextProcess()).emit("close", 0);

    expect(await result).toEqual({ success: true, outputPath: "/media/out.mkv" });
    expect(spawn.mock.calls[0][1]).toEqual([
      "-i",
      "/tmp/v.mp4",
      "-i",
      "/tmp/a.m4a",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c",
      "copy",
      "-y",
      "/media/out.mkv",
    ]);
  });

  it("includes ffmpeg's error output on failure", async () => {
    const result = mergeVideoAudio("/tmp/v.mp4", "/tmp/a.m4a", "/media/out.mkv");
    const proc = await nextProcess();
    proc.stderr.emit("data", Buffer.from("Stream map '1:a:0' matches no streams."));
    proc.emit("close", 1);

    expect(await result).toEqual({
      success: false,
      error: "FFmpeg exited with code 1: Stream map '1:a:0' matches no streams.",
    });
  });

  it("reports spawn errors and a missing ffmpeg", async () => {
    const result = mergeVideoAudio("/tmp/v.mp4", "/tmp/a.m4a", "/media/out.mkv");
    (await nextProcess()).emit("error", new Error("spawn ENOENT"));
    expect(await result).toEqual({ success: false, error: "spawn ENOENT" });

    access.mockRejectedValue(new Error("ENOENT"));
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await mergeVideoAudio("/tmp/v.mp4", "/tmp/a.m4a", "/media/out.mkv")).toEqual({
      success: false,
      error: "FFmpeg not available",
    });
  });
});
