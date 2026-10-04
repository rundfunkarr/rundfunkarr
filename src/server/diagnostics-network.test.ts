import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/diagnostics/route";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));

const servers: Server[] = [];
const adminKey = "network-test-only-admin-key-0123456789";
const arrKey = "network-test-only-arr-key";
async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        })
    )
  );
});
function request(url: string, authenticated = true) {
  return new NextRequest("http://localhost/api/diagnostics", {
    method: "POST",
    headers: authenticated ? { "X-RundfunkArr-Admin-Key": adminKey } : {},
    body: JSON.stringify({ kind: "sonarr", url, apiKey: arrKey }),
  });
}

it("blocks unauthenticated outbound work and permits an authorized private Sonarr base path", async () => {
  vi.stubEnv("DIAGNOSTICS_ADMIN_KEY", adminKey);
  const received: IncomingMessage[] = [];
  const base = await listen((req, res) => {
    received.push(req);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url?.endsWith("system/status")
          ? { appName: "Sonarr", version: "4.0" }
          : [{ enable: true, implementation: "Sabnzbd" }]
      )
    );
  });
  expect((await POST(request(`${base}/sonarr`, false))).status).toBe(401);
  expect(received).toHaveLength(0);
  const response = await POST(request(`${base}/sonarr`));
  expect((await response.json()).check.status).toBe("ok");
  expect(received.map((req) => req.url)).toEqual([
    "/sonarr/api/v3/system/status",
    "/sonarr/api/v3/downloadclient",
  ]);
  for (const req of received) {
    expect(req.headers["x-api-key"]).toBe(arrKey);
    expect(req.headers["x-rundfunkarr-admin-key"]).toBeUndefined();
  }
});

it("does not follow redirects or forward credentials to their target", async () => {
  vi.stubEnv("DIAGNOSTICS_ADMIN_KEY", adminKey);
  const redirected = vi.fn((_req: IncomingMessage, res: ServerResponse) => res.end("unexpected"));
  const target = await listen(redirected);
  const base = await listen((_req, res) => {
    res.writeHead(302, { Location: `${target}/private` });
    res.end();
  });
  const response = await POST(request(base));
  expect((await response.json()).check.status).toBe("error");
  expect(redirected).not.toHaveBeenCalled();
});
