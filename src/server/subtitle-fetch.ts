import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { pipeline } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const nonPublic = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  nonPublic.addSubnet(address, prefix, "ipv4");

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  nonPublic.addSubnet(address, prefix, "ipv6");

function isPublic(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !nonPublic.check(address, "ipv4")
    : family === 6 && globalIpv6.check(address, "ipv6") && !nonPublic.check(address, "ipv6");
}

function blockedDestination(): Error {
  return new Error("Untertitel dürfen nur von öffentlichen Netzwerkadressen geladen werden.");
}

// Validate the addresses supplied to the socket itself: no separate DNS lookup
// may replace a checked address between validation and connection.
const publicLookup: LookupFunction = (hostname, options, callback) => {
  void lookup(hostname, { all: true }).then(
    (addresses) => {
      if (!addresses.length || addresses.some(({ address }) => !isPublic(address))) {
        callback(blockedDestination(), "", 0);
        return;
      }
      callback(null, options.all ? addresses : addresses[0].address, addresses[0].family);
    },
    (error: NodeJS.ErrnoException) => callback(error, "", 0)
  );
};

/** Fetch bounded subtitle text using public destinations, including every redirect. */
export async function fetchSubtitle(source: string): Promise<string> {
  let url = new URL(source);
  const signal = AbortSignal.timeout(30000);
  for (let redirects = 0; ; redirects++) {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (isIP(hostname) && !isPublic(hostname))
    )
      throw blockedDestination();
    const transport = url.protocol === "https:" ? https : http;
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      transport
        .get(url, { lookup: publicLookup, agent: false, signal }, resolve)
        .once("error", reject);
    });
    try {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        if (redirects >= 5) throw new Error("Zu viele Untertitel-Weiterleitungen.");
        url = new URL(response.headers.location, url);
        continue;
      }
      if (status < 200 || status >= 300)
        throw new Error(`Untertitelabruf fehlgeschlagen (HTTP ${status}).`);
      const encoding = response.headers["content-encoding"];
      const decoder =
        encoding === "gzip"
          ? createGunzip()
          : encoding === "deflate"
            ? createInflate()
            : encoding === "br"
              ? createBrotliDecompress()
              : null;
      const body = decoder ? pipeline(response, decoder, () => {}) : response;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of body) {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) throw new Error("Die Untertiteldatei ist größer als 5 MiB.");
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally {
      response.destroy();
    }
  }
}
