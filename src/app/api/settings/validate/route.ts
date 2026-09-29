import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";
import { isMaskedSetting } from "@/lib/settings-redaction";
import { buildTvdbLoginPayload } from "@/lib/tvdb-auth";

async function resolveCredential(setting: string, value: string): Promise<string> {
  return isMaskedSetting(setting, value) ? (await getSetting(setting)) || "" : value;
}

// Validate saved credentials without returning secrets or provider tokens to the browser.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (
      !body ||
      !["tvdb", "tmdb"].includes(body.provider) ||
      typeof body.key !== "string" ||
      (body.pin !== undefined && typeof body.pin !== "string")
    )
      return NextResponse.json({ valid: false }, { status: 400 });

    const key = await resolveCredential(`api.${body.provider}.key`, body.key);
    if (!key.trim()) return NextResponse.json({ valid: false });
    let response: Response;
    if (body.provider === "tvdb") {
      const pin = await resolveCredential("api.tvdb.pin", body.pin ?? "");
      response = await fetch("https://api4.thetvdb.com/v4/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTvdbLoginPayload(key, pin)),
        signal: AbortSignal.timeout(15000),
      });
    } else {
      const url = new URL("https://api.themoviedb.org/3/configuration");
      url.searchParams.set("api_key", key.trim());
      response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    }
    return NextResponse.json({ valid: response.ok });
  } catch {
    return NextResponse.json({ valid: false });
  }
}
