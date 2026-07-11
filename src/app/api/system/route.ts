import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// GET /api/system - Get system information
export async function GET() {
  try {
    // Database stats
    const showsCount = await prisma.tvdbSeries.count();
    const episodesCount = await prisma.tvdbEpisode.count();
    const downloadsCompleted = await prisma.download.count({
      where: { status: "completed" },
    });
    const downloadsInQueue = await prisma.download.count({
      where: { status: { in: ["queued", "downloading", "processing"] } },
    });
    const downloadsFailed = await prisma.download.count({
      where: { status: "failed" },
    });
    const configCount = await prisma.config.count();

    // Database file size
    let dbSizeBytes = 0;
    const dbPath = process.env.DATABASE_URL?.replace("file:", "") || "./prisma/data/rundfunkarr.db";
    const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
    try {
      const stats = fs.statSync(absoluteDbPath);
      dbSizeBytes = stats.size;
    } catch {
      // Database file might not exist yet
    }

    // FFmpeg check
    let ffmpegVersion = null;
    try {
      const output = execSync("ffmpeg -version", { encoding: "utf-8", timeout: 5000 });
      const match = output.match(/ffmpeg version ([^\s]+)/);
      ffmpegVersion = match ? match[1] : "installed";
    } catch {
      ffmpegVersion = null;
    }

    // yt-dlp check
    let ytdlpVersion = null;
    try {
      const output = execSync("yt-dlp --version", { encoding: "utf-8", timeout: 5000 });
      ytdlpVersion = output.trim();
    } catch {
      ytdlpVersion = null;
    }

    // Node.js version
    const nodeVersion = process.version;

    // Process uptime
    const uptimeSeconds = process.uptime();

    return NextResponse.json({
      version: {
        node: nodeVersion,
        ffmpeg: ffmpegVersion,
        ytdlp: ytdlpVersion,
      },
      database: {
        sizeBytes: dbSizeBytes,
        shows: showsCount,
        episodes: episodesCount,
        configEntries: configCount,
      },
      downloads: {
        completed: downloadsCompleted,
        inQueue: downloadsInQueue,
        failed: downloadsFailed,
      },
      uptime: uptimeSeconds,
    });
  } catch (error) {
    console.error("Failed to get system info:", error);
    return NextResponse.json({ error: "Failed to get system info" }, { status: 500 });
  }
}
