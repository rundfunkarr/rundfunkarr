import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { createHash } from "crypto";
import release from "./ytdlp-release.json";
import { getSetting } from "@/lib/settings";

const isWindows = process.platform === "win32";
const APP_DIR = process.cwd();
const YTDLP_DIR = path.join(APP_DIR, "ytdlp");
const YTDLP_PATH = path.join(YTDLP_DIR, isWindows ? "yt-dlp.exe" : "yt-dlp");
// Activity resets this deadline, so long downloads can continue. Allow enough
// silence for retries and FFmpeg remuxing without blocking the queue forever.
const DOWNLOAD_STALL_TIMEOUT_MS = 10 * 60_000;

function releaseAsset(): keyof typeof release.sha256 {
  if (process.platform === "win32" && process.arch === "x64") return "yt-dlp.exe";
  if (process.platform === "darwin") return "yt-dlp_macos";
  if (process.platform === "linux" && ["x64", "arm64"].includes(process.arch)) {
    const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
    const prefix = report.header?.glibcVersionRuntime ? "yt-dlp_linux" : "yt-dlp_musllinux";
    return `${prefix}${process.arch === "arm64" ? "_aarch64" : ""}` as keyof typeof release.sha256;
  }
  throw new Error("Unsupported yt-dlp platform; configure download.ytdlpPath");
}

let installing: Promise<boolean> | null = null;

export function getYtdlpPath(): string {
  return YTDLP_PATH;
}

/**
 * Get the configured yt-dlp path or fall back to default
 */
async function getConfiguredYtdlpPath(): Promise<string> {
  const customPath = await getSetting("download.ytdlpPath");
  if (customPath && customPath.trim()) {
    return customPath.trim();
  }
  return YTDLP_PATH;
}

/**
 * Get proxy URL from settings
 */
async function getProxyUrl(): Promise<string | null> {
  const proxyUrl = await getSetting("download.proxyUrl");
  if (!proxyUrl?.trim()) return null;
  const parsed = new URL(proxyUrl.trim());
  if (
    !["http:", "https:", "socks4:", "socks4a:", "socks5:", "socks5h:"].includes(parsed.protocol)
  ) {
    throw new Error("Unsupported proxy protocol");
  }
  return proxyUrl.trim();
}

/**
 * Ensure yt-dlp exists, download if necessary
 */
export async function ensureYtdlpExists(): Promise<boolean> {
  const ytdlpPath = await getConfiguredYtdlpPath();

  try {
    await fs.access(ytdlpPath);
    console.log(`[yt-dlp] Already exists at ${ytdlpPath}`);
    return true;
  } catch {
    // If using custom path and it doesn't exist, that's an error
    const customPath = await getSetting("download.ytdlpPath");
    if (customPath && customPath.trim()) {
      console.error(`[yt-dlp] Custom path configured but not found: ${customPath}`);
      return false;
    }

    // Default path doesn't exist, try to download
    console.log(`[yt-dlp] Not found at ${ytdlpPath}. Starting download...`);
    if (!installing)
      installing = downloadYtdlp().finally(() => {
        installing = null;
      });
    return installing;
  }
}

