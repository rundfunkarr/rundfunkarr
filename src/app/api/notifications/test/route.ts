import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getSetting } from "@/lib/settings";
import { isMaskedSetting } from "@/lib/settings-redaction";
import {
  buildTestPayload,
  NOTIFICATION_TARGETS,
  rememberTargetSecrets,
  sendToTarget,
  TARGET_SETTINGS,
  type NotificationTarget,
  type TargetConfig,
} from "@/server/notifications";

const log = createLogger("Benachrichtigungen");

// POST /api/notifications/test - Send a test message to one target using the form values.
// Masked secrets (unchanged password fields) are resolved from the stored settings.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungültige Anfrage." }, { status: 400 });
  }
  const { target, config } = (body ?? {}) as { target?: unknown; config?: unknown };
  if (!NOTIFICATION_TARGETS.includes(target as NotificationTarget))
    return NextResponse.json({ success: false, error: "Unbekanntes Ziel." }, { status: 400 });
  const input = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const keys = TARGET_SETTINGS[target as NotificationTarget];
  const resolved: TargetConfig = { url: "" };
  for (const field of ["url", "topic", "token"] as const) {
    const key = keys[field];
    if (!key) continue;
    const value = typeof input[field] === "string" ? (input[field] as string) : "";
    resolved[field] = isMaskedSetting(key, value) ? (await getSetting(key)) || "" : value;
  }
  rememberTargetSecrets(target as NotificationTarget, resolved);
  const result = await sendToTarget(
    target as NotificationTarget,
    resolved,
    buildTestPayload(target as NotificationTarget)
  );
  if (!result.success) log.warn(`Testnachricht: ${result.error}`);
  return NextResponse.json({ success: result.success, error: result.error });
}
