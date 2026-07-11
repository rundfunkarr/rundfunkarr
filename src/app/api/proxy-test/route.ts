import { NextResponse } from "next/server";
import { testProxy, testYtdlp } from "@/server/ytdlp";

// POST /api/proxy-test - Test proxy connection
export async function POST() {
  try {
    // First test if yt-dlp is available
    const ytdlpResult = await testYtdlp();
    if (!ytdlpResult.success) {
      return NextResponse.json({
        success: false,
        error: `yt-dlp not available: ${ytdlpResult.error}`,
      });
    }

    // Test proxy connection
    const proxyResult = await testProxy();
    return NextResponse.json(proxyResult);
  } catch (error) {
    console.error("Proxy test failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// GET /api/proxy-test - Get yt-dlp status
export async function GET() {
  try {
    const result = await testYtdlp();
    return NextResponse.json(result);
  } catch (error) {
    console.error("yt-dlp test failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
