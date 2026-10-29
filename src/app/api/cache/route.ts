import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mediathekCache, tvdbCache, rulesetsCache } from "@/lib/cache";
import { logger } from "@/lib/logger";

// DELETE /api/cache - Clear all caches
export async function DELETE() {
  try {
    // Clear in-memory caches
    mediathekCache.clear();
    tvdbCache.clear();
    rulesetsCache.clear();

    // Clear database caches (TVDB series and episodes)
    const deletedEpisodes = await prisma.tvdbEpisode.deleteMany({});
    const deletedSeries = await prisma.tvdbSeries.deleteMany({});

    return NextResponse.json({
      success: true,
      cleared: {
        memoryCaches: ["mediathekCache", "tvdbCache", "rulesetsCache"],
        tvdbSeries: deletedSeries.count,
        tvdbEpisodes: deletedEpisodes.count,
      },
    });
  } catch (error) {
    logger.error("Failed to clear cache:", error);
    return NextResponse.json({ error: "Failed to clear cache" }, { status: 500 });
  }
}

// GET /api/cache - Get cache statistics
export async function GET() {
  try {
    const seriesCount = await prisma.tvdbSeries.count();
    const episodesCount = await prisma.tvdbEpisode.count();

    return NextResponse.json({
      tvdbSeries: seriesCount,
      tvdbEpisodes: episodesCount,
    });
  } catch (error) {
    logger.error("Failed to get cache stats:", error);
    return NextResponse.json({ error: "Failed to get cache stats" }, { status: 500 });
  }
}
