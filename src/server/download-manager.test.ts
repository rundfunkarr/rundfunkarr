import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fsp from "fs/promises";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";

// Everything stays the real implementation; only `rename` is wrapped in a
// vi.fn so a single test can inject a failure into its first call (ESM module
// namespaces cannot be spied on directly).
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
import { tmpdir } from "os";
import path from "path";

const {
  configFindUnique,
  downloadCount,
  downloadFindUnique,
  downloadUpdate,
  ffmpegModuleLoaded,
  convertMp4ToMkv,
  downloadHlsStream,
} = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  downloadCount: vi.fn(),
  downloadFindUnique: vi.fn(),
  downloadUpdate: vi.fn(),
  ffmpegModuleLoaded: vi.fn(),
  convertMp4ToMkv: vi.fn(),
  downloadHlsStream: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    config: { findUnique: configFindUnique },
    download: {
      count: downloadCount,
      findUnique: downloadFindUnique,
      update: downloadUpdate,
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}));

vi.mock("./ffmpeg", () => {
  ffmpegModuleLoaded();
  return { convertMp4ToMkv };
});

vi.mock("./ytdlp", () => ({ downloadHlsStream }));

import { clearSettingsCache } from "@/lib/settings";
import { processDownload } from "./download-manager";

let testRoot: string;

it.each([
  ["mkv", "tv"],
  ["mp4", "tv"],
  ["mkv", ""],
  ["mp4", ""],
])(
  "resolves SRF at download time and finishes HLS as %s with category %s across mounts",
  async (container, category) => {
    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(
        where.key === "download.path"
          ? { value: testRoot }
          : where.key === "download.convertToMkv"
            ? { value: String(container === "mkv") }
            : null
      )
    );
    downloadFindUnique.mockResolvedValue({
      id: "hls",
      title: "Rundschau",
      category,
      status: "queued",
      url: "https://www.srf.ch/play/tv/redirect/detail/11111111-1111-4111-8111-111111111111#rundfunkarr-height=480",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    downloadHlsStream.mockImplementation(async (_url: string, output: string) => {
      await writeFile(output, "media");
      return { success: true, outputPath: output };
    });
    vi.mocked(fsp.rename).mockRejectedValueOnce(
      Object.assign(new Error("cross-device"), { code: "EXDEV" })
    );
    await processDownload("hls");
    expect(downloadHlsStream).toHaveBeenLastCalledWith(
      "srgssr:srf:video:11111111-1111-4111-8111-111111111111",
      expect.stringContaining(`Rundschau.${container}`),
      expect.any(Function),
      container,
      480,
      expect.any(AbortSignal)
    );
    expect(
      await readFile(
        path.join(testRoot, category || "default", "hls", `Rundschau.${container}`),
        "utf8"
      )
    ).toBe("media");
    expect(downloadUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "completed",
          filePath: `/mapped/downloads/${category || "default"}/hls/Rundschau.${container}`,
        }),
      })
    );
  }
);

