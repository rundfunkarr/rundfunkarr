import { NextRequest, NextResponse } from "next/server";
import { authResponse, getAuthConfig, hasSession } from "@/lib/auth";
export async function GET(request: NextRequest) {
  try {
    const config = await getAuthConfig();
    return NextResponse.json(
      { enabled: !!config?.enabled, authenticated: await hasSession(request, config) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return authResponse(error);
  }
}
