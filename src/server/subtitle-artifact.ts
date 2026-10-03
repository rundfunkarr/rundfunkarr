import type { BigIntStats } from "node:fs";
import * as fs from "node:fs/promises";
import { z } from "zod";

const identifier = z.string().regex(/^\d+$/);
const artifactSchema = z.object({
  path: z.string().min(1),
  device: identifier,
  inode: identifier,
  birthtime: identifier,
  modified: identifier,
  size: identifier,
});
export type SubtitleArtifact = z.infer<typeof artifactSchema>;

function identity(stats: BigIntStats) {
  return {
    device: String(stats.dev),
    inode: String(stats.ino),
    birthtime: String(stats.birthtimeNs),
    modified: String(stats.mtimeNs),
    size: String(stats.size),
  };
}

/** Publish a complete SRT atomically without replacing an existing sibling. */
export async function publishSubtitleSidecar(
  source: string,
  destination: string
): Promise<SubtitleArtifact> {
  const stats = await fs.lstat(source, { bigint: true });
  try {
    await fs.link(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("Die vorhandene Untertiteldatei wurde nicht überschrieben.");
    throw error;
  }
  return { path: destination, ...identity(stats) };
}

/** Remove only the unchanged file recorded when this download published its SRT. */
export async function deleteSubtitleSidecar(record: string | null | undefined): Promise<void> {
  if (!record) return;
  try {
    const artifact = artifactSchema.parse(JSON.parse(record));
    const stats = await fs.lstat(artifact.path, { bigint: true });
    if (!stats.isFile()) return;
    const current = identity(stats);
    if (
      Object.entries(current).every(
        ([key, value]) => artifact[key as keyof typeof current] === value
      )
    )
      await fs.unlink(artifact.path);
  } catch {
    // Missing, replaced, or unrecognized artifacts are not ours to remove.
  }
}
