export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initSettingsFromEnv } = await import("@/lib/env-settings");
    const initialized = await initSettingsFromEnv();
    if (initialized > 0) {
      console.log(`Initialized ${initialized} empty settings from environment variables`);
    }
    const { initCacheTTL } = await import("@/lib/cache");
    await initCacheTTL();
    console.log("Cache TTL initialized from database");
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const { recoverDownloads } = await import("@/server/download-queue");
      await recoverDownloads();
    }
  }
}
