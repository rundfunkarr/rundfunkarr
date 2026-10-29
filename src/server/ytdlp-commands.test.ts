import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import * as path from "node:path";

const BINARY = Buffer.from("fake yt-dlp binary");

const { spawn, access, mkdir, writeFile, rename, unlink, settings, ensureFfmpegExists } =
  vi.hoisted(() => ({
    spawn: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    settings: new Map<string, string>(),
    ensureFfmpegExists: vi.fn(async () => true),
  }));
vi.mock("child_process", () => ({ spawn }));
vi.mock("fs/promises", () => ({ access, mkdir, writeFile, rename, unlink }));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
}));
vi.mock("./ffmpeg", () => ({ ensureFfmpegExists, getFfmpegPath: () => "/fixture/ffmpeg" }));
vi.mock("./ytdlp-release.json", () => {
  const sha = createHash("sha256").update(Buffer.from("fake yt-dlp binary")).digest("hex");
  const assets = [
    "yt-dlp.exe",
    "yt-dlp_macos",
    "yt-dlp_linux",
    "yt-dlp_linux_aarch64",
    "yt-dlp_musllinux",
    "yt-dlp_musllinux_aarch64",
  ];
  return {
    default: { version: "2026.01.01", sha256: Object.fromEntries(assets.map((a) => [a, sha])) },
  };
});

import {
  downloadVideo,
  ensureYtdlpExists,
  extractPlaylistEntries,
  getDetailedVideoInfo,
  getVideoInfo,
  getYtdlpPath,
  testProxy,
  testYtdlp,
} from "./ytdlp";

type FakeProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};
let processes: FakeProcess[];
const fetchMock = vi.fn();

async function nextProcess(index = 0): Promise<FakeProcess> {
  await vi.waitFor(() => expect(processes.length).toBeGreaterThan(index));
  return processes[index];
}

