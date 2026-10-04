import { prisma } from "@/lib/db";
import { parseMediaMetadata, type MediaMetadata } from "@/lib/media-metadata";
import { randomUUID } from "crypto";
import * as path from "path";
import type { HistoryPage } from "@/lib/history-pagination";

/**
 * Format seconds remaining as SABnzbd's strict "H:MM:SS" timeleft format.
 * Radarr/Sonarr's SABnzbd client parser rejects anything else (including
 * "M:SS" for under an hour, or a free-text placeholder) with
 * "Expected either 0:0:0:0 or 0:0:0 format, but received: ..." - which
 * makes every queue poll fail, so they never see an in-progress download
 * even while it's genuinely downloading. Always emit the full form.
 */
export function formatSabnzbdTimeleft(secondsLeft: number): string {
  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const seconds = secondsLeft % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export interface QueueItem {
  nzo_id: string;
  filename: string;
  status: string;
  percentage: string;
  timeleft: string;
  cat: string;
  mb: string;
  mbleft: string;
  speed: string;
  priority: string;
  priorityValue: number;
  attempts: number;
  nextRetryAt: string | null;
}

export interface HistoryItem {
  nzo_id: string;
  name: string;
  status: string;
  completed: number;
  category: string;
  storage: string;
  bytes: number;
  fail_message: string;
  warning?: string;
}

export interface SabnzbdQueue {
  slots: QueueItem[];
  paused: boolean;
}

export interface SabnzbdHistory {
  slots: HistoryItem[];
  noofslots?: number;
  start?: number;
  limit?: number;
}

// Extract filename and URL from NZB content
const FILE_NAME_REGEX = /filename="([^"]+)\.nzb"/;
// New NZBs use Base64 comments so URLs containing "--" remain valid XML.
// Accept raw URL comments too, for NZBs saved before the format changed.
const COMMENT_REGEX = /<!--([\s\S]*?)-->/g;

