import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";

const isWindows = process.platform === "win32";
const APP_DIR = process.cwd();
const FFMPEG_DIR = path.join(APP_DIR, "ffmpeg");
const FFMPEG_PATH = path.join(FFMPEG_DIR, isWindows ? "ffmpeg.exe" : "ffmpeg");

// FFmpeg download URLs
const FFMPEG_WINDOWS_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const FFMPEG_LINUX_URL =
  "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";

export function getFfmpegPath(): string {
  return FFMPEG_PATH;
}

export async function ensureFfmpegExists(): Promise<boolean> {
  try {
    await fs.access(FFMPEG_PATH);
    console.log(`[FFmpeg] Already exists at ${FFMPEG_PATH}`);
    return true;
  } catch {
    // FFmpeg doesn't exist, need to download
    console.log(`[FFmpeg] Not found at ${FFMPEG_PATH}. Starting download...`);
    return downloadFfmpeg();
  }
}

async function downloadFfmpeg(): Promise<boolean> {
  const downloadUrl = isWindows ? FFMPEG_WINDOWS_URL : FFMPEG_LINUX_URL;
  const tempFileName = isWindows ? "ffmpeg.zip" : "ffmpeg.tar.xz";
  const tempFilePath = path.join(APP_DIR, tempFileName);

  try {
    // Create ffmpeg directory
    await fs.mkdir(FFMPEG_DIR, { recursive: true });

    // Download FFmpeg
    console.log(`[FFmpeg] Downloading from ${downloadUrl}`);
    const response = await fetch(downloadUrl);

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download FFmpeg: ${response.statusText}`);
    }

    // Save to temp file
    const fileStream = createWriteStream(tempFilePath);
    // @ts-expect-error - Node.js stream compatibility
    await pipeline(response.body, fileStream);
    console.log(`[FFmpeg] Downloaded to ${tempFilePath}`);

    // Extract based on OS
    if (isWindows) {
      await extractZip(tempFilePath, FFMPEG_DIR);
    } else {
      await extractTarXz(tempFilePath, FFMPEG_DIR);
    }

    // Verify FFmpeg exists
    await fs.access(FFMPEG_PATH);
    console.log(`[FFmpeg] Successfully installed at ${FFMPEG_PATH}`);

    return true;
  } catch (error) {
    console.error("[FFmpeg] Error during download/extraction:", error);
    return false;
  } finally {
    // Cleanup temp file
    try {
      await fs.unlink(tempFilePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  // Use unzip command on Windows via PowerShell or use a library
  // For simplicity, we'll use PowerShell's Expand-Archive
  return new Promise((resolve, reject) => {
    const extractDir = path.join(destDir, "extracted");

    const proc = spawn("powershell", [
      "-Command",
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`,
    ]);

    proc.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`Unzip failed with code ${code}`));
        return;
      }

      try {
        // Find ffmpeg.exe in extracted files
        const ffmpegExe = await findFile(extractDir, "ffmpeg.exe");
        if (ffmpegExe) {
          await fs.rename(ffmpegExe, FFMPEG_PATH);
          console.log(`[FFmpeg] Moved to ${FFMPEG_PATH}`);
        }

        // Cleanup extracted directory
        await fs.rm(extractDir, { recursive: true, force: true });
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    proc.on("error", reject);
  });
}

async function extractTarXz(tarPath: string, destDir: string): Promise<void> {
  const extractDir = path.join(destDir, "extracted");
  await fs.mkdir(extractDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const proc = spawn("tar", ["-xf", tarPath, "-C", extractDir]);

    proc.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`Tar extraction failed with code ${code}`));
        return;
      }

      try {
        // Find ffmpeg binary in extracted files
        const ffmpegBin = await findFile(extractDir, "ffmpeg");
        if (ffmpegBin) {
          await fs.rename(ffmpegBin, FFMPEG_PATH);
          console.log(`[FFmpeg] Moved to ${FFMPEG_PATH}`);

          // Make executable
          await fs.chmod(FFMPEG_PATH, 0o755);
          console.log(`[FFmpeg] Set executable permissions`);
        }

        // Cleanup extracted directory
        await fs.rm(extractDir, { recursive: true, force: true });
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    proc.on("error", reject);
  });
}

async function findFile(dir: string, fileName: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const found = await findFile(fullPath, fileName);
      if (found) return found;
    } else if (entry.name === fileName) {
      return fullPath;
    }
  }

  return null;
}

