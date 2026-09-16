import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { downloadHlsStream, downloadVideo } from "./ytdlp";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("child_process", () => ({ spawn }));
vi.mock("./ffmpeg", () => ({
  ensureFfmpegExists: vi.fn(async () => true),
  getFfmpegPath: () => "/fixture/ffmpeg",
}));
vi.mock("fs/promises", () => ({ access: vi.fn(async () => {}), mkdir: vi.fn(async () => {}) }));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (key: string) =>
    key === "download.ytdlpPath" ? "/fixture/yt-dlp" : null
  ),
}));

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
});

it.each(["mkv", "mp4"] as const)(
  "explicitly remuxes combined HLS streams to %s",
  async (container) => {
    const done = downloadHlsStream(
      "https://example.org/master.m3u8",
      `/tmp/result.${container}`,
      undefined,
      container
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(["--remux-video", container]));
    expect(spawn.mock.calls[0][1]).toEqual(
      expect.arrayContaining(["--ffmpeg-location", "/fixture/ffmpeg"])
    );
    child.emit("close", 0);
    expect(await done).toEqual({ success: true, outputPath: `/tmp/result.${container}` });
  }
);

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
