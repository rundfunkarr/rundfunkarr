import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  controlDownload,
  queueOptions,
  setQueuePaused,
  startDownloadProcessing,
} from "@/server/download-queue";
import { prisma } from "@/lib/db";
import { clearSettingsCache } from "@/lib/settings";

const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("settings"),
    parallel: z.number().int().min(1).max(5),
    maxRetries: z.number().int().min(0).max(5),
  }),
  z.object({ action: z.literal("pauseQueue") }),
  z.object({ action: z.literal("resumeQueue") }),
  z.object({ action: z.enum(["pause", "resume", "cancel"]), id: z.string().min(1).max(200) }),
  z.object({
    action: z.literal("priority"),
    id: z.string().min(1).max(200),
    priority: z.union([z.literal(-10), z.literal(0), z.literal(10)]),
  }),
]);
export async function GET() {
  return NextResponse.json(await queueOptions());
}
export async function POST(request: NextRequest) {
  const body = input.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return NextResponse.json({ error: "Ungültige Warteschlangen-Aktion." }, { status: 400 });
  try {
    const action = body.data;
    if (action.action === "settings") {
      await prisma.$transaction(
        Object.entries({
          "download.parallel": action.parallel,
          "download.maxRetries": action.maxRetries,
        }).map(([key, value]) =>
          prisma.config.upsert({
            where: { key },
            create: { key, value: String(value) },
            update: { value: String(value) },
          })
        )
      );
      clearSettingsCache();
      void startDownloadProcessing().catch(console.error);
    } else if (action.action === "pauseQueue" || action.action === "resumeQueue")
      await setQueuePaused(action.action === "pauseQueue");
    else if (
      !(await controlDownload(
        action.id,
        action.action,
        action.action === "priority" ? action.priority : undefined
      ))
    )
      return NextResponse.json(
        { error: "Dieser Auftrag kann in seinem aktuellen Zustand nicht geändert werden." },
        { status: 409 }
      );
    return NextResponse.json({ status: true });
  } catch (error) {
    console.error("[Warteschlange] Aktion fehlgeschlagen:", error);
    return NextResponse.json(
      { error: "Die Warteschlange konnte nicht geändert werden." },
      { status: 500 }
    );
  }
}
