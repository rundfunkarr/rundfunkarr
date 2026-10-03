import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { systemDiagnostics, testArrConnection } from "@/server/diagnostics";
export async function GET() {
  try {
    return NextResponse.json(
      { checks: await systemDiagnostics() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Die Diagnose konnte nicht abgeschlossen werden." },
      { status: 500 }
    );
  }
}
const schema = z.object({
  kind: z.enum(["sonarr", "radarr"]),
  url: z.string().url().max(2048),
  apiKey: z.string().trim().min(1).max(500),
});
export async function POST(request: NextRequest) {
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "Anwendung, Basisadresse und API-Schlüssel prüfen." },
      { status: 400 }
    );
  try {
    return NextResponse.json({
      check: await testArrConnection(input.data.kind, input.data.url, input.data.apiKey),
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Bitte eine HTTP-/HTTPS-Basisadresse ohne Zugangsdaten, Parameter oder Fragment eingeben.",
      },
      { status: 400 }
    );
  }
}
