import type { BigIntStats } from "node:fs";
import * as fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { z } from "zod";

const identifier = z.string().regex(/^\d+$/);
const artifactSchema = z.object({
  path: z.string().min(1),
  device: identifier,
  inode: identifier,
  modified: identifier,
  size: identifier,
});
export type SubtitleArtifact = z.infer<typeof artifactSchema>;

function identity(stats: BigIntStats) {
  return {
    device: String(stats.dev),
    inode: String(stats.ino),
    modified: String(stats.mtimeNs),
    size: String(stats.size),
  };
}

/** Publish a complete SRT without replacing an existing sibling. */
export async function publishSubtitleSidecar(
  source: string,
  destination: string
): Promise<SubtitleArtifact> {
  try {
    try {
      await fs.link(source, destination);
    } catch (error) {
      if (!["EPERM", "ENOTSUP", "ENOSYS"].includes((error as NodeJS.ErrnoException).code || ""))
        throw error;
      // Some network/FUSE volumes cannot hardlink. The copy remains exclusive,
      // but unlike the hardlink it is not an atomic publication.
      await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("Die vorhandene Untertiteldatei wurde nicht überschrieben.");
    throw error;
  }
  const stats = await fs.lstat(destination, { bigint: true });
  return { path: destination, ...identity(stats) };
}

/**
 * Record the identity of a file this download published, so a later deletion
 * can tell it apart from another file that reuses the same name.
 */
export async function recordFileArtifact(
  filePath: string,
  held?: FileHandle | null
): Promise<string | null> {
  try {
    // From an open handle, the identity belongs to exactly the file it holds.
    const stats = held
      ? await held.stat({ bigint: true })
      : await fs.lstat(filePath, { bigint: true });
    return stats.isFile() ? JSON.stringify({ path: filePath, ...identity(stats) }) : null;
  } catch {
    return null;
  }
}

/**
 * Update a record after other code (a post-processing script) had the file.
 * `held` is a handle opened on the file before that code ran. While it stays
 * open, the file system cannot hand the file's inode to another file, so only
 * the same file, edited in place, matches it. A different file now at that
 * path may belong to another download and keeps the old record, so it never
 * passes a later ownership check.
 */
export async function refreshFileArtifact(
  record: string | null,
  held: FileHandle | null
): Promise<string | null> {
  if (!record || !held) return record;
  try {
    const artifact = artifactSchema.parse(JSON.parse(record));
    const original = await held.stat({ bigint: true });
    // The handle must hold the recorded file, not one that replaced it.
    if (String(original.dev) !== artifact.device || String(original.ino) !== artifact.inode)
      return record;
    const stats = await fs.lstat(artifact.path, { bigint: true });
    if (!stats.isFile() || stats.dev !== original.dev || stats.ino !== original.ino) return record;
    return JSON.stringify({ path: artifact.path, ...identity(stats) });
  } catch {
    return record;
  }
}

/** Remove only the unchanged file recorded when this download published its SRT. */
export async function deleteSubtitleSidecar(record: string | null | undefined): Promise<void> {
  await deleteOwnedFile(record);
}

/**
 * Remove a recorded file only while its identity still matches the record.
 * Returns the recorded path, or null when there is no valid record.
 */
export async function deleteOwnedFile(record: string | null | undefined): Promise<string | null> {
  if (!record) return null;
  let artifact: SubtitleArtifact;
  try {
    artifact = artifactSchema.parse(JSON.parse(record));
  } catch {
    return null;
  }
  try {
    const stats = await fs.lstat(artifact.path, { bigint: true });
    if (!stats.isFile()) return artifact.path;
    const current = identity(stats);
    if (
      Object.entries(current).every(
        ([key, value]) => artifact[key as keyof typeof current] === value
      )
    )
      await fs.unlink(artifact.path);
  } catch {
    // Missing or replaced files are not ours to remove.
  }
  return artifact.path;
}
