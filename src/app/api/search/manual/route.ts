import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { manualDownload, ManualDownloadError } from "@/services/manual-download";
const schema = z.object({
  url: z.string().trim().url().max(4096),
  quality: z.enum(["low", "standard", "high"]),
});
export async function POST(request: NextRequest) {
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "Bitte einen gültigen Link eingeben." }, { status: 400 });
  try {
    return NextResponse.json(await manualDownload(input.data.url, input.data.quality));
  } catch (error) {
    if (error instanceof ManualDownloadError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("[ManualDownload] failed:", error);
    return NextResponse.json(
      { error: "Der Download konnte nicht hinzugefügt werden." },
      { status: 500 }
    );
  }
}
