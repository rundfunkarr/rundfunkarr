const CREDENTIAL_KEYS = new Set([
  "api.srgssr.consumerKey",
  "api.srgssr.consumerSecret",
  "api.tvdb.key",
  "api.tvdb.pin",
  "api.tmdb.key",
  "tvdb_token",
  // Notification targets: webhook URLs embed their access token.
  "notifications.webhook.url",
  "notifications.discord.url",
  "notifications.ntfy.token",
  "notifications.gotify.token",
]);
const MASKED_CREDENTIAL = "••••••••";

export function maskSetting(key: string, value: string): string {
  return CREDENTIAL_KEYS.has(key) && value ? MASKED_CREDENTIAL : value;
}

export function isMaskedSetting(key: string, value: unknown): boolean {
  return CREDENTIAL_KEYS.has(key) && value === MASKED_CREDENTIAL;
}