async function downloadYtdlp(): Promise<boolean> {
  const temporaryPath = `${YTDLP_PATH}.tmp`;
  try {
    const asset = releaseAsset();
    const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${release.version}/${asset}`;
    // Create ytdlp directory
    await fs.mkdir(YTDLP_DIR, { recursive: true });

    // Download yt-dlp
    console.log(`[yt-dlp] Downloading from ${downloadUrl}`);
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(120000) });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download yt-dlp: ${response.statusText}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== release.sha256[asset]) {
      throw new Error("yt-dlp checksum mismatch");
    }
    await fs.writeFile(temporaryPath, bytes, { mode: 0o755 });
    await fs.rename(temporaryPath, YTDLP_PATH);
    console.log(`[yt-dlp] Successfully installed at ${YTDLP_PATH}`);

    return true;
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    console.error("[yt-dlp] Error during download:", error);
    return false;
  }
}

export interface YtdlpVideoInfo {
  id: string;
  title: string;
  description: string;
  duration: number; // in seconds
  url: string; // direct URL or best format URL
  ext: string; // file extension
  filesize?: number;
  formats?: YtdlpFormat[];
  webpage_url?: string;
  thumbnail?: string;
  upload_date?: string; // YYYYMMDD format
  channel?: string;
  uploader?: string;
  series?: string;
  season_number?: number;
  episode_number?: number;
}

export interface YtdlpPlaylistEntry {
  id: string;
  title: string;
  url: string;
  duration?: number;
  description?: string;
  thumbnail?: string;
  upload_date?: string;
  channel?: string;
  uploader?: string;
  series?: string;
  season_number?: number;
  episode_number?: number;
}

export interface YtdlpFormat {
  format_id: string;
  ext: string;
  resolution?: string;
  height?: number;
  width?: number;
  filesize?: number;
  url: string;
}

export interface YtdlpDownloadResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export interface YtdlpDownloadOptions {
  outputPath: string;
  format?: string; // e.g., "bestvideo+bestaudio/best"
  useProxy?: boolean;
  container?: "mkv" | "mp4";
  onProgress?: (percent: number, speed: string, eta: string) => void | Promise<void>;
}

/**
 * Check if a URL is an HLS stream
 */
export { isHlsUrl } from "@/lib/stream-url";

/**
 * Get video metadata using yt-dlp
 */
export async function getVideoInfo(url: string): Promise<YtdlpVideoInfo | null> {
  const ytdlpExists = await ensureYtdlpExists();
  if (!ytdlpExists) {
    console.error("[yt-dlp] yt-dlp not available");
    return null;
  }

  const ytdlpPath = await getConfiguredYtdlpPath();
  const proxyUrl = await getProxyUrl();

  const args = ["--dump-json", "--no-warnings", "--no-playlist"];

  if (proxyUrl) {
    args.push("--proxy", proxyUrl);
  }

  args.push(url);

  return new Promise((resolve) => {
    let resolved = false;
    console.log(`[yt-dlp] Getting info for: ${url}`);
    const proc = spawn(ytdlpPath, args);

    let stdout = "";
    let stderr = "";

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      proc.kill();
      console.error("[yt-dlp] Video info extraction timeout");
      resolve(null);
    }, 30000);

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      if (code === 0 && stdout) {
        try {
          const info = JSON.parse(stdout);
          resolve({
            id: info.id || "",
            title: info.title || "",
            description: info.description || "",
            duration: info.duration || 0,
            url: info.url || info.webpage_url || url,
            ext: info.ext || "mp4",
            filesize: info.filesize || info.filesize_approx,
            formats: info.formats?.map((f: Record<string, unknown>) => ({
              format_id: f.format_id,
              ext: f.ext,
              resolution: f.resolution,
              height: f.height,
              width: f.width,
              filesize: f.filesize || f.filesize_approx,
              url: f.url,
            })),
          });
        } catch (parseError) {
          console.error("[yt-dlp] Failed to parse JSON output:", parseError);
          resolve(null);
        }
      } else {
        console.error(`[yt-dlp] Failed with code ${code}: ${stderr}`);
        resolve(null);
      }
    });

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      console.error("[yt-dlp] Process error:", err);
      resolve(null);
    });
  });
}

/**
 * Download a video using yt-dlp (for HLS streams)
 */
export async function downloadVideo(
  url: string,
  options: YtdlpDownloadOptions
): Promise<YtdlpDownloadResult> {
  const ytdlpExists = await ensureYtdlpExists();
  if (!ytdlpExists) {
    return { success: false, error: "yt-dlp not available" };
  }

  // Native installations keep FFmpeg outside PATH. Initialize it lazily so
  // ordinary direct downloads still work without loading the conversion module.
  const { ensureFfmpegExists, getFfmpegPath } = await import("./ffmpeg");
  if (!(await ensureFfmpegExists())) {
    return { success: false, error: "FFmpeg not available for stream remuxing" };
  }

  const ytdlpPath = await getConfiguredYtdlpPath();
  const proxyUrl = options.useProxy !== false ? await getProxyUrl() : null;

  // Ensure output directory exists
  const outputDir = path.dirname(options.outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  const args = [
    "--ffmpeg-location",
    getFfmpegPath(),
    "-o",
    options.outputPath,
    "--no-playlist",
    "--no-warnings",
    "--progress",
    "--newline", // Output progress on new lines for parsing
  ];

  // Format selection - prefer direct video/audio merge for best quality
  if (options.format) {
    args.push("-f", options.format);
  } else {
    // Default: best video + best audio, or best combined
    args.push("-f", "bestvideo+bestaudio/best");
  }

  // Merge to MKV container
  args.push(
    "--merge-output-format",
    options.container || "mkv",
    "--remux-video",
    options.container || "mkv"
  );

  // Add proxy if configured
  if (proxyUrl) {
    args.push("--proxy", proxyUrl);
  }

  args.push(url);

  return new Promise((resolve) => {
    console.log(`[yt-dlp] Starting download: ${url} -> ${options.outputPath}`);
    const proc = spawn(ytdlpPath, args);

    let stderr = "";
    let progressUpdates = Promise.resolve();
    let progressError: unknown;
    let ended = false;
    let stallTimer: ReturnType<typeof setTimeout>;
    const resetStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        ended = true;
        proc.kill("SIGKILL");
        resolve({ success: false, error: "yt-dlp timed out after 10 minutes without output" });
      }, DOWNLOAD_STALL_TIMEOUT_MS);
    };
    resetStallTimer();

    proc.stdout.on("data", (data) => {
      if (ended) return;
      resetStallTimer();
      const line = data.toString();

      // Parse progress from yt-dlp output
      // Format: [download]  45.2% of ~500.00MiB at 10.50MiB/s ETA 00:25
      const progressMatch = line.match(
        /\[download\]\s+(\d+(?:\.\d+)?%)\s+of\s+[~]?[\d.]+\w+\s+at\s+([\d.]+\w+\/s)\s+ETA\s+(\d+:\d+)/
      );

      if (progressMatch && options.onProgress) {
        const percent = parseFloat(progressMatch[1]);
        const speed = progressMatch[2];
        const eta = progressMatch[3];
        progressUpdates = progressUpdates
          .then(() => options.onProgress?.(percent, speed, eta))
          .catch((error) => {
            progressError = error;
            proc.kill();
          });
      }
    });

    proc.stderr.on("data", (data) => {
      if (ended) return;
      resetStallTimer();
      stderr += data.toString();
    });

    proc.on("close", async (code) => {
      clearTimeout(stallTimer);
      if (ended) return;
      ended = true;
      await progressUpdates;
      if (progressError) {
        resolve({ success: false, error: "Failed to persist download progress" });
        return;
      }
      if (code === 0) {
        // Verify output file exists
        const expectedOutput = options.outputPath.replace(
          /\.[^.]+$/,
          `.${options.container || "mkv"}`
        );
        try {
          await fs.access(expectedOutput);
          console.log(`[yt-dlp] Download completed: ${expectedOutput}`);
          resolve({ success: true, outputPath: expectedOutput });
        } catch {
          // Try original path
          try {
            await fs.access(options.outputPath);
            console.log(`[yt-dlp] Download completed: ${options.outputPath}`);
            resolve({ success: true, outputPath: options.outputPath });
          } catch {
            resolve({ success: false, error: "Output file not found after download" });
          }
        }
      } else {
        console.error(`[yt-dlp] Download failed with code ${code}: ${stderr}`);
        resolve({ success: false, error: stderr || `Exit code ${code}` });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(stallTimer);
      if (ended) return;
      ended = true;
      console.error("[yt-dlp] Process error:", err);
      resolve({ success: false, error: err.message });
    });
  });
}

// Parse a yt-dlp speed string (e.g. "10.50MiB/s") into bytes/sec.
function parseYtdlpSpeed(speedStr: string): number {
  const speedMatch = speedStr.match(/([\d.]+)(\w+)\/s/);
  if (!speedMatch) return 0;
  const value = parseFloat(speedMatch[1]);
  const unit = speedMatch[2].toLowerCase();
  if (unit.includes("g")) return value * 1024 * 1024 * 1024;
  if (unit.includes("m")) return value * 1024 * 1024;
  if (unit.includes("k")) return value * 1024;
  return value;
}

/**
 * Download HLS stream to MKV file
 *
 * Downloads video and audio as two separate yt-dlp invocations and muxes
 * them locally, rather than a single "bestvideo+bestaudio" yt-dlp call.
 *
 * Some HLS masters (observed on ORF's APA CDN, e.g. on.orf.at content)
 * declare audio as a separate #EXT-X-MEDIA group rather than muxed into
 * each video rendition. yt-dlp's format selector can't confirm from this
 * manifest shape that the video-only renditions truly lack audio (it
 * reports their acodec as unknown, not the literal "none"), so
 * "bestvideo+bestaudio" silently resolves to just the video-only format
 * instead of erroring or falling back - the merge is dropped, not
 * attempted, and the resulting file has no audio track at all. Every
 * individual format (video-only, audio-only) downloads correctly on its
 * own though, so this sidesteps the broken "+" merge entirely by
 * downloading each half separately and combining them with our own
 * ffmpeg pass.
 */
export async function downloadHlsStream(
  hlsUrl: string,
  outputPath: string,
  onProgress?: (
    percent: number,
    downloadedBytes: number,
    totalBytes: number,
    speed: number
  ) => Promise<void>,
  // The output container is determined by outputPath's own extension (the
  // caller already builds it with the right one) since the final merge
  // writes straight to outputPath - kept for API compatibility with callers.
  _container: "mkv" | "mp4" = "mkv",
  maxHeight?: 480 | 720 | 1080
): Promise<YtdlpDownloadResult> {
  const tempDir = path.dirname(outputPath);
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const videoTempPath = path.join(tempDir, `.hls-video-${uid}.mp4`);
  const audioTempPath = path.join(tempDir, `.hls-audio-${uid}.mp4`);
  // Tracks whatever the video/audio download actually produced, so the
  // finally block below always cleans up the right path - including when
  // downloadVideo/mergeVideoAudio reject before ever reporting a result
  // (see the catch block).
  let videoOutputPath = videoTempPath;
  let audioOutputPath = audioTempPath;

  let lastOverallPercent = 0;
  const forwardProgress =
    (base: number, span: number) => async (percent: number, speedStr: string) => {
      if (!onProgress) return;
      const overall = base + (percent / 100) * span;
      if (overall <= lastOverallPercent) return;
      lastOverallPercent = overall;
      await onProgress(overall, 0, 0, parseYtdlpSpeed(speedStr));
    };

  try {
    const videoResult = await downloadVideo(hlsUrl, {
      outputPath: videoTempPath,
      container: "mp4",
      format: maxHeight
        ? `bestvideo[height<=${maxHeight}]/best[height<=${maxHeight}]`
        : "bestvideo/best",
      onProgress: forwardProgress(0, 85),
    });
    videoOutputPath = videoResult.outputPath ?? videoTempPath;
    if (!videoResult.success) {
      return videoResult;
    }

    const audioResult = await downloadVideo(hlsUrl, {
      outputPath: audioTempPath,
      container: "mp4",
      // "/best" fallback: some HLS masters only expose combined
      // #EXT-X-STREAM-INF variants with no separate audio-only format, so
      // bare "bestaudio" would have no match there and error out.
      // mergeVideoAudio only ever maps this input's audio stream, so it's
      // safe to hand it a combined video+audio file here too.
      format: maxHeight ? `bestaudio/best[height<=${maxHeight}]` : "bestaudio/best",
      onProgress: forwardProgress(85, 10),
    });
    audioOutputPath = audioResult.outputPath ?? audioTempPath;
    if (!audioResult.success) {
      return audioResult;
    }

    const { mergeVideoAudio } = await import("./ffmpeg");
    const mergeResult = await mergeVideoAudio(videoOutputPath, audioOutputPath, outputPath);
    if (!mergeResult.success) {
      await fs.unlink(outputPath).catch(() => {});
      return { success: false, error: mergeResult.error };
    }

    if (onProgress) {
      // The mux already succeeded and the final file is in place - a
      // failure to report the closing 100% shouldn't turn an otherwise-
      // complete download into a reported failure (the caller would then
      // skip moving the finished file and mark a successful download as
      // failed instead).
      await onProgress(100, 0, 0, 0).catch((error) => {
        console.error("[downloadHlsStream] Failed to report final progress:", error);
      });
    }

    return { success: true, outputPath: mergeResult.outputPath };
  } catch (error) {
    // downloadVideo/mergeVideoAudio can reject before their own process
    // handlers ever run (a bad proxy URL, a DB read failure fetching
    // settings, fs.mkdir failing, ...) - catch that here so this function
    // keeps its documented contract of always resolving, and so the
    // finally block below still runs to clean up temp files either way.
    console.error("[downloadHlsStream] Failed:", error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    // Failed yt-dlp downloads can leave .part, .ytdl and fragment files.
    // Match this attempt's UID plus the extension separator so concurrent
    // downloads and their sidecars remain untouched.
    const prefixes = [`.hls-video-${uid}.`, `.hls-audio-${uid}.`];
    const entries = await fs.readdir(tempDir).catch(() => [] as string[]);
    const cleanupPaths = new Set([
      videoOutputPath,
      audioOutputPath,
      ...entries
        .filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))
        .map((name) => path.join(tempDir, name)),
    ]);
    await Promise.all([...cleanupPaths].map((file) => fs.unlink(file).catch(() => {})));
  }
}

/**
 * Test if yt-dlp is working correctly
 */
export async function testYtdlp(): Promise<{ success: boolean; version?: string; error?: string }> {
  const ytdlpExists = await ensureYtdlpExists();
  if (!ytdlpExists) {
    return { success: false, error: "yt-dlp not available" };
  }

  const ytdlpPath = await getConfiguredYtdlpPath();

  return new Promise((resolve) => {
    const proc = spawn(ytdlpPath, ["--version"]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && stdout) {
        resolve({ success: true, version: stdout.trim() });
      } else {
        resolve({ success: false, error: stderr || `Exit code ${code}` });
      }
    });

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Test proxy connection using yt-dlp
 */
export async function testProxy(
  testUrl: string = "https://www.srf.ch"
): Promise<{ success: boolean; error?: string }> {
  const proxyUrl = await getProxyUrl();
  if (!proxyUrl) {
    return { success: false, error: "No proxy configured" };
  }

  const ytdlpExists = await ensureYtdlpExists();
  if (!ytdlpExists) {
    return { success: false, error: "yt-dlp not available" };
  }

  const ytdlpPath = await getConfiguredYtdlpPath();

  return new Promise((resolve) => {
    let resolved = false;
    // Use yt-dlp to test connectivity through proxy
    const proc = spawn(ytdlpPath, ["--proxy", proxyUrl, "--simulate", "--no-warnings", testUrl]);

    let stderr = "";

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      proc.kill();
      resolve({ success: false, error: "Connection timeout" });
    }, 30000);

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr || `Connection failed (code ${code})` });
      }
    });

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Extract playlist entries from a URL using yt-dlp --flat-playlist
 * Used for search functionality where we need to get a list of videos without downloading
 */
export async function extractPlaylistEntries(
  url: string,
  maxEntries: number = 50
): Promise<YtdlpPlaylistEntry[]> {
  const ytdlpExists = await ensureYtdlpExists();
  if (!ytdlpExists) {
    console.error("[yt-dlp] yt-dlp not available");
    return [];
  }

  const ytdlpPath = await getConfiguredYtdlpPath();
  const proxyUrl = await getProxyUrl();

  const args = [
    "--flat-playlist",
    "--dump-json",
    "--no-warnings",
    "--playlist-end",
    maxEntries.toString(),
  ];

  if (proxyUrl) {
    args.push("--proxy", proxyUrl);
  }

  args.push(url);

  return new Promise((resolve) => {
    let resolved = false;
    console.log(`[yt-dlp] Extracting playlist entries from: ${url}`);
    const proc = spawn(ytdlpPath, args);

    let stdout = "";
    let stderr = "";

    // Timeout after 60 seconds for search operations
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      proc.kill();
      console.error("[yt-dlp] Playlist extraction timeout");
      resolve([]);
    }, 60000);

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      if (code === 0 && stdout) {
        try {
          // Each line is a separate JSON object
          const entries: YtdlpPlaylistEntry[] = [];
          const lines = stdout.trim().split("\n");

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line);
              entries.push({
                id: entry.id || "",
                title: entry.title || "",
                url: entry.url || entry.webpage_url || "",
                duration: entry.duration || 0,
                description: entry.description || "",
                thumbnail: entry.thumbnail || entry.thumbnails?.[0]?.url || "",
                upload_date: entry.upload_date || "",
                channel: entry.channel || entry.uploader || "",
                uploader: entry.uploader || "",
                series: entry.series || "",
                season_number: entry.season_number,
                episode_number: entry.episode_number,
              });
            } catch {
              // Skip invalid JSON lines
              continue;
            }
          }

          console.log(`[yt-dlp] Extracted ${entries.length} playlist entries`);
          resolve(entries);
        } catch (parseError) {
          console.error("[yt-dlp] Failed to parse playlist output:", parseError);
          resolve([]);
        }
      } else {
        if (stderr) {
          console.error(`[yt-dlp] Playlist extraction failed: ${stderr}`);
        }
        resolve([]);
      }
    });

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      console.error("[yt-dlp] Process error:", err);
      resolve([]);
    });
  });
}

/**
 * Get detailed video info for a single URL
 * Returns more detailed metadata than extractPlaylistEntries
 */
export async function getDetailedVideoInfo(url: string): Promise<YtdlpVideoInfo | null> {
  const ytdlpExists = await ensureYtdlpExists();
  if (!ytdlpExists) {
    console.error("[yt-dlp] yt-dlp not available");
    return null;
  }

  const ytdlpPath = await getConfiguredYtdlpPath();
  const proxyUrl = await getProxyUrl();

  const args = ["--dump-json", "--no-warnings", "--no-playlist"];

  if (proxyUrl) {
    args.push("--proxy", proxyUrl);
  }

  args.push(url);

  return new Promise((resolve) => {
    let resolved = false;
    console.log(`[yt-dlp] Getting detailed info for: ${url}`);
    const proc = spawn(ytdlpPath, args);

    let stdout = "";
    let stderr = "";

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      proc.kill();
      console.error("[yt-dlp] Video info extraction timeout");
      resolve(null);
    }, 30000);

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      if (code === 0 && stdout) {
        try {
          const info = JSON.parse(stdout);
          resolve({
            id: info.id || "",
            title: info.title || "",
            description: info.description || "",
            duration: info.duration || 0,
            url: info.url || info.webpage_url || url,
            ext: info.ext || "mp4",
            filesize: info.filesize || info.filesize_approx,
            webpage_url: info.webpage_url || "",
            thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || "",
            upload_date: info.upload_date || "",
            channel: info.channel || info.uploader || "",
            uploader: info.uploader || "",
            series: info.series || "",
            season_number: info.season_number,
            episode_number: info.episode_number,
            formats: info.formats?.map((f: Record<string, unknown>) => ({
              format_id: f.format_id,
              ext: f.ext,
              resolution: f.resolution,
              height: f.height,
              width: f.width,
              filesize: f.filesize || f.filesize_approx,
              url: f.url,
            })),
          });
        } catch (parseError) {
          console.error("[yt-dlp] Failed to parse JSON output:", parseError);
          resolve(null);
        }
      } else {
        console.error(`[yt-dlp] Failed with code ${code}: ${stderr}`);
        resolve(null);
      }
    });

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      console.error("[yt-dlp] Process error:", err);
      resolve(null);
    });
  });
}
