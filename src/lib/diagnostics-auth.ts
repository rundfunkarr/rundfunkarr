import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

// Keep this credential outside the editable application settings.
export function requireDiagnosticsAdmin(request: Request): NextResponse | null {
  const expected = process.env.DIAGNOSTICS_ADMIN_KEY;
  if (!expected || expected.length < 32) {
    return NextResponse.json(
      {
        error:
          "Diagnose und Protokoll sind gesperrt. Im Server muss ein Admin-Schlüssel mit mindestens 32 Zeichen konfiguriert werden.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  const supplied = request.headers.get("X-RundfunkArr-Admin-Key") || "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(expected), digest(supplied))) {
    return NextResponse.json(
      { error: "Ein gültiger Admin-Schlüssel ist erforderlich." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  return null;
}
