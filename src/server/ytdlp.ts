import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { getSetting } from "@/lib/settings";

const isWindows = process.platform === "win32";
const APP_DIR = process.cwd();
const YTDLP_DIR = path.join(APP_DIR, "ytdlp");
const YTDLP_PATH = path.join(YTDLP_DIR, isWindows ? "yt-dlp.exe" : "yt-dlp");

// yt-dlp download URLs
const YTDLP_WINDOWS_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const YTDLP_LINUX_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

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
  return proxyUrl && proxyUrl.trim() ? proxyUrl.trim() : null;
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
    return downloadYtdlp();
  }
}

async function downloadYtdlp(): Promise<boolean> {
  const downloadUrl = isWindows ? YTDLP_WINDOWS_URL : YTDLP_LINUX_URL;

  try {
    // Create ytdlp directory
    await fs.mkdir(YTDLP_DIR, { recursive: true });

    // Download yt-dlp
    console.log(`[yt-dlp] Downloading from ${downloadUrl}`);
    const response = await fetch(downloadUrl);

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download yt-dlp: ${response.statusText}`);
    }

    // Save to file
    const fileStream = createWriteStream(YTDLP_PATH);
    // @ts-expect-error - Node.js stream compatibility
    await pipeline(response.body, fileStream);
    console.log(`[yt-dlp] Downloaded to ${YTDLP_PATH}`);

    // Make executable on Linux/Mac
    if (!isWindows) {
      await fs.chmod(YTDLP_PATH, 0o755);
      console.log(`[yt-dlp] Set executable permissions`);
    }

    // Verify it exists
    await fs.access(YTDLP_PATH);
    console.log(`[yt-dlp] Successfully installed at ${YTDLP_PATH}`);

    return true;
  } catch (error) {
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
  onProgress?: (percent: number, speed: string, eta: string) => void;
}

/**
 * Check if a URL is an HLS stream
 */
export function isHlsUrl(url: string): boolean {
  return url.endsWith(".m3u8") || url.includes(".m3u8?");
}

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

  const ytdlpPath = await getConfiguredYtdlpPath();
  const proxyUrl = options.useProxy !== false ? await getProxyUrl() : null;

  // Ensure output directory exists
  const outputDir = path.dirname(options.outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  const args = [
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
  args.push("--merge-output-format", "mkv");

  // Add proxy if configured
  if (proxyUrl) {
    args.push("--proxy", proxyUrl);
  }

  args.push(url);

  return new Promise((resolve) => {
    console.log(`[yt-dlp] Starting download: ${url} -> ${options.outputPath}`);
    const proc = spawn(ytdlpPath, args);

    let stderr = "";

    proc.stdout.on("data", (data) => {
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
        options.onProgress(percent, speed, eta);
      }
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", async (code) => {
      if (code === 0) {
        // Verify output file exists
        const expectedOutput = options.outputPath.replace(/\.[^.]+$/, ".mkv");
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
      console.error("[yt-dlp] Process error:", err);
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Download HLS stream to MKV file
 * Simplified wrapper for HLS downloads with progress tracking
 */
export async function downloadHlsStream(
  hlsUrl: string,
  outputPath: string,
  onProgress?: (
    percent: number,
    downloadedBytes: number,
    totalBytes: number,
    speed: number
  ) => Promise<void>
): Promise<YtdlpDownloadResult> {
  let lastPercent = 0;

  return downloadVideo(hlsUrl, {
    outputPath,
    format: "bestvideo+bestaudio/best",
    onProgress: async (percent, speedStr) => {
      if (onProgress && percent > lastPercent) {
        lastPercent = percent;

        // Parse speed string (e.g., "10.50MiB/s") to bytes/sec
        let speedBytes = 0;
        const speedMatch = speedStr.match(/([\d.]+)(\w+)\/s/);
        if (speedMatch) {
          const value = parseFloat(speedMatch[1]);
          const unit = speedMatch[2].toLowerCase();
          if (unit.includes("g")) {
            speedBytes = value * 1024 * 1024 * 1024;
          } else if (unit.includes("m")) {
            speedBytes = value * 1024 * 1024;
          } else if (unit.includes("k")) {
            speedBytes = value * 1024;
          } else {
            speedBytes = value;
          }
        }

        // We don't have accurate total bytes for HLS, estimate based on progress
        const estimatedTotal = 0; // Unknown for HLS
        const estimatedDownloaded = 0;

        await onProgress(percent, estimatedDownloaded, estimatedTotal, speedBytes);
      }
    },
  });
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
