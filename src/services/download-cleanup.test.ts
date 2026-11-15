import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const { findUnique, deleteDownload, controlDownload } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  deleteDownload: vi.fn(),
  controlDownload: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { download: { findUnique, delete: deleteDownload } },
}));
vi.mock("@/server/download-queue", () => ({ controlDownload }));

import { recordFileArtifact } from "@/server/subtitle-artifact";
import { deleteHistoryItem } from "./download";

describe("download history folder cleanup", () => {
  const downloadId = "completed-job";
  let root: string;
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "rundfunkarr-history-cleanup-"));
    directory = path.join(root, "tv", downloadId);
    filePath = path.join(directory, "Video.mp4");
    await mkdir(directory, { recursive: true });
    findUnique.mockReset().mockResolvedValue({ id: downloadId, status: "completed", filePath });
    deleteDownload.mockReset().mockResolvedValue({});
    controlDownload.mockReset().mockResolvedValue(false);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each([true, false])(
    "removes the empty job folder with files requested (video present: %s)",
    async (videoPresent) => {
      if (videoPresent) await writeFile(filePath, "video bytes");

      await expect(deleteHistoryItem(downloadId, true)).resolves.toBe(true);

      await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(path.join(root, "tv"))).resolves.toBeUndefined();
      expect(deleteDownload).toHaveBeenCalledWith({ where: { id: downloadId } });
    }
  );

  it("keeps a job folder containing another file", async () => {
    await writeFile(filePath, "video bytes");
    const otherFile = path.join(directory, "keep.txt");
    await writeFile(otherFile, "unrelated bytes");

    await deleteHistoryItem(downloadId, true);

    await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(otherFile, "utf8")).resolves.toBe("unrelated bytes");
  });

  it("deletes its own video in a shared folder and keeps the folder", async () => {
    const sharedFile = path.join(root, "Video.mp4");
    await writeFile(sharedFile, "video bytes");
    findUnique.mockResolvedValue({
      id: downloadId,
      status: "completed",
      filePath: "/mapped/downloads/Video.mp4",
      fileArtifact: await recordFileArtifact(sharedFile),
    });

    await deleteHistoryItem(downloadId, true);

    await expect(access(sharedFile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(root)).resolves.toBeUndefined();
  });

  it("keeps a later download that reused the name of a moved file", async () => {
    // A completed here, then Sonarr or a script moved it away. B's history
    // entry may already be gone, so only the file identity can protect B.
    const sharedFile = path.join(root, "Video.mp4");
    await writeFile(sharedFile, "download A");
    const recordA = await recordFileArtifact(sharedFile);
    await rm(sharedFile);
    // Linux may hand out the same inode again at once; B differs in size.
    await writeFile(sharedFile, "download B, a different episode");
    findUnique.mockResolvedValue({
      id: downloadId,
      status: "completed",
      filePath: sharedFile,
      fileArtifact: recordA,
    });

    await expect(deleteHistoryItem(downloadId, true)).resolves.toBe(true);

    await expect(readFile(sharedFile, "utf8")).resolves.toBe("download B, a different episode");
    expect(deleteDownload).toHaveBeenCalledWith({ where: { id: downloadId } });
  });

  it("keeps a shared file when an older record has no identity", async () => {
    const categoryDir = path.join(root, "legacy-category");
    const legacyFile = path.join(categoryDir, "Video.mp4");
    await mkdir(categoryDir);
    await writeFile(legacyFile, "video bytes");
    findUnique.mockResolvedValue({ id: downloadId, status: "completed", filePath: legacyFile });

    await deleteHistoryItem(downloadId, true);

    await expect(readFile(legacyFile, "utf8")).resolves.toBe("video bytes");
    await expect(access(categoryDir)).resolves.toBeUndefined();
  });

  it("keeps the file and directory when only the history entry is deleted", async () => {
    await writeFile(filePath, "video bytes");

    await deleteHistoryItem(downloadId, false);

    await expect(readFile(filePath, "utf8")).resolves.toBe("video bytes");
    expect(deleteDownload).toHaveBeenCalledWith({ where: { id: downloadId } });
  });

  it("does not use stale file data if the record disappears during cancellation", async () => {
    await writeFile(filePath, "preserved bytes");
    findUnique
      .mockResolvedValueOnce({ id: downloadId, status: "downloading", filePath })
      .mockResolvedValueOnce(null);

    await expect(deleteHistoryItem(downloadId, true)).resolves.toBe(false);

    expect(controlDownload).toHaveBeenCalledWith(downloadId, "cancel");
    expect(deleteDownload).not.toHaveBeenCalled();
    await expect(readFile(filePath, "utf8")).resolves.toBe("preserved bytes");
  });
});
