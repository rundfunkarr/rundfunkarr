const SRF_CREDENTIAL_KEYS = new Set(["api.srgssr.consumerKey", "api.srgssr.consumerSecret"]);
const MASKED_CREDENTIAL = "••••••••";

export function maskSetting(key: string, value: string): string {
  return SRF_CREDENTIAL_KEYS.has(key) && value ? MASKED_CREDENTIAL : value;
}

export function isMaskedSetting(key: string, value: unknown): boolean {
  return SRF_CREDENTIAL_KEYS.has(key) && value === MASKED_CREDENTIAL;
}
