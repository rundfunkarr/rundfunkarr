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
  return isHlsUrl(value) || srfUrnFromUrl(value) !== null || isMediaPageReference(value);
}

export type StreamHeight = 480 | 720 | 1080;

/** Keep the requested rendition with a stable URL through NZB and queue storage. */
export function withStreamQuality(value: string, quality: "low" | "standard" | "high"): string {
  const url = new URL(value);
  const params = new URLSearchParams(isMediaPageReference(value) ? "rundfunkarr-page=1" : "");
  params.set(
    "rundfunkarr-height",
    String(quality === "low" ? 480 : quality === "standard" ? 720 : 1080)
  );
  url.hash = params.toString();
  return url.toString();
}

export function getStreamHeight(value: string): StreamHeight | undefined {
  try {
    const height = Number(
      new URLSearchParams(new URL(value).hash.slice(1)).get("rundfunkarr-height")
    );
    return [480, 720, 1080].includes(height) ? (height as StreamHeight) : undefined;
  } catch {
    return undefined;
  }
}

export function isMediathekWebsite(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["ardmediathek.de", "zdf.de", "arte.tv", "3sat.de", "orf.at", "srf.ch"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )
    );
  } catch {
    return false;
  }
}
function isMediaPageReference(value: string): boolean {
  return (
    isMediathekWebsite(value) &&
    new URLSearchParams(new URL(value).hash.slice(1)).get("rundfunkarr-page") === "1"
  );
}
