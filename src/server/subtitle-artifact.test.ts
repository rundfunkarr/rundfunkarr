import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, link: vi.fn(actual.link), lstat: vi.fn(actual.lstat) };
});

import { deleteSubtitleSidecar, publishSubtitleSidecar } from "./subtitle-artifact";

const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let directory: string;
let source: string;
let destination: string;

beforeEach(async () => {
  vi.mocked(fs.link).mockReset();
  vi.mocked(fs.lstat).mockReset();
  directory = await fs.mkdtemp(path.join(tmpdir(), "rundfunkarr-sidecar-filesystem-"));
  source = path.join(directory, "staged.srt");
  destination = path.join(directory, "video.srt");
  await fs.writeFile(source, "completed subtitles");
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe("subtitle sidecar filesystem compatibility", () => {
  it("deletes its sidecar when birthtime changes with the hardlink count", async () => {
    let timestamp = 1000;
    vi.mocked(fs.lstat).mockImplementation(async (file) => {
      const stats = await actual.lstat(file, { bigint: true });
      // Model filesystems that expose changing ctime as birthtime.
      stats.birthtimeNs = BigInt(timestamp++);
      return stats;
    });
    const artifact = await publishSubtitleSidecar(source, destination);
    await fs.unlink(source);

    await deleteSubtitleSidecar(JSON.stringify(artifact));

    await expect(fs.access(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["EPERM", "ENOTSUP", "ENOSYS"])(
    "publishes and cleans up a copy when hardlinks fail with %s",
    async (code) => {
      vi.mocked(fs.link).mockRejectedValueOnce(Object.assign(new Error(code), { code }));

      const artifact = await publishSubtitleSidecar(source, destination);
      await fs.unlink(source);

      await expect(fs.readFile(destination, "utf8")).resolves.toBe("completed subtitles");
      await deleteSubtitleSidecar(JSON.stringify(artifact));
      await expect(fs.access(destination)).rejects.toMatchObject({ code: "ENOENT" });
    }
  );

  it.each(["EPERM", "ENOTSUP", "ENOSYS"])(
    "preserves an existing sidecar when hardlinks fail with %s",
    async (code) => {
      await fs.writeFile(destination, "another download");
      vi.mocked(fs.link).mockRejectedValueOnce(Object.assign(new Error(code), { code }));

      await expect(publishSubtitleSidecar(source, destination)).rejects.toThrow(
        "nicht überschrieben"
      );

      await expect(fs.readFile(destination, "utf8")).resolves.toBe("another download");
    }
  );

  it("does not hide unrelated filesystem errors", async () => {
    const error = Object.assign(new Error("unavailable"), { code: "EIO" });
    vi.mocked(fs.link).mockRejectedValueOnce(error);
    await expect(publishSubtitleSidecar(source, destination)).rejects.toBe(error);
    await expect(fs.access(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
