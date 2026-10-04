import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  authResponse,
  isSameOrigin,
  login,
  readAuthJson,
  setSessionCookie,
} from "@/lib/auth";
const schema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  remember: z.boolean().default(false),
});
export async function POST(request: NextRequest) {
  try {
    if (
      !isSameOrigin(request, true) ||
      !request.headers.get("Content-Type")?.startsWith("application/json")
    )
      throw new AuthError("Anfrage von einer fremden Seite abgelehnt.", 403);
    const input = schema.safeParse(await readAuthJson(request));
    if (!input.success) throw new AuthError("Benutzername und Passwort prüfen.", 400);
    const session = await login(input.data.username, input.data.password, input.data.remember);
    const response = NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } }
    );
    setSessionCookie(response, request, session.token, session.data.expiresAt);
    return response;
  } catch (error) {
    return authResponse(error);
  }
}
