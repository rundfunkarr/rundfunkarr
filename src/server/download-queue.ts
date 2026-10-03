import { prisma } from "@/lib/db";
import { getSetting, clearSettingsCache } from "@/lib/settings";

interface Worker {
  controller: AbortController;
  done: Promise<void>;
}
interface QueueState {
  workers: Map<string, Worker>;
  running: Promise<void> | null;
  requested: boolean;
  wake?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  recovered?: boolean;
}
const shared = globalThis as typeof globalThis & { rundfunkarrQueue?: QueueState };
const state: QueueState = (shared.rundfunkarrQueue ??= {
  workers: new Map(),
  running: null,
  requested: false,
});

export async function queueOptions() {
  const [parallel, retries, paused] = await Promise.all([
    getSetting("download.parallel"),
    getSetting("download.maxRetries"),
    getSetting("download.paused"),
  ]);
  return {
    parallel: Math.max(1, Math.min(5, Math.floor(Number(parallel)) || 1)),
    maxRetries: retries !== null && /^\d$/.test(retries) ? Math.min(5, Number(retries)) : 2,
    paused: paused === "true",
  };
}

export function startDownloadProcessing(): Promise<void> {
  state.requested = true;
  state.wake?.();
  clearTimeout(state.timer);
  if (!state.running) {
    state.running = drain().finally(() => {
      state.running = null;
      if (state.requested) void startDownloadProcessing().catch(console.error);
    });
  }
  return state.running;
}

async function drain(): Promise<void> {
  const { processDownload } = await import("./download-manager");
  const skippedIds = new Set<string>();
  do {
    state.requested = false;
    const options = await queueOptions();
    while (!options.paused && state.workers.size < options.parallel) {
      const next = await prisma.download.findFirst({
        where: {
          status: "queued",
          id: { notIn: [...state.workers.keys(), ...skippedIds] },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      });
      if (!next) break;
      const controller = new AbortController();
      const worker: Worker = { controller, done: Promise.resolve() };
      state.workers.set(next.id, worker);
      worker.done = processDownload(next.id, controller.signal)
        .catch((error) => {
          skippedIds.add(next.id);
          console.error(error);
        })
        .finally(() => {
          state.workers.delete(next.id);
          state.wake?.();
        });
    }
    if (state.workers.size) {
      await new Promise<void>((resolve) => {
        state.wake = resolve;
        if (state.requested || !state.workers.size) resolve();
      });
      state.wake = undefined;
      state.requested = true;
    } else if (!options.paused) {
      const delayed = await prisma.download.findFirst({
        where: { status: "queued", id: { notIn: [...skippedIds] }, nextRetryAt: { not: null } },
        orderBy: { nextRetryAt: "asc" },
      });
      if (delayed?.nextRetryAt) {
        state.timer = setTimeout(
          () => void startDownloadProcessing().catch(console.error),
          Math.max(100, delayed.nextRetryAt.getTime() - Date.now())
        );
        state.timer.unref?.();
      }
    }
  } while (state.requested);
}

export async function recoverDownloads(): Promise<void> {
  if (state.recovered) return;
  await prisma.download.updateMany({
    where: { status: { in: ["downloading", "converting"] } },
    data: {
      status: "queued",
      progress: 0,
      speed: 0,
      downloadedBytes: 0,
      nextRetryAt: null,
      error: "Nach einem Neustart erneut eingeplant.",
    },
  });
  state.recovered = true;
  void startDownloadProcessing().catch(console.error);
}

export async function setQueuePaused(paused: boolean): Promise<void> {
  await prisma.config.upsert({
    where: { key: "download.paused" },
    create: { key: "download.paused", value: String(paused) },
    update: { value: String(paused) },
  });
  clearSettingsCache();
  void startDownloadProcessing().catch(console.error);
}

export async function controlDownload(
  id: string,
  action: "pause" | "resume" | "cancel" | "priority",
  priority = 0
): Promise<boolean> {
  const worker = state.workers.get(id);
  if (action === "pause" || action === "cancel") {
    if (worker) {
      worker.controller.abort(action);
      await worker.done;
    }
    const result = await prisma.download.updateMany({
      where: { id, status: { in: ["queued", "paused"] } },
      data: {
        status: action === "pause" ? "paused" : "cancelled",
        speed: 0,
        nextRetryAt: null,
        ...(action === "cancel"
          ? { completedAt: new Date(), error: "Vom Nutzer abgebrochen." }
          : {}),
      },
    });
    return result.count > 0 || !!worker;
  }
  const result = await prisma.download.updateMany({
    where: { id, status: { in: action === "resume" ? ["paused"] : ["queued", "paused"] } },
    data:
      action === "resume"
        ? {
            status: "queued",
            error: null,
            nextRetryAt: null,
            attempts: 0,
            progress: 0,
            downloadedBytes: 0,
            speed: 0,
          }
        : { priority },
  });
  if (result.count) void startDownloadProcessing().catch(console.error);
  return result.count > 0;
}