beforeEach(async () => {
  clearSettingsCache();
  configFindUnique.mockReset();
  downloadCount.mockReset();
  downloadFindUnique.mockReset();
  downloadUpdate.mockReset();
  convertMp4ToMkv.mockReset();
  downloadHlsStream.mockReset();

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
  it.each(["sonarr", ""])(
    "keeps MP4 files unchanged with category %s when MKV conversion is disabled",
    async (category) => {
      const mediaBytes = new Uint8Array([1, 2, 3, 4]);
      const title = "Show.S01E01";
      const categoryFolder = category || "default";

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

      expect(ffmpegModuleLoaded).not.toHaveBeenCalled();
      expect(convertMp4ToMkv).not.toHaveBeenCalled();
      await expect(
        readFile(path.join(testRoot, categoryFolder, "download-1", `${title}.mp4`))
      ).resolves.toEqual(Buffer.from(mediaBytes));
      await expect(
        access(path.join(testRoot, categoryFolder, "download-1", `${title}.mkv`))
      ).rejects.toThrow();
      expect(downloadUpdate).toHaveBeenCalledWith({
        where: { id: "download-1" },
        data: expect.objectContaining({
          status: "completed",
          filePath: path.join("/mapped/downloads", categoryFolder, "download-1", `${title}.mp4`),
        }),
      });
    }
  );

  it("recovers when the category directory is removed mid-download", async () => {
    const mediaBytes = new Uint8Array([5, 6, 7, 8]);
    const title = "Show.S01E02";
    const category = "sonarr";
    const categoryDir = path.join(testRoot, category, "download-2");

    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "download.path") return Promise.resolve({ value: testRoot });
      if (where.key === "download.convertToMkv") return Promise.resolve({ value: "false" });
      return Promise.resolve(null);
    });
    downloadFindUnique.mockResolvedValue({
      id: "download-2",
      title,
      category,
      status: "queued",
      url: "https://example.com/video.mp4",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    // An *arr app imports an earlier download and deletes the then-empty
    // category folder while this one is still transferring.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        await rm(categoryDir, { recursive: true, force: true });
        return new Response(mediaBytes, {
          status: 200,
          headers: { "content-length": String(mediaBytes.byteLength) },
        });
      })
    );

    await processDownload("download-2");

    await expect(readFile(path.join(categoryDir, `${title}.mp4`))).resolves.toEqual(
      Buffer.from(mediaBytes)
    );
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: "download-2" },
      data: expect.objectContaining({ status: "completed" }),
    });
  });

  it("recovers when the category directory is removed during MKV conversion", async () => {
    const mediaBytes = new Uint8Array([9, 10, 11, 12]);
    const mkvBytes = new Uint8Array([13, 14, 15, 16]);
    const title = "Show.S01E03";
    const category = "sonarr";
    const categoryDir = path.join(testRoot, category, "download-3");

    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "download.path") return Promise.resolve({ value: testRoot });
      if (where.key === "download.convertToMkv") return Promise.resolve({ value: "true" });
      return Promise.resolve(null);
    });
    downloadFindUnique.mockResolvedValue({
      id: "download-3",
      title,
      category,
      status: "queued",
      url: "https://example.com/video.mp4",
    });
    downloadUpdate.mockResolvedValue({});
    downloadCount.mockResolvedValue(0);
    convertMp4ToMkv.mockImplementation(async (_source: string, target: string) => {
      await writeFile(target, mkvBytes);
      // The folder disappears while ffmpeg is busy -- this is the window that
      // stranded finished files before the fix.
      await rm(categoryDir, { recursive: true, force: true });
      return { success: true };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(mediaBytes, {
          status: 200,
          headers: { "content-length": String(mediaBytes.byteLength) },
        })
      )
    );

    await processDownload("download-3");

    await expect(readFile(path.join(categoryDir, `${title}.mkv`))).resolves.toEqual(
      Buffer.from(mkvBytes)
    );
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: "download-3" },
      data: expect.objectContaining({
        status: "completed",
        filePath: path.join("/mapped/downloads", category, "download-3", `${title}.mkv`),
      }),
    });
  });

  it("recovers when the folder vanishes between the re-create and the move", async () => {
    // The narrowest possible race: an *arr import deletes the category folder
    // in the instant AFTER moveIntoCategoryDir re-created it and BEFORE the
    // rename runs. Simulated by deleting the folder from inside the first
    // rename call itself.
    const mediaBytes = new Uint8Array([17, 18, 19, 20]);
    const title = "Show.S01E04";
    const category = "sonarr";
    const categoryDir = path.join(testRoot, category, "download-4");

    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "download.path") return Promise.resolve({ value: testRoot });
      if (where.key === "download.convertToMkv") return Promise.resolve({ value: "false" });
      return Promise.resolve(null);
    });
    downloadFindUnique.mockResolvedValue({
      id: "download-4",
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

    const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
    vi.mocked(fsp.rename).mockImplementationOnce(async (source, target) => {
      await rm(categoryDir, { recursive: true, force: true });
      return actual.rename(source, target); // fails with ENOENT, the retry must recover
    });

    await processDownload("download-4");

    await expect(readFile(path.join(categoryDir, `${title}.mp4`))).resolves.toEqual(
      Buffer.from(mediaBytes)
    );
    expect(downloadUpdate).toHaveBeenCalledWith({
      where: { id: "download-4" },
      data: expect.objectContaining({ status: "completed" }),
    });
  });
});

