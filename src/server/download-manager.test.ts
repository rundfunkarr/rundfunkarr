import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fsp from "fs/promises";
import { access, mkdtemp, readFile, rm, writeFile } from "fs/promises";

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
  downloadFindFirst,
  downloadUpdate,
  ffmpegModuleLoaded,
  convertMp4ToMkv,
  downloadHlsStream,
} = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  downloadCount: vi.fn(),
  downloadFindUnique: vi.fn(),
  downloadFindFirst: vi.fn(),
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
      findFirst: downloadFindFirst,
      update: downloadUpdate,
    },
  },
}));

vi.mock("./ffmpeg", () => {
  ffmpegModuleLoaded();
  return { convertMp4ToMkv };
});

vi.mock("./ytdlp", () => ({ downloadHlsStream }));

import { clearSettingsCache } from "@/lib/settings";
import { processDownload, startDownloadProcessing } from "./download-manager";

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
      480
    );
    expect(
      await readFile(path.join(testRoot, category || "default", `Rundschau.${container}`), "utf8")
    ).toBe("media");
    expect(downloadUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "completed",
          filePath: `/mapped/downloads/${category || "default"}/Rundschau.${container}`,
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
  downloadFindFirst.mockReset();
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
      await expect(readFile(path.join(testRoot, categoryFolder, `${title}.mp4`))).resolves.toEqual(
        Buffer.from(mediaBytes)
      );
      await expect(access(path.join(testRoot, categoryFolder, `${title}.mkv`))).rejects.toThrow();
      expect(downloadUpdate).toHaveBeenCalledWith({
        where: { id: "download-1" },
        data: expect.objectContaining({
          status: "completed",
          filePath: path.join("/mapped/downloads", categoryFolder, `${title}.mp4`),
        }),
      });
    }
  );

  it("recovers when the category directory is removed mid-download", async () => {
    const mediaBytes = new Uint8Array([5, 6, 7, 8]);
    const title = "Show.S01E02";
    const category = "sonarr";
    const categoryDir = path.join(testRoot, category);

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
    const categoryDir = path.join(testRoot, category);

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
        filePath: path.join("/mapped/downloads", category, `${title}.mkv`),
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
    const categoryDir = path.join(testRoot, category);

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
    await expect(access(path.join(testRoot, "incomplete", "Partial.mp4"))).rejects.toThrow();
    expect(downloadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  } finally {
    vi.useRealTimers();
  }
});

describe("Warteschlangensteuerung", () => {
  it("setzt die übrige Queue fort, wenn auch das Speichern des Fehlerstatus scheitert", async () => {
    configFindUnique.mockImplementation(async ({ where }) =>
      where.key === "download.path" ? { value: testRoot } : null
    );
    const jobs = ["defekt", "bereit"].map((id) => ({
      id,
      title: id,
      category: "tv",
      status: "queued",
      url: `https://example.org/${id}.m3u8`,
    }));
    downloadFindFirst.mockImplementation(
      async ({ where }) =>
        jobs.find((job) => job.status === "queued" && !where.id?.notIn.includes(job.id)) ?? null
    );
    downloadFindUnique.mockImplementation(async ({ where }) =>
      jobs.find((job) => job.id === where.id)
    );
    downloadUpdate.mockImplementation(async ({ where, data }) => {
      if (where.id === "defekt") throw new Error("Schreibfehler");
      return Object.assign(jobs.find((job) => job.id === where.id)!, data);
    });
    downloadHlsStream.mockImplementation(async (_url: string, output: string) => {
      await writeFile(output, "media");
      return { success: true, outputPath: output };
    });
    await expect(startDownloadProcessing()).resolves.toBeUndefined();
    expect(jobs.map((job) => job.status)).toEqual(["queued", "completed"]);
    expect(downloadFindFirst).toHaveBeenCalledTimes(3);
    expect(downloadHlsStream).toHaveBeenCalledTimes(1);
  });

  it("plant während eines laufenden Downloads keine weiteren Startaufrufe ein", async () => {
    configFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(where.key === "download.path" ? { value: testRoot } : null)
    );
    const jobs = new Map([
      [
        "eins",
        {
          id: "eins",
          title: "Eins",
          category: "tv",
          status: "queued",
          url: "https://example.com/eins.m3u8",
        },
      ],
      [
        "zwei",
        {
          id: "zwei",
          title: "Zwei",
          category: "tv",
          status: "queued",
          url: "https://example.com/zwei.m3u8",
        },
      ],
    ]);
    downloadFindFirst.mockImplementation(
      async () => [...jobs.values()].find((job) => job.status === "queued") ?? null
    );
    downloadFindUnique.mockImplementation(async ({ where }) => jobs.get(where.id));
    downloadUpdate.mockImplementation(async ({ where, data }) =>
      Object.assign(jobs.get(where.id)!, data)
    );
    downloadCount.mockRejectedValue(new Error("Zusätzliche Zählabfrage nicht erreichbar"));
    let unblock!: () => void;
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    downloadHlsStream.mockImplementation(async (_url: string, output: string) => {
      if (output.includes("Eins")) {
        started();
        await blocked;
      }
      await writeFile(output, "media");
      return { success: true, outputPath: output };
    });
    const processing = startDownloadProcessing();
    await firstStarted;
    try {
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(downloadFindFirst).toHaveBeenCalledTimes(1);
      expect(downloadHlsStream).toHaveBeenCalledTimes(1);
      expect(startDownloadProcessing()).toBe(processing);
    } finally {
      unblock();
      await processing;
    }
    expect(downloadHlsStream).toHaveBeenCalledTimes(2);
    expect(downloadCount).not.toHaveBeenCalled();
    expect([...jobs.values()].map((job) => job.status)).toEqual(["completed", "completed"]);
  });

  it("kann nach einem Datenbankfehler erneut gestartet werden", async () => {
    downloadFindFirst.mockRejectedValueOnce(new Error("Datenbank vorübergehend nicht erreichbar"));
    await expect(startDownloadProcessing()).rejects.toThrow("Datenbank");
    downloadFindFirst.mockResolvedValue(null);
    await expect(startDownloadProcessing()).resolves.toBeUndefined();
    expect(downloadFindFirst).toHaveBeenCalledTimes(2);
  });

  it("berücksichtigt einen Auftrag, der während der letzten leeren Abfrage eingeht", async () => {
    let unblock!: (value: null) => void;
    downloadFindFirst.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          unblock = resolve;
        })
    );
    downloadFindFirst.mockResolvedValue(null);
    const processing = startDownloadProcessing();
    startDownloadProcessing();
    unblock(null);
    await processing;
    expect(downloadFindFirst).toHaveBeenCalledTimes(2);
  });
});
