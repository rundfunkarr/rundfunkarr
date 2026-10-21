import { LRUCache } from "lru-cache";
import { prisma } from "@/lib/db";

/**
 * Looks up the preview image (og:image) of a broadcaster's programme page.
 * Only well-known public broadcaster hosts are fetched, redirects are followed
 * manually within that allowlist, and results are cached in memory and in the
 * database so each page is requested at most once per month.
 */

const ALLOWED_HOSTS = [
  // ARD and its stations
  "ardmediathek.de",
  "ard.de",
  "daserste.de",
  "sportschau.de",
  "tagesschau.de",
  "br.de",
  "hr-fernsehen.de",
  "hessenschau.de",
  "mdr.de",
  "ndr.de",
  "radiobremen.de",
  "butenunbinnen.de",
  "rbb-online.de",
  "rbb24.de",
  "sr.de",
  "sr-mediathek.de",
  "swr.de",
  "wdr.de",
  "kika.de",
  "funk.net",
  "phoenix.de",
  "dw.com",
  // ZDF
  "zdf.de",
  "zdfheute.de",
  "zdftivi.de",
  "3sat.de",
  // Arte
  "arte.tv",
  // Austria and Switzerland
  "orf.at",
  "srf.ch",
  "rts.ch",
  "rsi.ch",
  "rtr.ch",
  "swissinfo.ch",
];

const USER_AGENT = "RundfunkArr (+https://github.com/rundfunkarr/rundfunkarr)";
const TIMEOUT_MS = 6000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const MAX_PARALLEL = 4;
const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 24 * 60 * 60 * 1000;

export function isAllowedPreviewHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return ALLOWED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Returns the URL to fetch, or null when the address is not a supported programme page. */
export function normalizePreviewUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  if (!isAllowedPreviewHost(url.hostname)) return null;
  url.hash = "";
  return url;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag))) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function resolveImage(value: string, base: string): string | null {
  try {
    const url = new URL(value.trim(), base);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

const META_KEYS = [
  "og:image:secure_url",
  "og:image",
  "og:image:url",
  "twitter:image",
  "twitter:image:src",
];

/** Extracts the social preview image from an HTML document head. */
export function extractPreviewImage(html: string, baseUrl: string): string | null {
  const head = html.slice(0, 300_000);
  const found = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag);
    const key = (attributes.property || attributes.name || "").toLowerCase();
    if (META_KEYS.includes(key) && attributes.content && !found.has(key))
      found.set(key, attributes.content);
  }
  for (const key of META_KEYS) {
    const value = found.get(key);
    const resolved = value ? resolveImage(value, baseUrl) : null;
    if (resolved) return resolved;
  }
  const link = head.match(/<link\b[^>]*\brel\s*=\s*["']?image_src["']?[^>]*>/i);
  if (link) {
    const href = parseAttributes(link[0]).href;
    if (href) return resolveImage(href, baseUrl);
  }
  return null;
}

async function readHead(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let received = 0;
  try {
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(text)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

async function fetchPage(start: URL): Promise<{ html: string; url: string } | null> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "de",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) return null;
      let target: string;
      try {
        target = new URL(location, current).toString();
      } catch {
        return null;
      }
      const next = normalizePreviewUrl(target);
      if (!next) return null;
      current = next;
      continue;
    }
    if (!response.ok || !/html|xml/i.test(response.headers.get("content-type") || "")) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    return { html: await readHead(response), url: current.toString() };
  }
  return null;
}

let active = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await task();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// lru-cache rejects null values, so misses are stored as an object.
const memory = new LRUCache<string, { imageUrl: string | null }>({
  max: 2000,
  ttl: 6 * 60 * 60 * 1000,
});
const inflight = new Map<string, Promise<string | null>>();
let lastPrune = 0;

async function pruneExpired(): Promise<void> {
  if (Date.now() - lastPrune < 60 * 60 * 1000) return;
  lastPrune = Date.now();
  await prisma.websitePreview
    .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } })
    .catch(() => {});
}

/** Returns the preview image URL for a programme page, or null when none is available. */
export async function getWebsitePreview(input: string): Promise<string | null> {
  const url = normalizePreviewUrl(input);
  if (!url) return null;
  const key = url.toString();
  const remembered = memory.get(key);
  if (remembered) return remembered.imageUrl;
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = (async () => {
    try {
      const stored = await prisma.websitePreview.findUnique({ where: { url: key } });
      if (stored && stored.expiresAt > new Date()) {
        memory.set(key, { imageUrl: stored.imageUrl });
        return stored.imageUrl;
      }
      const imageUrl = await withSlot(async () => {
        try {
          const page = await fetchPage(url);
          return page ? extractPreviewImage(page.html, page.url) : null;
        } catch {
          return null;
        }
      });
      const expiresAt = new Date(Date.now() + (imageUrl ? SUCCESS_TTL_MS : FAILURE_TTL_MS));
      await prisma.websitePreview
        .upsert({
          where: { url: key },
          update: { imageUrl, fetchedAt: new Date(), expiresAt },
          create: { url: key, imageUrl, expiresAt },
        })
        .catch(() => {});
      memory.set(key, { imageUrl });
      void pruneExpired();
      return imageUrl;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}