export interface ConversionResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export async function convertMp4ToMkv(
  mp4Path: string,
  mkvPath: string,
  onProgress?: (percent: number) => void
): Promise<ConversionResult> {
  // Ensure FFmpeg exists
  const ffmpegExists = await ensureFfmpegExists();
  if (!ffmpegExists) {
    return { success: false, error: "FFmpeg not available" };
  }

  // Check if source file exists
  try {
    await fs.access(mp4Path);
  } catch {
    return { success: false, error: `Source file not found: ${mp4Path}` };
  }

  return new Promise((resolve) => {
    // FFmpeg arguments:
    // -i input: input file
    // -map 0:v -map 0:a: copy video and audio streams
    // -c copy: stream copy (no re-encoding)
    // -metadata:s:v:0 language=ger: set German language for video
    // -metadata:s:a:0 language=ger: set German language for audio
    const args = [
      "-i",
      mp4Path,
      "-map",
      "0:v",
      "-map",
      "0:a",
      "-c",
      "copy",
      "-metadata:s:v:0",
      "language=ger",
      "-metadata:s:a:0",
      "language=ger",
      "-y", // Overwrite output
      mkvPath,
    ];

    console.log(`[FFmpeg] Starting conversion: ${mp4Path} -> ${mkvPath}`);
    const proc = spawn(FFMPEG_PATH, args);

    let stderr = "";

    proc.stderr.on("data", (data) => {
      stderr += data.toString();

      // Parse progress from FFmpeg output
      // FFmpeg outputs progress to stderr
      const durationMatch = stderr.match(/Duration: (\d+):(\d+):(\d+)/);
      const timeMatch = data.toString().match(/time=(\d+):(\d+):(\d+)/);

      if (durationMatch && timeMatch && onProgress) {
        const totalSeconds =
          parseInt(durationMatch[1]) * 3600 +
          parseInt(durationMatch[2]) * 60 +
          parseInt(durationMatch[3]);
        const currentSeconds =
          parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);

        if (totalSeconds > 0) {
          const percent = Math.min(100, Math.round((currentSeconds / totalSeconds) * 100));
          onProgress(percent);
        }
      }
    });

    proc.on("close", async (code) => {
      if (code === 0) {
        console.log(`[FFmpeg] Conversion completed: ${mkvPath}`);

        // Delete original MP4 file
        try {
          await fs.unlink(mp4Path);
          console.log(`[FFmpeg] Deleted original file: ${mp4Path}`);
        } catch (err) {
          console.warn(`[FFmpeg] Could not delete original file: ${err}`);
        }

        resolve({ success: true, outputPath: mkvPath });
      } else {
        console.error(`[FFmpeg] Conversion failed with code ${code}`);
        console.error(`[FFmpeg] Error output: ${stderr}`);
        resolve({ success: false, error: `FFmpeg exited with code ${code}` });
      }
    });

    proc.on("error", (err) => {
      console.error(`[FFmpeg] Process error: ${err}`);
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Mux a separately-downloaded video-only file and audio-only file into one
 * output. Used for HLS sources where video and audio had to be downloaded
 * as two independent streams (see downloadHlsStream in ytdlp.ts for why).
 * The output container is determined by outputPath's extension.
 */
export async function mergeVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<ConversionResult> {
  const ffmpegExists = await ensureFfmpegExists();
  if (!ffmpegExists) {
    return { success: false, error: "FFmpeg not available" };
  }

  return new Promise((resolve) => {
    const args = [
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c",
      "copy",
      "-y",
      outputPath,
    ];

    console.log(`[FFmpeg] Muxing video+audio: ${videoPath} + ${audioPath} -> ${outputPath}`);
    const proc = spawn(FFMPEG_PATH, args);

    let stderr = "";

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`[FFmpeg] Mux completed: ${outputPath}`);
        resolve({ success: true, outputPath });
      } else {
        console.error(`[FFmpeg] Mux failed with code ${code}`);
        console.error(`[FFmpeg] Error output: ${stderr}`);
        resolve({ success: false, error: `FFmpeg exited with code ${code}: ${stderr}` });
      }
    });

    proc.on("error", (err) => {
      console.error(`[FFmpeg] Process error: ${err}`);
      resolve({ success: false, error: err.message });
    });
  });
}
