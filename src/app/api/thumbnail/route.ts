import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";
import { getWebsitePreview, normalizePreviewUrl } from "@/server/website-preview";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/thumbnail?url=<programme page> - preview image of a broadcaster's page
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url") || "";
  if ((await getSetting("search.thumbnails")) === "false") {
    return NextResponse.json({ imageUrl: null, disabled: true });
  }
  // Unsupported hosts simply have no preview; they are never fetched.
  if (!normalizePreviewUrl(url)) return NextResponse.json({ imageUrl: null });
  try {
    return NextResponse.json({ imageUrl: await getWebsitePreview(url) });
  } catch (error) {
    logger.error("Preview lookup failed:", error);
    return NextResponse.json({ imageUrl: null });
  }
}
