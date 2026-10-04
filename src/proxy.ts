import { NextRequest, NextResponse } from "next/server";
import { AuthError, authorizeRequest, authResponse, requestOrigin } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (
    path === "/login" ||
    path === "/api/health" ||
    path === "/api/auth/session" ||
    path === "/api/auth/login" ||
    path === "/api/auth/logout"
  )
    return NextResponse.next();
  try {
    await authorizeRequest(request);
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof AuthError && error.status === 401 && !path.startsWith("/api")) {
      const url = new URL("/login", requestOrigin(request));
      url.searchParams.set("returnTo", path + request.nextUrl.search);
      const response = NextResponse.redirect(url);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    return authResponse(error);
  }
}
export const config = {
  matcher: ["/((?!_next/static/|_next/image|favicon.ico|icon.svg|icon.png).*)"],
};