export function parseNzbContent(
  nzbContent: string,
  uploadedFileName?: string
): { fileName: string; url: string; metadata?: MediaMetadata } | null {
  const fileName = uploadedFileName
    ? uploadedFileName.replace(/\.nzb$/i, "")
    : nzbContent.match(FILE_NAME_REGEX)?.[1];
  if (!fileName || /[\\/\0]/.test(fileName)) {
    return null;
  }

  let url: string | null = null;
  let metadata: MediaMetadata = {};
  for (const match of nzbContent.matchAll(COMMENT_REGEX)) {
    const comment = match[1].trim();
    if (/^https?:\/\/\S+$/.test(comment)) {
      url ||= comment;
      continue;
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(comment)) {
      continue;
    }
    let decoded: string;
    try {
      decoded = Buffer.from(comment, "base64").toString("utf-8");
    } catch {
      continue;
    }
    if (/^https?:\/\/\S+$/.test(decoded)) {
      url ||= decoded;
    } else if (decoded.startsWith("rundfunkarr-media:")) {
      metadata = parseMediaMetadata(decoded.slice("rundfunkarr-media:".length));
    }
  }

  if (!url) {
    return null;
  }

  return {
    fileName,
    url,
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

export async function addToQueue(
  url: string,
  title: string,
  category: string,
  metadata?: MediaMetadata
): Promise<{ id: string }> {
  const download = await prisma.download.create({
    data: {
      id: randomUUID(),
      title,
      url,
      category,
      ...(metadata && Object.keys(metadata).length
        ? { mediaMetadata: JSON.stringify(metadata) }
        : {}),
      status: "queued",
      progress: 0,
    },
  });

  // Trigger download processing asynchronously
  // Import dynamically to avoid circular dependencies and ensure server-side only
  triggerDownloadProcessing();

  return { id: download.id };
}

// Trigger download processing without blocking
function triggerDownloadProcessing(): void {
  // Use dynamic import to load the download manager only on server-side
  import("@/server/download-manager")
    .then(({ startDownloadProcessing }) => {
      startDownloadProcessing().catch(console.error);
    })
    .catch((err) => {
      console.error("Failed to load download manager:", err);
    });
}

export async function getQueue(): Promise<SabnzbdQueue> {
  const downloads = await prisma.download.findMany({
    where: {
      status: { in: ["queued", "downloading", "converting", "paused"] },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });

  const slots: QueueItem[] = downloads.map((d) => {
    let statusText = "Queued";
    if (d.status === "downloading") statusText = "Downloading";
    else if (d.status === "converting") statusText = "Extracting";
    else if (d.status === "paused") statusText = "Paused";

    // Convert BigInt to Number for arithmetic operations
    const totalSizeNum = Number(d.totalSize);
    const downloadedBytesNum = Number(d.downloadedBytes);
    const speedNum = Number(d.speed);

    const totalMb = (totalSizeNum / 1024 / 1024).toFixed(1);
    const remainingBytes = totalSizeNum - downloadedBytesNum;
    const speedMbps = (speedNum / 1024 / 1024).toFixed(1);

    const timeleft =
      d.status === "downloading" && speedNum > 0
        ? formatSabnzbdTimeleft(Math.round(remainingBytes / speedNum))
        : "0:00:00";

    return {
      nzo_id: d.id,
      priority: d.priority > 0 ? "High" : d.priority < 0 ? "Low" : "Normal",
      priorityValue: d.priority || 0,
      attempts: d.attempts,
      nextRetryAt: d.nextRetryAt?.toISOString() || null,
      filename: d.title,
      status: statusText,
      percentage: d.progress.toString(),
      timeleft,
      cat: d.category,
      mb: totalMb,
      mbleft: (remainingBytes / 1024 / 1024).toFixed(1),
      speed: d.status === "downloading" ? `${speedMbps} MB/s` : "",
    };
  });

  const { getSetting } = await import("@/lib/settings");
  return { slots, paused: (await getSetting("download.paused")) === "true" };
}

export async function getHistory(
  page?: HistoryPage,
  includeCancelled = false
): Promise<SabnzbdHistory> {
  const statuses = includeCancelled
    ? ["completed", "failed", "cancelled"]
    : ["completed", "failed"];
  const downloads = await prisma.download.findMany({
    where: {
      status: { in: statuses },
    },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    ...(page ? { skip: page.start, take: page.limit } : {}),
  });

  const slots: HistoryItem[] = downloads.map((d) => {
    return {
      nzo_id: d.id,
      name: d.title,
      status: d.status === "completed" ? "Completed" : "Failed",
      completed: d.completedAt ? Math.floor(d.completedAt.getTime() / 1000) : 0,
      category: d.category,
      // Sonarr accepts a single file. A shared category directory could
      // import or remove files belonging to other downloads.
      storage: d.filePath || "",
      bytes: Number(d.size),
      fail_message: d.error || "",
      ...(d.warning ? { warning: d.warning } : {}),
    };
  });

  if (!page) return { slots };
  const noofslots = await prisma.download.count({
    where: { status: { in: statuses } },
  });
  return { slots, noofslots, ...page };
}

export async function deleteHistoryItem(nzoId: string, delFiles: boolean): Promise<boolean> {
  let download = await prisma.download.findUnique({
    where: { id: nzoId },
  });

  if (!download) {
    return false;
  }

  if (["queued", "downloading", "converting", "paused"].includes(download.status)) {
    const { controlDownload } = await import("@/server/download-queue");
    await controlDownload(nzoId, "cancel");
    // Completion can win the cancellation race and publish a new file path.
    download = await prisma.download.findUnique({ where: { id: nzoId } });
    if (!download) return false;
  }

  // Delete the file if requested
  if (delFiles && download.filePath) {
    try {
      const fs = await import("fs/promises");
      await fs.unlink(download.filePath).catch(() => {});
      const { deleteSubtitleSidecar } = await import("@/server/subtitle-artifact");
      await deleteSubtitleSidecar(download.subtitleArtifact);
      const directory = path.dirname(download.filePath);
      // Legacy downloads use shared category folders, which must remain intact.
      if (path.basename(directory) === download.id) {
        await fs.rmdir(directory).catch(() => {});
      }
    } catch {
      // File might not exist, ignore error
    }
  }

  await prisma.download.delete({
    where: { id: nzoId },
  });

  return true;
}

export async function retryDownload(nzoId: string): Promise<{ id: string } | null> {
  const download = await prisma.download.findUnique({
    where: { id: nzoId },
  });

  if (!download) {
    return null;
  }

  if (!["failed", "cancelled"].includes(download.status)) return null;

  // Delete the old entry
  await prisma.download.delete({
    where: { id: nzoId },
  });

  // Re-add to queue
  return addToQueue(
    download.url,
    download.title,
    download.category,
    parseMediaMetadata(download.mediaMetadata)
  );
}

export async function getConfigResponse(): Promise<object> {
  const { getSetting } = await import("@/lib/settings");
  const downloadPath =
    (await getSetting("download.path")) || process.env.DOWNLOAD_FOLDER_PATH || "/downloads";

  return {
    config: {
      misc: {
        complete_dir: downloadPath,
        enable_tv_sorting: false,
        enable_movie_sorting: false,
        pre_check: false,
        history_retention: "-1",
        history_retention_option: "all",
      },
      categories: [
        { name: "sonarr", pp: "", script: "Default", dir: "", priority: -100 },
        { name: "tv", pp: "", script: "Default", dir: "", priority: -100 },
        { name: "radarr", pp: "", script: "Default", dir: "", priority: -100 },
        { name: "movies", pp: "", script: "Default", dir: "", priority: -100 },
        { name: "sonarr_blackhole", pp: "", script: "Default", dir: "", priority: -100 },
        { name: "radarr_blackhole", pp: "", script: "Default", dir: "", priority: -100 },
      ],
      sorters: [],
    },
  };
}
