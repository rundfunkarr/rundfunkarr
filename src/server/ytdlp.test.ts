import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { downloadHlsStream, downloadVideo } from "./ytdlp";

const { spawn, mergeVideoAudio, unlink, readdir, getSetting } = vi.hoisted(() => ({
  spawn: vi.fn(),
  mergeVideoAudio: vi.fn(
    async (
      _video: string,
      _audio: string,
      outputPath: string
    ): Promise<{ success: boolean; outputPath?: string; error?: string }> => ({
      success: true,
      outputPath,
    })
  ),
  unlink: vi.fn(async () => {}),
  readdir: vi.fn(async (): Promise<string[]> => []),
  getSetting: vi.fn(async (key: string) =>
    key === "download.ytdlpPath" ? "/fixture/yt-dlp" : null
  ),
}));
vi.mock("child_process", () => ({ spawn }));
vi.mock("./ffmpeg", () => ({
  ensureFfmpegExists: vi.fn(async () => true),
  getFfmpegPath: () => "/fixture/ffmpeg",
  mergeVideoAudio,
}));
vi.mock("fs/promises", () => ({
  access: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  unlink,
  readdir,
}));
vi.mock("@/lib/settings", () => ({ getSetting }));

let child: EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  spawn.mockReset();
  spawn.mockReturnValue(child);
  mergeVideoAudio.mockClear();
  unlink.mockClear();
  readdir.mockReset();
  readdir.mockResolvedValue([]);
  getSetting.mockClear();
});

it.each(["mkv", "mp4"] as const)(
  "downloads video and audio separately and muxes them to %s",
  async (container) => {
    const outputPath = `/tmp/result.${container}`;
    const done = downloadHlsStream(
      "https://example.org/master.m3u8",
      outputPath,
      undefined,
      container
    );

    // First yt-dlp call: video-only. Some HLS masters (ORF's APA CDN) put
    // audio in a separate #EXT-X-MEDIA group yt-dlp's own "+" merge can't
    // see, so video and audio are downloaded as two independent calls
    // instead of trusting a single "bestvideo+bestaudio" selector.
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    let args = spawn.mock.calls[0][1];
    expect(args[args.indexOf("-f") + 1]).toBe("bestvideo/best");
    child.emit("close", 0);

    // Second yt-dlp call: audio-only, with a "/best" fallback for HLS
    // masters that only expose combined video+audio variants.
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    args = spawn.mock.calls[1][1];
    expect(args[args.indexOf("-f") + 1]).toBe("bestaudio/best");
    child.emit("close", 0);

    expect(await done).toEqual({ success: true, outputPath });
    expect(mergeVideoAudio).toHaveBeenCalledTimes(1);
    expect(mergeVideoAudio.mock.calls[0][2]).toBe(outputPath);
  }
);

it("removes the partial video temp file when the video download fails", async () => {
  const done = downloadHlsStream("https://example.org/master.m3u8", "/tmp/result.mkv");
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
  const videoArgs = spawn.mock.calls[0][1];
  const videoTempPath = videoArgs[videoArgs.indexOf("-o") + 1];
  child.stderr.emit("data", Buffer.from("some yt-dlp error\n"));
  child.emit("close", 1);

  expect(await done).toEqual({ success: false, error: "some yt-dlp error\n" });
  expect(unlink).toHaveBeenCalledWith(videoTempPath);
  // Audio is never attempted once video already failed.
  expect(spawn).toHaveBeenCalledTimes(1);
});

it("removes both temp files when the audio download fails", async () => {
  const done = downloadHlsStream("https://example.org/master.m3u8", "/tmp/result.mkv");
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
  const videoArgs = spawn.mock.calls[0][1];
  const videoTempPath = videoArgs[videoArgs.indexOf("-o") + 1];
  child.emit("close", 0);

  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
  const audioArgs = spawn.mock.calls[1][1];
  const audioTempPath = audioArgs[audioArgs.indexOf("-o") + 1];
  child.stderr.emit("data", Buffer.from("audio fetch failed\n"));
  child.emit("close", 1);

  expect(await done).toEqual({ success: false, error: "audio fetch failed\n" });
  expect(unlink).toHaveBeenCalledWith(videoTempPath);
  expect(unlink).toHaveBeenCalledWith(audioTempPath);
});

it.each(["video", "audio"] as const)(
  "removes %s sidecars on failure without touching other downloads",
  async (stage) => {
    const done = downloadHlsStream("https://example.org/master.m3u8", "/tmp/result.mkv");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    if (stage === "audio") {
      child.emit("close", 0);
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    }
    const args = spawn.mock.calls[stage === "video" ? 0 : 1][1];
    const tempPath: string = args[args.indexOf("-o") + 1];
    const basename = tempPath.slice(tempPath.lastIndexOf("/") + 1);
    const sidecars = [".part", ".ytdl", ".part-Frag1"].map((suffix) => basename + suffix);
    const unrelated = [
      "result.mkv",
      ".hls-video-other.mp4.part",
      ".hls-audio-other.mp4.ytdl",
      basename.replace(".mp4", "extra.mp4.part"),
    ];
    readdir.mockResolvedValueOnce([...sidecars, ...unrelated]);
    child.emit("close", 1);

    expect((await done).success).toBe(false);
    for (const name of sidecars) expect(unlink).toHaveBeenCalledWith(`/tmp/${name}`);
    for (const name of unrelated) expect(unlink).not.toHaveBeenCalledWith(`/tmp/${name}`);
  }
);

