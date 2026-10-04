import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getLogs } from "./logs/route";
import { GET as getDiagnostics, POST as testConnection } from "./diagnostics/route";

const adminKey = "test-only-diagnostics-admin-key-0123456789";
const mocks = vi.hoisted(() => ({
  readLogs: vi.fn(),
  systemDiagnostics: vi.fn(),
  testArrConnection: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ readLogs: mocks.readLogs }));
vi.mock("@/server/diagnostics", () => ({
  systemDiagnostics: mocks.systemDiagnostics,
  testArrConnection: mocks.testArrConnection,
}));

const routes: Array<{
  name: string;
  path: string;
  method: "GET" | "POST";
  handler: (request: NextRequest) => Promise<Response>;
}> = [
  { name: "log JSON", path: "/api/logs", method: "GET", handler: getLogs },
  { name: "log export", path: "/api/logs?format=text", method: "GET", handler: getLogs },
  { name: "system diagnostics", path: "/api/diagnostics", method: "GET", handler: getDiagnostics },
  { name: "connection test", path: "/api/diagnostics", method: "POST", handler: testConnection },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DIAGNOSTICS_ADMIN_KEY", adminKey);
  mocks.readLogs.mockReturnValue([
    { id: 1, time: "2026-10-04T00:00:00Z", level: "info", message: "private-log-entry" },
  ]);
  mocks.systemDiagnostics.mockResolvedValue([{ id: "database", status: "ok" }]);
  mocks.testArrConnection.mockResolvedValue({ id: "sonarr", status: "ok" });
});
afterEach(() => vi.unstubAllEnvs());

function request(route: (typeof routes)[number], key?: string, body?: string) {
  return new NextRequest(`http://localhost${route.path}`, {
    method: route.method,
    headers: key === undefined ? {} : { "X-RundfunkArr-Admin-Key": key },
    ...(route.method === "POST"
      ? {
          body:
            body ??
            JSON.stringify({
              kind: "sonarr",
              url: "http://127.0.0.1:8989/sonarr",
              apiKey: "arr-api-key",
            }),
        }
      : {}),
  });
}

function expectNoProtectedWork() {
  expect(mocks.readLogs).not.toHaveBeenCalled();
  expect(mocks.systemDiagnostics).not.toHaveBeenCalled();
  expect(mocks.testArrConnection).not.toHaveBeenCalled();
}

describe.each(routes)("$name authorization", (route) => {
  it.each([undefined, "wrong-admin-key"])(
    "rejects key %s before reading data or parsing input",
    async (key) => {
      const response = await route.handler(request(route, key, "{invalid-json"));
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).not.toContain("private-log-entry");
      expectNoProtectedWork();
    }
  );

  it("is disabled when no server-side admin key is configured", async () => {
    vi.stubEnv("DIAGNOSTICS_ADMIN_KEY", "");
    const response = await route.handler(request(route, adminKey));
    expect(response.status).toBe(503);
    expectNoProtectedWork();
  });

  it("allows the configured admin key", async () => {
    expect((await route.handler(request(route, adminKey))).status).toBe(200);
  });
});

it("does not accept credentials from a URL or a key prefix", async () => {
  expect(
    (await getLogs(new NextRequest(`http://localhost/api/logs?adminKey=${adminKey}`))).status
  ).toBe(401);
  expect((await getLogs(request(routes[0], adminKey.slice(0, -1)))).status).toBe(401);
  expectNoProtectedWork();
});

it("requires a sufficiently long server-side key", async () => {
  vi.stubEnv("DIAGNOSTICS_ADMIN_KEY", "short");
  expect((await getLogs(request(routes[0], "short"))).status).toBe(503);
  expectNoProtectedWork();
});

it("permits authorized local Sonarr tests without forwarding the admin key", async () => {
  const response = await testConnection(request(routes[3], adminKey));
  expect(response.status).toBe(200);
  expect(mocks.testArrConnection).toHaveBeenCalledExactlyOnceWith(
    "sonarr",
    "http://127.0.0.1:8989/sonarr",
    "arr-api-key"
  );
  expect(JSON.stringify(await response.json())).not.toContain(adminKey);
});
