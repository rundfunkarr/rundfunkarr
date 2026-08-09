import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const { configFindUnique, downloadCount, downloadFindUnique, downloadUpdate, convertMp4ToMkv } =
  vi.hoisted(() => ({
    configFindUnique: vi.fn(),
    downloadCount: vi.fn(),
    downloadFindUnique: vi.fn(),
    downloadUpdate: vi.fn(),
    convertMp4ToMkv: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    config: { findUnique: configFindUnique },
    download: {
      count: downloadCount,
      findUnique: downloadFindUnique,
      update: downloadUpdate,
    },
  },
}));

vi.mock("./ffmpeg", () => ({ convertMp4ToMkv }));

import { clearSettingsCache } from "@/lib/settings";
import { processDownload } from "./download-manager";

let testRoot: string;

beforeEach(async () => {
  clearSettingsCache();
  configFindUnique.mockReset();
  downloadCount.mockReset();
  downloadFindUnique.mockReset();
  downloadUpdate.mockReset();
  convertMp4ToMkv.mockReset();

  testRoot = await mkdtemp(path.join(tmpdir(), "rundfunkarr-download-manager-"));
  vi.stubEnv("DOWNLOAD_TEMP_PATH", path.join(testRoot, "incomplete"));
  vi.stubEnv("DOWNLOAD_FOLDER_PATH_MAPPING", "/mapped/downloads");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(testRoot, { recursive: true, force: true });
});

describe("processDownload", () => {
  it("keeps MP4 files unchanged when MKV conversion is disabled", async () => {
    const mediaBytes = new Uint8Array([1, 2, 3, 4]);
    const title = "Show.S01E01";
    const category = "sonarr";

    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "download.path") return Promise.resolve({ value: testRoot });
      if (where.key === "download.convertToMkv") return Promise.resolve({ value: "false" });
      return Promise.resolve(null);
    });
    downloadFindUnique.mockResolvedValue({
      id: "download-1",
      title,
      category,
      status: "queued",
      url: "https://example.com/video.mp4",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(mediaBytes, {
          status: 200,
          headers: { "content-length": String(mediaBytes.byteLength) },
        })
      )
    );

    await processDownload("download-1");

    expect(convertMp4ToMkv).not.toHaveBeenCalled();
    await expect(readFile(path.join(testRoot, category, `${title}.mp4`))).resolves.toEqual(
      Buffer.from(mediaBytes)
    );
    await expect(access(path.join(testRoot, category, `${title}.mkv`))).rejects.toThrow();
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: "download-1" },
      data: expect.objectContaining({
        status: "completed",
        filePath: path.join("/mapped/downloads", category, `${title}.mp4`),
      }),
    });
  });
});
