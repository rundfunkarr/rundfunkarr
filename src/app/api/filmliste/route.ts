import { NextResponse } from "next/server";
import {
  deleteFilmlisteIndex,
  getFilmlisteStatus,
  isLocalIndexEnabled,
  updateFilmliste,
} from "@/server/filmliste";
import { logger } from "@/lib/logger";

// GET /api/filmliste - Status of the local Filmliste index
export async function GET() {
  try {
    return NextResponse.json(await getFilmlisteStatus());
  } catch (error) {
    logger.error("Failed to read Filmliste status:", error);
    return NextResponse.json({ error: "Status konnte nicht gelesen werden." }, { status: 500 });
  }
}

// POST /api/filmliste - Start a full update in the background
export async function POST() {
  if (!(await isLocalIndexEnabled())) {
    return NextResponse.json(
      { error: "Als Suchquelle ist MediathekViewWeb eingestellt, nicht der lokale Index." },
      { status: 409 }
    );
  }
  void updateFilmliste({ force: true });
  return NextResponse.json(await getFilmlisteStatus(), { status: 202 });
}

// DELETE /api/filmliste - Remove the index files
export async function DELETE() {
  if (!deleteFilmlisteIndex()) {
    return NextResponse.json(
      { error: "Während einer Aktualisierung kann der Index nicht gelöscht werden." },
      { status: 409 }
    );
  }
  return NextResponse.json(await getFilmlisteStatus());
}