it("removes the partial output file when the final mux fails", async () => {
  mergeVideoAudio.mockResolvedValueOnce({ success: false, error: "ffmpeg exited with code 1" });
  const done = downloadHlsStream("https://example.org/master.m3u8", "/tmp/result.mkv");

  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
  child.emit("close", 0);
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
  child.emit("close", 0);

  expect(await done).toEqual({ success: false, error: "ffmpeg exited with code 1" });
  expect(unlink).toHaveBeenCalledWith("/tmp/result.mkv");
});

it("cleans up the finished video temp file when preparing the audio download rejects before spawning", async () => {
  const done = downloadHlsStream("https://example.org/master.m3u8", "/tmp/result.mkv");
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
  const videoArgs = spawn.mock.calls[0][1];
  const videoTempPath = videoArgs[videoArgs.indexOf("-o") + 1];
  child.emit("close", 0);

  // downloadVideo has several awaits before it ever spawns a process
  // (ensureYtdlpExists, getConfiguredYtdlpPath, getProxyUrl, fs.mkdir);
  // any of those can reject - e.g. a settings read hitting a DB error -
  // which downloadVideo doesn't catch itself. That must not skip cleanup
  // of the video file that already finished downloading, and must not
  // turn into an unhandled rejection out of downloadHlsStream.
  getSetting.mockRejectedValueOnce(new Error("db unavailable"));

  expect(await done).toEqual({ success: false, error: "db unavailable" });
  expect(unlink).toHaveBeenCalledWith(videoTempPath);
  // The audio process never even got to spawn.
  expect(spawn).toHaveBeenCalledTimes(1);
});

it("still reports success if only the final progress callback fails", async () => {
  const onProgress = vi.fn(async (percent: number) => {
    if (percent === 100) throw new Error("db unavailable");
  });
  const done = downloadHlsStream("https://example.org/master.m3u8", "/tmp/result.mkv", onProgress);

  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
  child.emit("close", 0);
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
  child.emit("close", 0);

  // The mux already succeeded and the file is in place - a failed final
  // progress report must not turn that into a reported failure (the
  // caller would otherwise skip moving the finished file and mark a
  // successful download as failed).
  expect(await done).toEqual({ success: true, outputPath: "/tmp/result.mkv" });
});

it("awaits pending progress updates before marking a download complete", async () => {
  let release!: () => void;
  const onProgress = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  const done = downloadVideo("https://example.org/master.m3u8", {
    outputPath: "/tmp/result.mkv",
    onProgress,
  });
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
  child.stdout.emit(
    "data",
    Buffer.from("[download]  45.2% of 500.00MiB at 10.50MiB/s ETA 00:25\n")
  );
  child.emit("close", 0);
  let completed = false;
  void done.then(() => {
    completed = true;
  });
  await vi.waitFor(() => expect(onProgress).toHaveBeenCalled());
  expect(completed).toBe(false);
  release();
  expect((await done).success).toBe(true);
});

it("reports rejected progress writes without an unhandled rejection", async () => {
  const done = downloadVideo("https://example.org/master.m3u8", {
    outputPath: "/tmp/result.mkv",
    onProgress: async () => {
      throw new Error("database unavailable");
    },
  });
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
  child.stdout.emit(
    "data",
    Buffer.from("[download]  45.2% of 500.00MiB at 10.50MiB/s ETA 00:25\n")
  );
  await vi.waitFor(() => expect(child.kill).toHaveBeenCalled());
  child.emit("close", 0);
  expect((await done).success).toBe(false);
});

it.each([480, 720, 1080] as const)(
  "limits the video download to the requested %ip height",
  async (height) => {
    const done = downloadHlsStream(
      "https://example.org/master.m3u8",
      "/tmp/result.mkv",
      undefined,
      "mkv",
      height
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    const videoArgs = spawn.mock.calls[0][1];
    expect(videoArgs[videoArgs.indexOf("-f") + 1]).toBe(
      `bestvideo[height<=${height}]/best[height<=${height}]`
    );
    child.emit("close", 0);

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    const audioArgs = spawn.mock.calls[1][1];
    expect(audioArgs[audioArgs.indexOf("-f") + 1]).toBe(`bestaudio/best[height<=${height}]`);
    child.emit("close", 0);

    expect((await done).success).toBe(true);
  }
);

it("times out a silent downloader without waiting for a close event", async () => {
  vi.useFakeTimers();
  try {
    const done = downloadVideo("https://example.org/master.m3u8", {
      outputPath: "/tmp/result.mkv",
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(await done).toEqual({ success: false, error: expect.stringContaining("timed out") });
    child.emit("close", 0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("allows long active downloads and clears the timeout on completion", async () => {
  vi.useFakeTimers();
  try {
    const done = downloadVideo("https://example.org/master.m3u8", {
      outputPath: "/tmp/result.mkv",
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    child.stdout.emit("data", Buffer.from("[download] 50%\n"));
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    child.stderr.emit("data", Buffer.from("[Merger] Merging formats\n"));
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(child.kill).not.toHaveBeenCalled();
    child.emit("close", 0);
    expect((await done).success).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("clears the download timeout after a process error", async () => {
  vi.useFakeTimers();
  try {
    const done = downloadVideo("https://example.org/master.m3u8", {
      outputPath: "/tmp/result.mkv",
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    child.emit("error", new Error("spawn failed"));
    expect(await done).toEqual({ success: false, error: "spawn failed" });
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
