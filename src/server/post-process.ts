import { spawn } from "node:child_process";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { redactLog, createLogger } from "@/lib/logger";
import {
  cancelProcessOnAbort,
  cancellableProcessOptions,
  terminateProcess,
} from "./process-cancellation";

const log = createLogger("Script");

// A hanging script must not block its download slot forever.
const SCRIPT_TIMEOUT_MS = 30 * 60 * 1000;
// Output without line breaks is still logged in bounded pieces.
const MAX_LINE_LENGTH = 4096;

export interface PostProcessJob {
  id: string;
  title: string;
  category: string;
  url: string;
  /** Finished media file inside the job directory, as seen by RundfunkArr. */
  filePath: string;
  /** The same file as reported to Sonarr/Radarr (DOWNLOAD_FOLDER_PATH_MAPPING). */
  storagePath: string;
  size: number;
}

/**
 * Scripts can only be chosen from this directory. It is configured through the
 * environment, so the web UI cannot point RundfunkArr at arbitrary programs.
 * The default lives next to the database (Docker: ./data/scripts).
 */
export function resolveScriptsDirectory(): string {
  if (process.env.POST_PROCESS_SCRIPTS_DIR) {
    return path.resolve(process.env.POST_PROCESS_SCRIPTS_DIR);
  }
  // Prisma resolves a relative DATABASE_URL against prisma/.
  const url = process.env.DATABASE_URL ?? "file:./data/rundfunkarr.db";
  const file = url.replace(/^file:/, "").split("?")[0];
  return path.join(path.dirname(path.resolve(process.cwd(), "prisma", file)), "scripts");
}

function isScriptName(name: string): boolean {
  return name === path.basename(name) && !name.startsWith(".");
}

async function isExecutableFile(file: string): Promise<boolean> {
  try {
    if (!(await fs.stat(file)).isFile()) return false;
    await fs.access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function listPostProcessScripts(
  directory = resolveScriptsDirectory()
): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return [];
  }
  const scripts = await Promise.all(
    names.map(async (name) =>
      isScriptName(name) && (await isExecutableFile(path.join(directory, name))) ? name : null
    )
  );
  return scripts.filter((name): name is string => name !== null).sort((a, b) => a.localeCompare(b));
}

/**
 * Run a user script after a download has finished, like SABnzbd does.
 *
 * The positional parameters and SAB_* variables match SABnzbd, so existing
 * scripts keep working. Script failures never fail the download (SABnzbd's
 * default as well); they are returned as a warning for the history instead.
 */
export async function runPostProcessScript(
  scriptName: string,
  job: PostProcessJob,
  signal?: AbortSignal,
  timeoutMs = SCRIPT_TIMEOUT_MS
): Promise<string | null> {
  const directory = resolveScriptsDirectory();
  const scriptPath = path.join(directory, scriptName);
  if (!isScriptName(scriptName) || !(await isExecutableFile(scriptPath))) {
    log.warn(`${scriptName} not found or not executable in ${directory}`);
    return `Skript ${scriptName} nicht gefunden oder nicht ausführbar.`;
  }

  // The script runs inside the job folder, so a relative download path must
  // be resolved first; the mapped storage path stays as reported to the *arrs.
  const filePath = path.resolve(job.filePath);
  const jobDirectory = path.dirname(filePath);
  const args = [
    jobDirectory, // 1: final directory of the job
    `${job.title}.nzb`, // 2: original NZB name
    job.title, // 3: clean job name
    "", // 4: indexer report number
    job.category, // 5: category
    "", // 6: newsgroup
    "0", // 7: post-processing status (0 = OK)
    "", // 8: failure URL
  ];
  const env = {
    ...process.env,
    SAB_COMPLETE_DIR: jobDirectory,
    SAB_FINAL_NAME: job.title,
    SAB_FILENAME: `${job.title}.nzb`,
    SAB_NZO_ID: job.id,
    SAB_CAT: job.category,
    SAB_PP_STATUS: "0",
    SAB_STATUS: "Completed",
    SAB_BYTES: String(job.size),
    SAB_URL: job.url,
    RUNDFUNKARR_FILE: filePath,
    RUNDFUNKARR_STORAGE_PATH: job.storagePath,
  };

  log.info(`Running ${scriptName} for ${job.title}`);
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let lastLine = "";
    const proc = spawn(scriptPath, args, {
      ...cancellableProcessOptions,
      cwd: jobDirectory,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stopCancellation = cancelProcessOnAbort(proc, signal);
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcess(proc);
    }, timeoutMs);

    const logLine = (line: string) => {
      const text = line.trim();
      if (!text) return;
      lastLine = text;
      log.info(`${scriptName}: ${text}`);
    };
    const readLines = (stream: NodeJS.ReadableStream) => {
      let pending = "";
      // Keeps multibyte characters intact that are split across chunks.
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        const lines = (pending + chunk).split(/\r?\n/);
        pending = lines.pop() ?? "";
        lines.forEach(logLine);
        if (pending.length > MAX_LINE_LENGTH) {
          logLine(pending);
          pending = "";
        }
      });
      stream.on("end", () => logLine(pending));
    };
    readLines(proc.stdout);
    readLines(proc.stderr);

    const finish = (warning: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopCancellation();
      // Script output may contain credentials. Unlike the log, the history is
      // readable without the diagnostics key, so apply the same redaction.
      resolve(warning && redactLog(warning));
    };

    proc.once("error", (error) => {
      log.error(`Could not start ${scriptName}: ${error.message}`);
      finish(`Skript ${scriptName} konnte nicht gestartet werden: ${error.message}`);
    });
    proc.once("close", (code, exitSignal) => {
      if (signal?.aborted) {
        log.warn(`${scriptName} cancelled`);
        return finish(`Skript ${scriptName} wurde abgebrochen.`);
      }
      if (timedOut) {
        log.error(`${scriptName} timed out after ${timeoutMs / 1000}s`);
        return finish(
          `Skript ${scriptName} nach ${Math.round(timeoutMs / 60000)} Minuten abgebrochen.`
        );
      }
      if (code === 0) {
        log.info(`${scriptName} finished`);
        return finish(null);
      }
      // Same format as SABnzbd's history: "Exit(1) <last output line>".
      const status = `Exit(${code ?? exitSignal})`;
      log.error(`${scriptName} failed: ${status}`);
      finish(`Skript ${scriptName}: ${status}${lastLine ? ` ${lastLine}` : ""}`);
    });
  });
}
