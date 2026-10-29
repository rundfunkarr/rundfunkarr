import { webhookHeaderSecrets } from "./webhook-headers";

export const WEBHOOK_HEADERS_SETTING = "notifications.webhook.headers";

const CREDENTIAL_KEYS = new Set([
  "api.srgssr.consumerKey",
  "api.srgssr.consumerSecret",
  "api.tvdb.key",
  "api.tvdb.pin",
  "api.tmdb.key",
  "tvdb_token",
  // Notification targets: webhook URLs embed their access token.
  "notifications.webhook.url",
  WEBHOOK_HEADERS_SETTING,
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

/** Values to redact from the log for a stored credential; webhook headers per value, too. */
export function settingSecrets(key: string, value: unknown): string[] {
  if (!CREDENTIAL_KEYS.has(key) || typeof value !== "string" || !value) return [];
  if (value === MASKED_CREDENTIAL) return [];
  return key === WEBHOOK_HEADERS_SETTING ? [value, ...webhookHeaderSecrets(value)] : [value];
}