function finish(proc: FakeProcess, code: number, stdout = "", stderr = "") {
  if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
  if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
  proc.emit("close", code);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation(() => {});
  settings.clear();
  settings.set("download.ytdlpPath", "/fixture/yt-dlp");
  access.mockResolvedValue(undefined);
  ensureFfmpegExists.mockResolvedValue(true);
  processes = [];
  spawn.mockImplementation(() => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    processes.push(proc);
    return proc;
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ensureYtdlpExists", () => {
  it("accepts an existing custom binary", async () => {
    expect(await ensureYtdlpExists()).toBe(true);
    expect(access).toHaveBeenCalledWith("/fixture/yt-dlp");
  });

  it("does not download anything when a configured custom path is missing", async () => {
    access.mockRejectedValue(new Error("ENOENT"));

    expect(await ensureYtdlpExists()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("installs the pinned release after verifying its checksum and shares concurrent installs", async () => {
    settings.delete("download.ytdlpPath");
    access.mockRejectedValue(new Error("ENOENT"));
    fetchMock.mockResolvedValue(new Response(BINARY));

    const [first, second] = await Promise.all([ensureYtdlpExists(), ensureYtdlpExists()]);

    expect(first && second).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(
      /^https:\/\/github\.com\/yt-dlp\/yt-dlp\/releases\/download\/2026\.01\.01\/yt-dlp/
    );
    expect(writeFile).toHaveBeenCalledWith(`${getYtdlpPath()}.tmp`, BINARY, { mode: 0o755 });
    expect(rename).toHaveBeenCalledWith(`${getYtdlpPath()}.tmp`, getYtdlpPath());
    expect(getYtdlpPath()).toBe(
      path.join(process.cwd(), "ytdlp", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp")
    );
  });

  it("rejects a binary with a wrong checksum and removes the temporary file", async () => {
    settings.delete("download.ytdlpPath");
    access.mockRejectedValue(new Error("ENOENT"));
    fetchMock.mockResolvedValue(new Response("tampered"));

    expect(await ensureYtdlpExists()).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(unlink).toHaveBeenCalledWith(`${getYtdlpPath()}.tmp`);
  });

  it("reports a failed release download", async () => {
    settings.delete("download.ytdlpPath");
    access.mockRejectedValue(new Error("ENOENT"));
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    expect(await ensureYtdlpExists()).toBe(false);
  });
});

describe("getVideoInfo / getDetailedVideoInfo", () => {
  const info = {
    id: "abc",
    title: "Tatort: Borowski",
    duration: 5400,
    webpage_url: "https://www.ardmediathek.de/video/abc",
    filesize_approx: 123,
    thumbnails: [{ url: "https://img/1.jpg" }],
    uploader: "Das Erste",
    season_number: 2,
    formats: [{ format_id: "hd", ext: "mp4", height: 1080, filesize_approx: 9, url: "u" }],
  };

  it("passes the proxy and maps metadata with sensible fallbacks", async () => {
    settings.set("download.proxyUrl", " socks5://proxy.local:1080 ");

    const pending = getVideoInfo("https://www.ardmediathek.de/video/abc");
    finish(await nextProcess(), 0, JSON.stringify(info));

    expect(spawn).toHaveBeenCalledWith("/fixture/yt-dlp", [
      "--dump-json",
      "--no-warnings",
      "--no-playlist",
      "--proxy",
      "socks5://proxy.local:1080",
      "https://www.ardmediathek.de/video/abc",
    ]);
    expect(await pending).toEqual({
      id: "abc",
      title: "Tatort: Borowski",
      description: "",
      duration: 5400,
      url: "https://www.ardmediathek.de/video/abc",
      ext: "mp4",
      filesize: 123,
      formats: [
        {
          format_id: "hd",
          ext: "mp4",
          resolution: undefined,
          height: 1080,
          width: undefined,
          filesize: 9,
          url: "u",
        },
      ],
    });
  });

  it("returns the richer detail set including channel fallbacks", async () => {
    const pending = getDetailedVideoInfo("https://on.orf.at/video/1");
    finish(await nextProcess(), 0, JSON.stringify(info));

    expect(await pending).toMatchObject({
      thumbnail: "https://img/1.jpg",
      channel: "Das Erste",
      uploader: "Das Erste",
      series: "",
      season_number: 2,
      upload_date: "",
    });
  });

  it.each([
    ["getVideoInfo", getVideoInfo],
    ["getDetailedVideoInfo", getDetailedVideoInfo],
  ] as const)("%s returns null on failures, invalid JSON and spawn errors", async (_name, fn) => {
    let pending = fn("https://x");
    finish(await nextProcess(0), 1, "", "ERROR: Unsupported URL");
    expect(await pending).toBeNull();

    pending = fn("https://x");
    finish(await nextProcess(1), 0, "{not json");
    expect(await pending).toBeNull();

    pending = fn("https://x");
    (await nextProcess(2)).emit("error", new Error("spawn ENOENT"));
    expect(await pending).toBeNull();
  });

  it.each([
    ["getVideoInfo", getVideoInfo],
    ["getDetailedVideoInfo", getDetailedVideoInfo],
  ] as const)("%s kills yt-dlp after 30 seconds", async (_name, fn) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = fn("https://x");
    const proc = await nextProcess();

    vi.advanceTimersByTime(30_000);

    expect(await pending).toBeNull();
    expect(proc.kill).toHaveBeenCalled();
    // A late close after the timeout must not resolve twice or throw.
    proc.emit("close", 0);
  });

  it("returns null without spawning when yt-dlp is unavailable", async () => {
    access.mockRejectedValue(new Error("ENOENT"));

    expect(await getVideoInfo("https://x")).toBeNull();
    expect(await getDetailedVideoInfo("https://x")).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects proxy URLs with unsupported protocols", async () => {
    settings.set("download.proxyUrl", "ftp://proxy.local");

    await expect(getVideoInfo("https://x")).rejects.toThrow("Unsupported proxy protocol");
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("extractPlaylistEntries", () => {
  it("parses one JSON object per line and skips invalid lines", async () => {
    const pending = extractPlaylistEntries("https://www.srf.ch/play/tv/sendung/x", 5);
    const proc = await nextProcess();
    finish(
      proc,
      0,
      [
        JSON.stringify({ id: "1", title: "Folge 1", url: "https://a", uploader: "SRF 1" }),
        "",
        "garbage",
        JSON.stringify({ id: "2", webpage_url: "https://b", thumbnails: [{ url: "t.jpg" }] }),
      ].join("\n")
    );

    expect(spawn.mock.calls[0][1]).toEqual([
      "--flat-playlist",
      "--dump-json",
      "--no-warnings",
      "--playlist-end",
      "5",
      "https://www.srf.ch/play/tv/sendung/x",
    ]);
    const entries = await pending;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: "1", url: "https://a", channel: "SRF 1", duration: 0 });
    expect(entries[1]).toMatchObject({ id: "2", title: "", url: "https://b", thumbnail: "t.jpg" });
  });

  it("returns an empty list on failure, spawn errors and timeouts", async () => {
    let pending = extractPlaylistEntries("https://x");
    finish(await nextProcess(0), 1, "", "ERROR: 404");
    expect(await pending).toEqual([]);

    pending = extractPlaylistEntries("https://x");
    (await nextProcess(1)).emit("error", new Error("spawn ENOENT"));
    expect(await pending).toEqual([]);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    pending = extractPlaylistEntries("https://x");
    const slow = await nextProcess(2);
    vi.advanceTimersByTime(60_000);
    expect(await pending).toEqual([]);
    expect(slow.kill).toHaveBeenCalled();
  });

  it("returns an empty list when yt-dlp is unavailable", async () => {
    access.mockRejectedValue(new Error("ENOENT"));

    expect(await extractPlaylistEntries("https://x")).toEqual([]);
  });
});

describe("testYtdlp / testProxy", () => {
  it("reports the yt-dlp version", async () => {
    const pending = testYtdlp();
    finish(await nextProcess(), 0, "2026.08.19\n");

    expect(await pending).toEqual({ success: true, version: "2026.08.19" });
    expect(spawn).toHaveBeenCalledWith("/fixture/yt-dlp", ["--version"]);
  });

  it("reports yt-dlp failures", async () => {
    let pending = testYtdlp();
    finish(await nextProcess(0), 1, "", "boom");
    expect(await pending).toEqual({ success: false, error: "boom" });

    pending = testYtdlp();
    finish(await nextProcess(1), 2);
    expect(await pending).toEqual({ success: false, error: "Exit code 2" });

    pending = testYtdlp();
    (await nextProcess(2)).emit("error", new Error("EACCES"));
    expect(await pending).toEqual({ success: false, error: "EACCES" });

    access.mockRejectedValue(new Error("ENOENT"));
    expect(await testYtdlp()).toEqual({ success: false, error: "yt-dlp not available" });
  });

  it("requires a configured proxy", async () => {
    expect(await testProxy()).toEqual({ success: false, error: "No proxy configured" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("simulates a request through the proxy", async () => {
    settings.set("download.proxyUrl", "http://proxy.local:3128");

    const pending = testProxy("https://www.srf.ch/play");
    finish(await nextProcess(), 0);

    expect(await pending).toEqual({ success: true });
    expect(spawn).toHaveBeenCalledWith("/fixture/yt-dlp", [
      "--proxy",
      "http://proxy.local:3128",
      "--simulate",
      "--no-warnings",
      "https://www.srf.ch/play",
    ]);
  });

  it("reports proxy failures, spawn errors and timeouts", async () => {
    settings.set("download.proxyUrl", "http://proxy.local:3128");

    let pending = testProxy();
    finish(await nextProcess(0), 1);
    expect(await pending).toEqual({ success: false, error: "Connection failed (code 1)" });

    pending = testProxy();
    (await nextProcess(1)).emit("error", new Error("spawn ENOENT"));
    expect(await pending).toEqual({ success: false, error: "spawn ENOENT" });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    pending = testProxy();
    const slow = await nextProcess(2);
    vi.advanceTimersByTime(30_000);
    expect(await pending).toEqual({ success: false, error: "Connection timeout" });
    expect(slow.kill).toHaveBeenCalled();
  });

  it("reports a missing yt-dlp before testing the proxy", async () => {
    settings.set("download.proxyUrl", "http://proxy.local:3128");
    access.mockRejectedValue(new Error("ENOENT"));

    expect(await testProxy()).toEqual({ success: false, error: "yt-dlp not available" });
  });
});

describe("downloadVideo", () => {
  it("builds yt-dlp arguments with ffmpeg location, default format, container and proxy", async () => {
    settings.set("download.proxyUrl", "http://proxy.local:3128");

    const pending = downloadVideo("https://x/master.m3u8", { outputPath: "/dl/show/ep.mkv" });
    finish(await nextProcess(), 0);

    expect(mkdir).toHaveBeenCalledWith("/dl/show", { recursive: true });
    expect(spawn.mock.calls[0][1]).toEqual([
      "--ffmpeg-location",
      "/fixture/ffmpeg",
      "-o",
      "/dl/show/ep.mkv",
      "--no-playlist",
      "--no-warnings",
      "--progress",
      "--newline",
      "-f",
      "bestvideo+bestaudio/best",
      "--merge-output-format",
      "mkv",
      "--remux-video",
      "mkv",
      "--proxy",
      "http://proxy.local:3128",
      "https://x/master.m3u8",
    ]);
    expect(await pending).toEqual({ success: true, outputPath: "/dl/show/ep.mkv" });
  });

  it("skips the proxy when useProxy is false", async () => {
    settings.set("download.proxyUrl", "http://proxy.local:3128");

    const pending = downloadVideo("https://x", {
      outputPath: "/dl/ep.mp4",
      useProxy: false,
      container: "mp4",
      format: "best",
    });
    finish(await nextProcess(), 0);
    await pending;

    const args: string[] = spawn.mock.calls[0][1];
    expect(args).not.toContain("--proxy");
    expect(args[args.indexOf("-f") + 1]).toBe("best");
    expect(args[args.indexOf("--merge-output-format") + 1]).toBe("mp4");
  });

  it("finds the remuxed file under the container extension, else the original path", async () => {
    access.mockImplementation(async (file: string) => {
      if (file === "/dl/ep.mkv") throw new Error("ENOENT");
    });

    const pending = downloadVideo("https://x", { outputPath: "/dl/ep.ts" });
    finish(await nextProcess(), 0);

    expect(await pending).toEqual({ success: true, outputPath: "/dl/ep.ts" });
  });

  it("fails when yt-dlp exits successfully but produced no file", async () => {
    access.mockImplementation(async (file: string) => {
      if (file.startsWith("/dl/")) throw new Error("ENOENT");
    });

    const pending = downloadVideo("https://x", { outputPath: "/dl/ep.mkv" });
    finish(await nextProcess(), 0);

    expect(await pending).toEqual({
      success: false,
      error: "Output file not found after download",
    });
  });

  it("reports the exit code when yt-dlp fails silently", async () => {
    const pending = downloadVideo("https://x", { outputPath: "/dl/ep.mkv" });
    finish(await nextProcess(), 1);

    expect(await pending).toEqual({ success: false, error: "Exit code 1" });
  });

  it("does not start without yt-dlp or ffmpeg", async () => {
    ensureFfmpegExists.mockResolvedValueOnce(false);
    expect(await downloadVideo("https://x", { outputPath: "/dl/ep.mkv" })).toEqual({
      success: false,
      error: "FFmpeg not available for stream remuxing",
    });

    access.mockRejectedValue(new Error("ENOENT"));
    expect(await downloadVideo("https://x", { outputPath: "/dl/ep.mkv" })).toEqual({
      success: false,
      error: "yt-dlp not available",
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("parses progress lines with and without approximate sizes", async () => {
    const progress: Array<[number, string, string]> = [];
    const pending = downloadVideo("https://x", {
      outputPath: "/dl/ep.mkv",
      onProgress: (percent, speed, eta) => {
        progress.push([percent, speed, eta]);
      },
    });
    const proc = await nextProcess();
    proc.stdout.emit(
      "data",
      Buffer.from("[download]  45.2% of ~500.00MiB at 10.50MiB/s ETA 00:25\n")
    );
    proc.stdout.emit(
      "data",
      Buffer.from("[download]  22.3% of ~   2.05GiB at   11.91MiB/s ETA 02:19\n")
    );
    proc.stdout.emit("data", Buffer.from("[download] Destination: /dl/ep.mkv\n"));
    finish(proc, 0);
    await pending;

    expect(progress).toEqual([
      [45.2, "10.50MiB/s", "00:25"],
      [22.3, "11.91MiB/s", "02:19"],
    ]);
  });
});
