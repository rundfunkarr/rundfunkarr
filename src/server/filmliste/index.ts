/**
 * Optional local Filmliste index: downloads the MediathekView Filmliste,
 * keeps it searchable in SQLite and answers MediathekView queries locally.
 * The public MediathekViewWeb API stays the fallback whenever the index is
 * disabled, not built yet, outdated or fails.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { MediathekQueryField, MediathekQueryOptions } from "@/lib/mediathek-client";
import { getSetting } from "@/lib/settings";
import type { ApiResultItem } from "@/types";
import { parseFilmliste, type FilmlisteEntry } from "./parser";
import {
  FilmlisteStore,
  removeIndexFiles,
  resolveFilmlistePath,
  type FilmlisteIndexInfo,
} from "./store";
import { createLogger } from "@/lib/logger";

const log = createLogger("Filmliste");

export const FILMLISTE_URL = "https://liste.mediathekview.de/Filmliste-akt.xz";
export const DEFAULT_UPDATE_HOURS = 2;
/** Older lists miss new episodes, so searches fall back to the public API. */
export const MAX_LIST_AGE_SECONDS = 24 * 60 * 60;
/** A complete list has ~700k entries; far fewer means a truncated download. */
const MIN_PLAUSIBLE_ENTRIES = 50_000;
const NEW_LIST_TOLERANCE_SECONDS = 40 * 60;
const BATCH_SIZE = 2000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const SCHEDULER_TICK_MS = 60 * 1000;

export interface FilmlisteStatus extends FilmlisteIndexInfo {
  enabled: boolean;
  updateHours: number;
  usable: boolean;
  running: boolean;
  processedEntries: number;
  lastCheckAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
}

interface UpdaterState {
  store?: FilmlisteStore;
  running?: Promise<UpdateResult>;
  processedEntries: number;
  lastCheckAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  timer?: ReturnType<typeof setInterval>;
}

export type UpdateResult = "updated" | "unchanged" | "failed";

const shared = globalThis as typeof globalThis & { rundfunkarrFilmliste?: UpdaterState };
const state = (shared.rundfunkarrFilmliste ??= {
  processedEntries: 0,
  lastCheckAt: null,
  lastError: null,
  lastErrorAt: null,
});

function getStore(): FilmlisteStore {
  return (state.store ??= new FilmlisteStore(resolveFilmlistePath()));
}

/** Search source: "mediathekviewweb" (public API, default) or "local" (this index). */
export async function isLocalIndexEnabled(): Promise<boolean> {
  return (await getSetting("mediathek.source")) === "local";
}

export async function getUpdateHours(): Promise<number> {
  const hours = Number(await getSetting("mediathek.localIndex.updateHours"));
  return Number.isFinite(hours) && hours >= 1 && hours <= 24 ? hours : DEFAULT_UPDATE_HOURS;
}

function isUsable(info: FilmlisteIndexInfo): boolean {
  return (
    info.listTimestamp !== null &&
    info.entryCount > 0 &&
    Date.now() / 1000 - info.listTimestamp <= MAX_LIST_AGE_SECONDS
  );
}

/**
 * Search the local index. Returns undefined when the caller should use the
 * public API instead (disabled, not ready, outdated, unsupported query or error).
 */
export async function searchLocalFilmliste(
  queries: MediathekQueryField[],
  size: number,
  options: MediathekQueryOptions = {}
): Promise<ApiResultItem[] | undefined> {
  if (!(await isLocalIndexEnabled())) return undefined;
  try {
    const store = getStore();
    if (!isUsable(store.info())) return undefined;
    return store.search(queries, size, options);
  } catch (error) {
    log.warn("Local search failed, using MediathekViewWeb:", error);
    return undefined;
  }
}

export async function getFilmlisteStatus(): Promise<FilmlisteStatus> {
  const enabled = await isLocalIndexEnabled();
  const info: FilmlisteIndexInfo =
    enabled || state.store || fs.existsSync(resolveFilmlistePath())
      ? getStore().info()
      : { entryCount: 0, listTimestamp: null, lastModified: null, importedAt: null, sizeBytes: 0 };
  return {
    ...info,
    enabled,
    updateHours: await getUpdateHours(),
    usable: enabled && isUsable(info),
    running: Boolean(state.running),
    processedEntries: state.processedEntries,
    lastCheckAt: state.lastCheckAt,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt,
  };
}

/** Decompress the .xz stream with the system xz tool (single-threaded, ~70 MB RAM). */
function decompress(body: ReadableStream<Uint8Array>) {
  const xz = spawn("xz", ["-dc", "-T1"], { stdio: ["pipe", "pipe", "pipe"] });
  let killed = false;
  const exited = new Promise<void>((resolve, reject) => {
    let stderr = "";
    xz.stderr.setEncoding("utf8").on("data", (data: string) => (stderr += data));
    xz.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        error.code === "ENOENT"
          ? new Error("Das Programm xz wurde nicht gefunden. Bitte xz installieren.")
          : error
      )
    );
    // A kill after a parse or write error is not an xz failure; that error is reported instead.
    xz.on("close", (code) =>
      code === 0 || killed
        ? resolve()
        : reject(new Error(`xz beendet mit Code ${code}: ${stderr.trim()}`))
    );
  });
  const source = Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>);
  source.on("error", (error) => xz.stdin.destroy(error));
  xz.stdin.on("error", () => {
    // Reported through the exit code or the source error.
  });
  source.pipe(xz.stdin);
  xz.stdout.setEncoding("utf8");
  // Observed later; avoid an unhandled rejection while the stream is still read.
  exited.catch(() => {});
  const kill = () => {
    killed = true;
    source.destroy();
    xz.kill();
  };
  return { text: xz.stdout as AsyncIterable<string>, exited, kill };
}

