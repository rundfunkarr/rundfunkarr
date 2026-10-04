import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  authResponse,
  isSameOrigin,
  clearSessionCookie,
  SESSION_COOKIE,
  tokenHash,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request, true))
      throw new AuthError("Anfrage von einer fremden Seite abgelehnt.", 403);
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token) await prisma.authSession.deleteMany({ where: { tokenHash: tokenHash(token) } });
    const response = NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } }
    );
    clearSessionCookie(response, request);
    return response;
  } catch (error) {
    return authResponse(error);
  }
}
