export interface TvdbLoginPayload {
  apikey: string;
  pin?: string;
}

export const TVDB_CREDENTIAL_SETTING_KEYS = ["api.tvdb.key", "api.tvdb.pin"] as const;

const TVDB_CREDENTIAL_SETTING_KEY_SET = new Set<string>(TVDB_CREDENTIAL_SETTING_KEYS);

export function isTvdbCredentialSettingKey(key: string): boolean {
  return TVDB_CREDENTIAL_SETTING_KEY_SET.has(key);
}

export function buildTvdbLoginPayload(
  apiKey: string | null | undefined,
  pin?: string | null
): TvdbLoginPayload | null {
  const trimmedApiKey = apiKey?.trim();
  if (!trimmedApiKey) {
    return null;
  }

  const trimmedPin = pin?.trim();
  if (!trimmedPin) {
    return { apikey: trimmedApiKey };
  }

  return { apikey: trimmedApiKey, pin: trimmedPin };
}