describe("completed download folders", () => {
  const downloadId = "folder-cleanup";

  beforeEach(() => {
    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(
        where.key === "download.path"
          ? { value: testRoot }
          : where.key === "download.convertToMkv"
            ? { value: "false" }
            : null
      )
    );
    downloadFindUnique.mockResolvedValue({
      id: downloadId,
      title: "Video",
      category: "tv",
      status: "queued",
      attempts: 1,
      url: "https://example.com/video.mp4",
    });
    downloadUpdate.mockResolvedValue({});
  });

  it.each([
    ["pause", "paused"],
    ["cancel", "cancelled"],
    ["retry", "queued"],
    ["failure", "failed"],
  ])("does not create a completed folder for %s", async (outcome, status) => {
    const directory = path.join(testRoot, "tv", downloadId);
    const controller = new AbortController();
    let directoryExistsDuringTransfer = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        directoryExistsDuringTransfer = await access(directory).then(
          () => true,
          () => false
        );
        if (outcome === "pause" || outcome === "cancel") {
          controller.abort(outcome);
          throw new Error("Transfer stopped");
        }
        return new Response(null, { status: outcome === "retry" ? 503 : 404 });
      })
    );

    await processDownload(downloadId, controller.signal);

    expect(directoryExistsDuringTransfer).toBe(false);
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(path.join(testRoot, "incomplete", downloadId))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(downloadUpdate).toHaveBeenLastCalledWith({
      where: { id: downloadId },
      data: expect.objectContaining({ status }),
    });
  });

  it.each([false, true])(
    "cleans up a failed move without removing unrelated files (existing file: %s)",
    async (existingFile) => {
      const directory = path.join(testRoot, "tv", downloadId);
      const otherFile = path.join(directory, "keep.txt");
      if (existingFile) {
        await mkdir(directory, { recursive: true });
        await writeFile(otherFile, "unrelated bytes");
      }
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("video bytes")));
      vi.mocked(fsp.rename).mockRejectedValueOnce(
        Object.assign(new Error("move failed"), { code: "EACCES" })
      );

      await processDownload(downloadId);

      if (existingFile) await expect(readFile(otherFile, "utf8")).resolves.toBe("unrelated bytes");
      else await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(downloadUpdate).toHaveBeenLastCalledWith({
        where: { id: downloadId },
        data: expect.objectContaining({ status: "failed" }),
      });
    }
  );
});

it.each(["network error", "stall"])("removes partial files after a %s", async (failure) => {
  configFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
    Promise.resolve(where.key === "download.path" ? { value: testRoot } : null)
  );
  downloadFindUnique.mockResolvedValue({
    id: "failed-transfer",
    title: "Partial",
    category: "tv",
    status: "queued",
    url: "https://example.org/video.mp4",
  });
  downloadUpdate.mockResolvedValue({});
  downloadCount.mockResolvedValue(0);
  let source!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          source = controller;
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
      });
      options.signal.addEventListener("abort", () => source.error(new Error("aborted")), {
        once: true,
      });
      return new Response(body, { headers: { "content-length": "100" } });
    })
  );
  vi.useFakeTimers();
  try {
    const done = processDownload("failed-transfer");
    await vi.waitFor(() =>
      expect(downloadUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ downloadedBytes: 3 }),
        })
      )
    );
    if (failure === "stall") await vi.advanceTimersByTimeAsync(60001);
    else source.error(new Error("connection lost"));
    await done;
    await expect(
      access(path.join(testRoot, "incomplete", "failed-transfer", "Partial.mp4"))
    ).rejects.toThrow();
    expect(downloadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  } finally {
    vi.useRealTimers();
  }
});
