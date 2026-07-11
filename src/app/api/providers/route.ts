import { NextResponse } from "next/server";
import { providerRegistry, initializeProviders } from "@/providers";

/**
 * GET /api/providers - List all providers and their status
 */
export async function GET() {
  try {
    await initializeProviders();

    const providerInfo = providerRegistry.getProviderInfo();
    const statuses = await providerRegistry.getProvidersStatus();

    const providers = providerInfo.map((info) => ({
      ...info,
      status: statuses[info.id],
    }));

    return NextResponse.json({ providers });
  } catch (error) {
    console.error("Failed to get providers:", error);
    return NextResponse.json({ error: "Failed to get providers" }, { status: 500 });
  }
}
