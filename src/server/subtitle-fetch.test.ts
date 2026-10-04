import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type RequestOptions } from "node:http";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";

const { lookup, request } = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));
vi.mock("node:http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:http")>()),
  get: request,
}));
vi.mock("node:https", () => ({ get: request }));

import { fetchSubtitle } from "./subtitle-fetch";

const subtitle = "WEBVTT\n\n00:01.000 --> 00:02.000\nSubtitle\n";
let destinations: string[];
let replies: Array<{ status: number; headers?: Record<string, string>; body?: Buffer | string }>;

beforeEach(() => {
  lookup.mockReset().mockResolvedValue([{ address: "93.184.215.14", family: 4 }]);
  request
    .mockReset()
    .mockImplementation(
      (url: URL, options: RequestOptions, receive: (response: IncomingMessage) => void) => {
        const pending = new EventEmitter();
        queueMicrotask(() => {
          const connect = (error: Error | null, addresses: string | Array<{ address: string }>) => {
            if (error) return void pending.emit("error", error);
            const address = typeof addresses === "string" ? addresses : addresses[0].address;
            destinations.push(address);
            const reply = replies.shift() || { status: 200, body: subtitle };
            receive(
              Object.assign(Readable.from([Buffer.from(reply.body || "")]), {
                statusCode: reply.status,
                headers: reply.headers || {},
              }) as IncomingMessage
            );
          };
          if (options.lookup) options.lookup(url.hostname, { all: true }, connect);
          else connect(null, url.hostname);
        });
        return pending;
      }
    );
  destinations = [];
  replies = [];
  // The old implementation uses fetch; keep its transport isolated too.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(subtitle))
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("subtitle network boundary", () => {
  it.each([
    "http://127.0.0.1/subtitles",
    "http://2130706433/subtitles",
    "http://0x7f000001/subtitles",
    "http://10.0.0.1/subtitles",
    "http://172.16.0.1/subtitles",
    "http://192.168.1.1/subtitles",
    "http://169.254.169.254/subtitles",
    "http://100.64.0.1/subtitles",
    "http://0.0.0.0/subtitles",
    "http://[::1]/subtitles",
    "http://[::ffff:127.0.0.1]/subtitles",
    "http://[fc00::1]/subtitles",
    "http://[fe80::1]/subtitles",
    "http://[2002:7f00:1::]/subtitles",
  ])("rejects the non-public literal %s before a request", async (url) => {
    await expect(fetchSubtitle(url)).rejects.toThrow("öffentlich");
    expect(destinations).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "fd00::1", family: 6 }],
    [
      { address: "93.184.215.14", family: 4 },
      { address: "192.168.1.1", family: 4 },
    ],
  ])("rejects non-public DNS answers before connecting: %j", async (...addresses) => {
    lookup.mockResolvedValue(addresses);
    await expect(fetchSubtitle("https://subtitles.example/subtitles.vtt")).rejects.toThrow(
      "öffentlich"
    );
    expect(destinations).toEqual([]);
  });

  it("uses the validated DNS answers for the actual connection", async () => {
    lookup
      .mockResolvedValueOnce([{ address: "93.184.215.14", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(fetchSubtitle("https://subtitles.example/subtitles.vtt")).resolves.toBe(subtitle);
    expect(destinations).toEqual(["93.184.215.14"]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("checks DNS again on a redirect to the same hostname", async () => {
    replies.push({ status: 302, headers: { location: "/redirected.vtt" } });
    lookup
      .mockResolvedValueOnce([{ address: "93.184.215.14", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(fetchSubtitle("https://subtitles.example/subtitles.vtt")).rejects.toThrow(
      "öffentlich"
    );
    expect(destinations).toEqual(["93.184.215.14"]);
  });

  it.each(["http://127.0.0.1/private", "http://[::1]/private", "http://internal.example/private"])(
    "blocks redirects to %s",
    async (location) => {
      replies.push({ status: 302, headers: { location } });
      lookup
        .mockResolvedValueOnce([{ address: "93.184.215.14", family: 4 }])
        .mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
      await expect(fetchSubtitle("https://subtitles.example/subtitles.vtt")).rejects.toThrow(
        "öffentlich"
      );
      expect(destinations).toEqual(["93.184.215.14"]);
    }
  );

  it("follows public redirects and reads gzip subtitles", async () => {
    replies.push(
      { status: 302, headers: { location: "/subtitles.vtt" } },
      { status: 200, headers: { "content-encoding": "gzip" }, body: gzipSync(subtitle) }
    );
    await expect(fetchSubtitle("https://subtitles.example/start")).resolves.toBe(subtitle);
    expect(destinations).toEqual(["93.184.215.14", "93.184.215.14"]);
  });

  it("caps redirect chains", async () => {
    replies = Array.from({ length: 10 }, () => ({ status: 302, headers: { location: "/loop" } }));
    await expect(fetchSubtitle("https://subtitles.example/loop")).rejects.toThrow(
      "Weiterleitungen"
    );
    expect(destinations.length).toBeLessThanOrEqual(6);
  });

  it("limits decompressed subtitle bytes", async () => {
    replies.push({
      status: 200,
      headers: { "content-encoding": "gzip" },
      body: gzipSync(Buffer.alloc(5 * 1024 * 1024 + 1)),
    });
    await expect(fetchSubtitle("https://subtitles.example/large")).rejects.toThrow("5 MiB");
  });

  it("never reaches an actual loopback HTTP listener", async () => {
    vi.unstubAllGlobals();
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.end(subtitle);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server port");
      await expect(fetchSubtitle(`http://127.0.0.1:${address.port}/subtitles.vtt`)).rejects.toThrow(
        "öffentlich"
      );
      expect(hits).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
