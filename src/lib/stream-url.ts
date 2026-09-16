/** Return an SRF URN only for the stable video references emitted by our provider. */
export function srfUrnFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "www.srf.ch") return null;
    const match = url.pathname.match(/^\/play\/tv\/redirect\/detail\/([a-zA-Z0-9-]+)$/);
    return match ? `urn:srf:video:${match[1]}` : null;
  } catch {
    return null;
  }
}

export function isHlsUrl(value: string): boolean {
  try {
    return new URL(value).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return false;
  }
}

export function isStreamingUrl(value: string): boolean {
  return isHlsUrl(value) || srfUrnFromUrl(value) !== null;
}

export type StreamHeight = 480 | 720 | 1080;

/** Keep the requested rendition with a stable URL through NZB and queue storage. */
export function withStreamQuality(value: string, quality: "low" | "standard" | "high"): string {
  const url = new URL(value);
  url.hash = `rundfunkarr-height=${quality === "low" ? 480 : quality === "standard" ? 720 : 1080}`;
  return url.toString();
}

export function getStreamHeight(value: string): StreamHeight | undefined {
  const match = value.match(/#rundfunkarr-height=(480|720|1080)$/);
  return match ? (Number(match[1]) as StreamHeight) : undefined;
}