/**
 * Keep the server responsive between synchronous SQLite batches. Not
 * timers/promises' setImmediate: Next.js patches it and it overflows the stack.
 */
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

async function runUpdate(force: boolean): Promise<UpdateResult> {
  state.lastCheckAt = Date.now();
  state.processedEntries = 0;
  const store = getStore();
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);

  const head = await fetch(FILMLISTE_URL, { method: "HEAD", signal });
  if (!head.ok) throw new Error(`Filmliste nicht erreichbar (HTTP ${head.status})`);
  const lastModified = head.headers.get("last-modified");
  const info = store.info();
  // Mirrors report slightly different Last-Modified times for the same list, and a
  // list is uploaded ~30 minutes after its creation time. Like MediathekViewWeb,
  // only a file at least 40 minutes newer than the current list counts as new.
  const modifiedAt = lastModified ? Date.parse(lastModified) / 1000 : NaN;
  if (
    !force &&
    info.entryCount > 0 &&
    info.listTimestamp !== null &&
    modifiedAt - info.listTimestamp < NEW_LIST_TOLERANCE_SECONDS
  ) {
    return "unchanged";
  }

  const response = await fetch(FILMLISTE_URL, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Download der Filmliste fehlgeschlagen (HTTP ${response.status})`);
  }
  // Leftovers of a failed attempt are invisible but must not reach the next publish.
  while (store.discardPending() > 0) await yieldToEventLoop();
  const xz = decompress(response.body);
  const generation = store.beginImport();
  const stats = { skipped: 0 };
  let listTimestamp: number | null = null;
  let batch: FilmlisteEntry[] = [];
  const flush = async () => {
    store.writeBatch(batch, generation, listTimestamp!);
    state.processedEntries += batch.length;
    batch = [];
    await yieldToEventLoop();
  };
  try {
    for await (const record of parseFilmliste(xz.text, stats)) {
      if (record.type === "meta") {
        listTimestamp = record.listTimestamp;
        continue;
      }
      batch.push(record.entry);
      if (batch.length >= BATCH_SIZE) await flush();
    }
    if (batch.length > 0) await flush();
    await xz.exited;
  } catch (error) {
    xz.kill();
    // xz failing on its own (e.g. not installed) surfaces as a truncated stream; report that.
    const xzError = await xz.exited.then(
      () => null,
      (failure: unknown) => failure
    );
    throw xzError ?? error;
  }
  if (listTimestamp === null || state.processedEntries < MIN_PLAUSIBLE_ENTRIES) {
    throw new Error(
      `Filmliste unvollständig (${state.processedEntries} Einträge); der bisherige Index bleibt unverändert`
    );
  }
  store.finishImport(generation, listTimestamp, lastModified);
  log.info(
    `Imported ${state.processedEntries} entries` +
      (stats.skipped ? `, skipped ${stats.skipped} malformed` : "")
  );
  return "updated";
}

/** Download and import the list unless it is unchanged. Concurrent calls share one run. */
export function updateFilmliste(options: { force?: boolean } = {}): Promise<UpdateResult> {
  state.running ??= runUpdate(options.force ?? false)
    .then((result) => {
      state.lastError = null;
      state.lastErrorAt = null;
      return result;
    })
    .catch((error: unknown) => {
      state.lastError = error instanceof Error ? error.message : String(error);
      state.lastErrorAt = Date.now();
      log.error("Update failed:", error);
      return "failed" as const;
    })
    .finally(() => {
      state.running = undefined;
    });
  return state.running;
}

/** Scheduler tick; exported for tests. */
export async function runScheduledUpdate() {
  if (state.running || !(await isLocalIndexEnabled())) return;
  const intervalMs = (await getUpdateHours()) * 60 * 60 * 1000;
  // Retry failed updates after a quarter of the interval instead of waiting a full cycle.
  // This also applies before the first successful import: each attempt downloads ~80 MB.
  const waitMs = state.lastError ? intervalMs / 4 : intervalMs;
  if (state.lastCheckAt) {
    if (Date.now() - state.lastCheckAt < waitMs) return;
  } else {
    // After a restart, continue the interval from the last successful import.
    const { importedAt } = getStore().info();
    if (importedAt && Date.now() - importedAt < waitMs) return;
  }
  await updateFilmliste();
}

export function startFilmlisteScheduler() {
  if (state.timer) return;
  state.timer = setInterval(() => void runScheduledUpdate().catch(log.error), SCHEDULER_TICK_MS);
  state.timer.unref?.();
}

/** Delete the index files. Fails while an update is running. */
export function deleteFilmlisteIndex(): boolean {
  if (state.running) return false;
  state.store?.close();
  state.store = undefined;
  removeIndexFiles(resolveFilmlistePath());
  state.lastCheckAt = null;
  state.lastError = null;
  state.lastErrorAt = null;
  state.processedEntries = 0;
  return true;
}
