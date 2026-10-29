/**
 * Extra HTTP headers for the generic notification webhook, one `Name: Wert` per line.
 * Shared by the settings form, the settings API and the sender, so all three agree on
 * what is valid. Error messages never contain header values; they may hold secrets.
 */

export const MAX_WEBHOOK_HEADERS = 20;
const MAX_VALUE_LENGTH = 4096;
/** RFC 9110 token characters. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** Visible ASCII, space and tab; this also rules out CR/LF injection. */
const HEADER_VALUE = /^[\t\x20-\x7e]*$/;
/** Headers RundfunkArr sets itself or that only the HTTP client may control. */
const RESERVED = new Set([
  "content-type",
  "content-length",
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "expect",
]);

export type WebhookHeadersResult =
  { headers: Record<string, string>; error?: undefined } | { headers?: undefined; error: string };

function lines(text: string) {
  return text.split(/\r?\n/);
}

export function parseWebhookHeaders(text: string | null | undefined): WebhookHeadersResult {
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  const all = lines(text ?? "");
  for (let index = 0; index < all.length; index++) {
    const line = all[index];
    if (!line.trim()) continue;
    const at = `Zeile ${index + 1}`;
    const colon = line.indexOf(":");
    if (colon <= 0) return { error: `${at}: „Name: Wert“ erwartet.` };
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!HEADER_NAME.test(name)) return { error: `${at}: ungültiger Header-Name.` };
    const lower = name.toLowerCase();
    if (RESERVED.has(lower)) return { error: `${at}: „${name}“ setzt RundfunkArr selbst.` };
    if (seen.has(lower)) return { error: `${at}: „${name}“ steht doppelt.` };
    if (!value) return { error: `${at}: Wert fehlt.` };
    if (!HEADER_VALUE.test(value))
      return { error: `${at}: Der Wert darf nur ASCII-Zeichen ohne Steuerzeichen enthalten.` };
    if (value.length > MAX_VALUE_LENGTH) return { error: `${at}: Der Wert ist zu lang.` };
    seen.add(lower);
    headers[name] = value;
    if (seen.size > MAX_WEBHOOK_HEADERS)
      return { error: `Höchstens ${MAX_WEBHOOK_HEADERS} Header möglich.` };
  }
  return { headers };
}

/**
 * Header values to redact from the log, also for input that does not validate. Besides the
 * full value this includes the credential after an auth scheme ("Bearer abc" → "abc").
 */
export function webhookHeaderSecrets(text: string | null | undefined): string[] {
  return lines(text ?? "").flatMap((line) => {
    const colon = line.indexOf(":");
    if (colon < 0) return [];
    const value = line.slice(colon + 1).trim();
    const credential = value.match(/^[A-Za-z][\w.-]*\s+(\S.*)$/)?.[1];
    return [value, ...(credential ? [credential] : [])].filter(Boolean);
  });
}
