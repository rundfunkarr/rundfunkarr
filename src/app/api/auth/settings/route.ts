import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  readAuthJson,
  authResponse,
  ensureAuthConfig,
  getAuthConfig,
  requireSession,
  saveAuthConfig,
  setSessionCookie,
  clearSessionCookie,
} from "@/lib/auth";
import type { AuthConfig } from "@prisma/client";
const publicSettings = (config: AuthConfig) => ({
  enabled: config.enabled,
  username: config.username,
  hasPassword: !!config.passwordHash,
  apiKey: config.apiKey,
});
export async function GET(request: NextRequest) {
  try {
    await requireSession(request, await getAuthConfig());
    return NextResponse.json(publicSettings(await ensureAuthConfig()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return authResponse(error);
  }
}
const schema = z.object({
  enabled: z.boolean(),
  username: z.string().trim().max(64),
  password: z.union([z.literal(""), z.string().min(12).max(256)]).optional(),
  currentPassword: z.string().max(256).optional(),
  regenerateApiKey: z.boolean().optional(),
});
export async function POST(request: NextRequest) {
  try {
    await requireSession(request, await getAuthConfig());
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      throw new AuthError("Ungültiges Datenformat.", 400);
    const input = schema.safeParse(await readAuthJson(request));
    if (!input.success)
      throw new AuthError(
        "Benutzername und Passwort prüfen. Neue Passwörter benötigen mindestens 12 Zeichen.",
        422
      );
    const result = await saveAuthConfig(request, input.data);
    const response = NextResponse.json(publicSettings(result.config), {
      headers: { "Cache-Control": "no-store" },
    });
    if (result.session)
      setSessionCookie(response, request, result.session.token, result.session.data.expiresAt);
    else clearSessionCookie(response, request);
    return response;
  } catch (error) {
    return authResponse(error);
  }
}
