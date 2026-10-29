import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// Runs the real conversion against a system ffmpeg; skipped where none is installed.
const systemFfmpeg =
  process.platform === "win32"
    ? null
    : spawnSync("sh", ["-c", "command -v ffmpeg"], { encoding: "utf8" }).stdout.trim() || null;

describe.skipIf(!systemFfmpeg)("convertMp4ToMkv with a real ffmpeg", () => {
  let dir: string;
  let convertMp4ToMkv: typeof import("./ffmpeg").convertMp4ToMkv;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "rundfunkarr-ffmpeg-"));
    // ffmpeg.ts resolves its binary as <cwd>/ffmpeg/ffmpeg when the module loads.
    await fs.mkdir(path.join(dir, "ffmpeg"));
    await fs.symlink(systemFfmpeg!, path.join(dir, "ffmpeg", "ffmpeg"));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      vi.resetModules();
      ({ convertMp4ToMkv } = await import("./ffmpeg"));
    } finally {
      process.chdir(cwd);
    }
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function ffmpeg(args: string[]) {
    return spawnSync(systemFfmpeg!, ["-hide_banner", ...args], { encoding: "utf8" });
  }

  it("converts a source without an audio track", async () => {
    const mp4 = path.join(dir, "silent.mp4");
    const mkv = path.join(dir, "silent.mkv");
    const generated = ffmpeg([
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=1:size=160x120:rate=10",
      "-c:v",
      "mpeg4",
      mp4,
    ]);
    expect(generated.status).toBe(0);

    expect(await convertMp4ToMkv(mp4, mkv)).toEqual({ success: true, outputPath: mkv });

    const probe = ffmpeg(["-i", mkv]).stderr;
    expect(probe).toContain("Video:");
    expect(probe).not.toContain("Audio:");
  });

  it("keeps the audio track when the source has one", async () => {
    const mp4 = path.join(dir, "sound.mp4");
    const mkv = path.join(dir, "sound.mkv");
    const generated = ffmpeg([
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=1:size=160x120:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=1",
      "-c:v",
      "mpeg4",
      "-c:a",
      "aac",
      "-shortest",
      mp4,
    ]);
    expect(generated.status).toBe(0);

    expect(await convertMp4ToMkv(mp4, mkv)).toEqual({ success: true, outputPath: mkv });

    const probe = ffmpeg(["-i", mkv]).stderr;
    expect(probe).toContain("Video:");
    expect(probe).toContain("Audio:");
  });
});
