import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

// GET /api/shows - Fetch all cached shows
export async function GET() {
  try {
    const shows = await prisma.tvdbSeries.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { episodes: true },
        },
      },
    });

    return NextResponse.json(shows);
  } catch (error) {
    logger.error("Failed to fetch shows:", error);
    return NextResponse.json({ error: "Failed to fetch shows" }, { status: 500 });
  }
}
