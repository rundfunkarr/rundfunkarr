import { NextRequest, NextResponse } from "next/server";
import { readLogs } from "@/lib/logger";
import { requireDiagnosticsAdmin } from "@/lib/diagnostics-auth";
export async function GET(request: NextRequest) {
  const denied = requireDiagnosticsAdmin(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const level = params.get("level") || "all";
  if (!["all", "info", "warn", "error", "debug"].includes(level))
    return NextResponse.json({ error: "Ungültige Protokollstufe." }, { status: 400 });
  const entries = readLogs(level, (params.get("q") || "").slice(0, 200));
  if (params.get("format") === "text")
    return new Response(entries.map((e) => `${e.time} [${e.level}] ${e.message}`).join("\n"), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": "attachment; filename=rundfunkarr-protokoll.txt",
        "Cache-Control": "no-store",
      },
    });
  return NextResponse.json(
    { entries: entries.reverse(), capacity: 500 },
    { headers: { "Cache-Control": "no-store" } }
  );
}
