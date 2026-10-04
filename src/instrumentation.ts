export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const { installLogger, rememberLogSecret } = await import("@/lib/logger");
      const { prisma } = await import("@/lib/db");
      const { maskSetting } = await import("@/lib/settings-redaction");
      try {
        for (const item of await prisma.config.findMany()) {
          if (maskSetting(item.key, item.value) !== item.value) rememberLogSecret(item.value);
        }
      } catch {
        // Optional preload: still install the logger and mask runtime credentials.
        // Required settings/database initialization below retains its own errors.
      }
      for (const [key, value] of Object.entries(process.env)) {
        if (/KEY|TOKEN|SECRET|PASSWORD|PIN/.test(key)) rememberLogSecret(value);
      }
      installLogger();
    }
    const { initSettingsFromEnv } = await import("@/lib/env-settings");
    const initialized = await initSettingsFromEnv();
    if (initialized > 0) {
      console.log(`Initialized ${initialized} empty settings from environment variables`);
    }
    const { initCacheTTL } = await import("@/lib/cache");
    await initCacheTTL();
    console.log("Cache TTL initialized from database");
  }
}
