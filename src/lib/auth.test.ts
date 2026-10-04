import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

// Real memory-hard password hashing and SQLite transactions need headroom on
// busy CI hosts; timing out a test must not leave its transaction in the next test.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const db = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { PrismaClient } = await import("@prisma/client");
  const directory = await mkdtemp(join(tmpdir(), "rundfunkarr-auth-test-"));
  return { directory, prisma: new PrismaClient({ datasourceUrl: `file:${directory}/test.db` }) };
});
vi.mock("@/lib/db", () => ({ prisma: db.prisma }));

import {
  SESSION_COOKIE,
  authorizeRequest,
  ensureAuthConfig,
  hashPassword,
  hasSession,
  getAuthConfig,
  safeReturnTo,
  signNzbLinks,
  tokenHash,
  verifyPassword,
} from "./auth";
import { proxy, config as proxyConfig } from "@/proxy";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as getSettings, POST as saveSettings } from "@/app/api/auth/settings/route";
import { GET as sessionStatus } from "@/app/api/auth/session/route";

const password = "test-only-long-password";
const apiKey = "test-only-integration-key-0123456789";
let passwordHash: string;
beforeAll(async () => {
  const sql = await readFile(
    "prisma/migrations/20261004160000_optional_authentication/migration.sql",
    "utf8"
  );
  for (const statement of sql.split(";").filter((value) => value.trim()))
    await db.prisma.$executeRawUnsafe(statement);
  passwordHash = await hashPassword(password);
});
beforeEach(async () => {
  vi.unstubAllEnvs();
  await db.prisma.authSession.deleteMany({});
  await db.prisma.authConfig.deleteMany({});
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.prisma.$disconnect();
  await rm(db.directory, { recursive: true, force: true });
});

async function enable() {
  return db.prisma.authConfig.create({
    data: { id: 1, enabled: true, username: "admin", passwordHash, apiKey, revision: "initial" },
  });
}
function request(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.method === "POST") {
    if (!headers.has("origin")) headers.set("origin", "http://app.test");
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  return new NextRequest(`http://app.test${path}`, {
    ...options,
    signal: options.signal ?? undefined,
    headers,
  });
}
const credentials = (overrides = {}) => ({ username: "admin", password, ...overrides });
async function signIn(overrides = {}) {
  return login(
    request("/api/auth/login", { method: "POST", body: JSON.stringify(credentials(overrides)) })
  );
}
function cookie(response: Response) {
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function allowNextLogin() {
  await db.prisma.authConfig.update({ where: { id: 1 }, data: { loginBlockedUntil: new Date(0) } });
}

it("keeps authentication disabled for existing installations and creates a random integration key", async () => {
  expect(await authorizeRequest(request("/api/settings"))).toBeNull();
  const settings = await getSettings(request("/api/auth/settings"));
  const body = await settings.json();
  expect(body.enabled).toBe(false);
  expect(body.apiKey).toMatch(/^[a-f0-9]{64}$/);
  expect(body).not.toHaveProperty("passwordHash");
  expect((await ensureAuthConfig()).apiKey).toBe(body.apiKey);
});

it("uses a unique salt and never stores a plaintext password", async () => {
  const other = await hashPassword(password);
  expect(other).not.toBe(passwordHash);
  expect(other).not.toContain(password);
  expect(await verifyPassword(password, other)).toBe(true);
  expect(await verifyPassword("wrong", other)).toBe(false);
  expect(await verifyPassword(password, "invalid-record")).toBe(false);
});

it("issues a revocable HttpOnly session and discloses no credentials", async () => {
  const config = await enable();
  const response = await signIn({ remember: true });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).toContain("SameSite=strict");
  const token = response.cookies.get(SESSION_COOKIE)!.value;
  const stored = await db.prisma.authSession.findUniqueOrThrow({
    where: { tokenHash: tokenHash(token) },
  });
  expect(stored.tokenHash).not.toBe(token);
  expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 3600_000);
  expect(await hasSession(request("/", { headers: { cookie: cookie(response) } }), config)).toBe(
    true
  );
  expect(await response.json()).toEqual({ success: true });
  const status = await sessionStatus(request("/api/auth/session"));
  expect(await status.json()).toEqual({ enabled: true, authenticated: false });
});

it.each([{ username: "unknown" }, { password: "incorrect-password" }])(
  "rejects incorrect credentials without creating a session: %o",
  async (overrides) => {
    await enable();
    const response = await signIn(overrides);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Benutzername oder Passwort ist falsch." });
    expect(await db.prisma.authSession.count()).toBe(0);
  }
);

it("persists login throttling independently of spoofed proxy headers", async () => {
  await enable();
  expect((await signIn({ password: "wrong" })).status).toBe(401);
  const response = await login(
    request("/api/auth/login", {
      method: "POST",
      headers: { "X-Forwarded-For": "127.0.0.1" },
      body: JSON.stringify(credentials()),
    })
  );
  expect(response.status).toBe(429);
  await allowNextLogin();
  expect((await signIn()).status).toBe(200);
});

it("applies a longer cooldown after five failed attempts", async () => {
  await enable();
  for (let i = 0; i < 5; i++) {
    await allowNextLogin();
    expect((await signIn({ password: "wrong" })).status).toBe(401);
  }
  const config = await getAuthConfig();
  expect(config?.failedLogins).toBe(5);
  expect(config!.loginBlockedUntil!.getTime() - Date.now()).toBeGreaterThan(25_000);
});

it.each([
  "/api/settings",
  "/api/system",
  "/api/search/manual",
  "/api/logs",
  "/api/diagnostics",
  "/api/auth/settings",
])("protects %s even with an integration key or spoofed local address", async (path) => {
  await enable();
  const response = await proxy(
    request(`${path}?apikey=${apiKey}`, {
      headers: {
        "X-Forwarded-For": "127.0.0.1",
        "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy",
      },
    })
  );
  expect(response.status).toBe(401);
  expect(response.headers.get("location")).toBeNull();
});

it.each([
  "/api?mode=version",
  "/api/download?mode=history",
  "/api/newznab?t=caps",
  "/api/newznab/api?t=caps",
])("allows Sonarr/Radarr integration key access to %s", async (path) => {
  await enable();
  expect((await proxy(request(path))).status).toBe(401);
  expect((await proxy(request(`${path}&apikey=${apiKey}`))).status).toBe(200);
  expect((await proxy(request(path, { headers: { "X-Api-Key": apiKey } }))).status).toBe(200);
  expect((await proxy(request(`${path}&apikey=wrong`))).status).toBe(401);
});

it("protects pages and returns to the requested view after login", async () => {
  await enable();
  const response = await proxy(request("/downloads?tab=history"));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "http://app.test/login?returnTo=%2Fdownloads%3Ftab%3Dhistory"
  );
  const loggedIn = await signIn();
  expect(
    (await proxy(request("/downloads", { headers: { cookie: cookie(loggedIn) } }))).status
  ).toBe(200);
});

it("revokes the server session on logout and rejects expired sessions", async () => {
  const config = await enable();
  const response = await signIn();
  const sessionCookie = cookie(response);
  expect(
    (
      await logout(
        request("/api/auth/logout", { method: "POST", headers: { cookie: sessionCookie } })
      )
    ).status
  ).toBe(200);
  expect(await hasSession(request("/", { headers: { cookie: sessionCookie } }), config)).toBe(
    false
  );
  const second = await signIn();
  await db.prisma.authSession.updateMany({ data: { expiresAt: new Date(0) } });
  expect(await hasSession(request("/", { headers: { cookie: cookie(second) } }), config)).toBe(
    false
  );
});

describe("browser request boundary", () => {
  it("uses the HTTP Host when NextURL contains the internal bind address", async () => {
    await enable();
    const response = await login(
      new NextRequest("http://localhost:6767/api/auth/login", {
        method: "POST",
        headers: {
          host: "192.168.1.20:6767",
          origin: "http://192.168.1.20:6767",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials()),
      })
    );
    expect(response.status).toBe(200);
    const redirected = await proxy(
      new NextRequest("http://localhost:6767/settings", {
        headers: { host: "192.168.1.20:6767", "X-Forwarded-Host": "evil.test" },
      })
    );
    expect(redirected.headers.get("location")).toBe(
      "http://192.168.1.20:6767/login?returnTo=%2Fsettings"
    );
  });
  it.each(["http://evil.test", "null", "https://app.test"])(
    "rejects a login from origin %s",
    async (origin) => {
      await enable();
      const response = await login(
        request("/api/auth/login", {
          method: "POST",
          headers: { origin },
          body: JSON.stringify(credentials()),
        })
      );
      expect(response.status).toBe(403);
      expect(await db.prisma.authSession.count()).toBe(0);
    }
  );
  it("requires an explicit matching origin for authenticated mutations", async () => {
    await enable();
    const response = await signIn();
    const malicious = new NextRequest("http://app.test/api/settings", {
      method: "POST",
      headers: { cookie: cookie(response) },
      body: "{}",
    });
    await expect(authorizeRequest(malicious)).rejects.toMatchObject({ status: 403 });
    await expect(
      authorizeRequest(
        request("/api?mode=history&name=delete&value=1", {
          headers: { cookie: cookie(response), "sec-fetch-site": "cross-site" },
        })
      )
    ).rejects.toMatchObject({ status: 403 });
  });
  it("supports an explicitly configured HTTPS proxy origin and secure cookies", async () => {
    await enable();
    vi.stubEnv("AUTH_PUBLIC_URL", "https://rundfunk.example.test");
    const response = await login(
      request("/api/auth/login", {
        method: "POST",
        headers: { origin: "https://rundfunk.example.test" },
        body: JSON.stringify(credentials()),
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
  it("rejects oversized login bodies before hashing", async () => {
    await enable();
    const response = await login(
      request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: "x".repeat(9000) }),
      })
    );
    expect(response.status).toBe(413);
    expect((await getAuthConfig())?.loginBlockedUntil).toBeNull();
  });
});

it("enables login atomically, requires the current password for changes and invalidates old sessions", async () => {
  const response = await saveSettings(
    request("/api/auth/settings", {
      method: "POST",
      body: JSON.stringify({ enabled: true, username: "admin", password }),
    })
  );
  expect(response.status).toBe(200);
  const initialCookie = cookie(response);
  const before = await getAuthConfig();
  const badChange = await saveSettings(
    request("/api/auth/settings", {
      method: "POST",
      headers: { cookie: initialCookie },
      body: JSON.stringify({ enabled: false, username: "admin", currentPassword: "wrong" }),
    })
  );
  expect(badChange.status).toBe(401);
  expect((await getAuthConfig())?.enabled).toBe(true);
  const change = await saveSettings(
    request("/api/auth/settings", {
      method: "POST",
      headers: { cookie: initialCookie },
      body: JSON.stringify({
        enabled: true,
        username: "renamed",
        currentPassword: password,
        password: "a-new-test-password",
        regenerateApiKey: true,
      }),
    })
  );
  expect(change.status).toBe(200);
  const next = await getAuthConfig();
  expect(next?.apiKey).not.toBe(before?.apiKey);
  expect(await hasSession(request("/", { headers: { cookie: initialCookie } }), next)).toBe(false);
  expect(await hasSession(request("/", { headers: { cookie: cookie(change) } }), next)).toBe(true);
  expect(await verifyPassword("a-new-test-password", next!.passwordHash)).toBe(true);
  expect(await verifyPassword(password, next!.passwordHash)).toBe(false);
  const disabled = await saveSettings(
    request("/api/auth/settings", {
      method: "POST",
      headers: { cookie: cookie(change) },
      body: JSON.stringify({
        enabled: false,
        username: "renamed",
        currentPassword: "a-new-test-password",
      }),
    })
  );
  expect(disabled.status).toBe(200);
  expect(await db.prisma.authSession.count()).toBe(0);
  expect(await authorizeRequest(request("/api/settings"))).toBeNull();
});

it("rejects short passwords and does not allow setup through a cross-origin form", async () => {
  expect(
    (
      await saveSettings(
        request("/api/auth/settings", {
          method: "POST",
          body: JSON.stringify({ enabled: true, username: "admin", password: "short" }),
        })
      )
    ).status
  ).toBe(422);
  expect(
    (
      await saveSettings(
        request("/api/auth/settings", {
          method: "POST",
          headers: { origin: "http://evil.test" },
          body: JSON.stringify({ enabled: true, username: "attacker", password }),
        })
      )
    ).status
  ).toBe(403);
  expect((await getAuthConfig())?.enabled).not.toBe(true);
});

it("signs NZB links for their exact payload without exposing the integration key", async () => {
  await enable();
  const original =
    "/api/newznab/fake_nzb_download?encodedUrl=dXJs&amp;encodedTitle=dGl0bGU%3D&amp;metadata=%7B%22year%22%3A2026%7D";
  const xml = `<link>${original}</link><enclosure url="${original}" />`;
  const signed = signNzbLinks(xml, apiKey);
  expect(signed).not.toContain(apiKey);
  const url = signed.match(/<link>(.*?)<\/link>/)![1].replaceAll("&amp;", "&");
  expect((await proxy(request(url))).status).toBe(200);
  expect((await proxy(request(url.replace("dGl0bGU%3D", "b3RoZXI%3D")))).status).toBe(401);
  expect((await proxy(request(url.replace("fake_nzb_download", "api")))).status).toBe(401);
  await db.prisma.authConfig.update({ where: { id: 1 }, data: { apiKey: "rotated-key" } });
  expect((await proxy(request(url))).status).toBe(401);
});

it.each([
  "https://evil.test",
  "//evil.test",
  "/\\evil.test",
  "/login",
  "/api/settings",
  "/\n//evil.test",
])("prevents an unsafe post-login redirect: %s", (value) => expect(safeReturnTo(value)).toBe("/"));
it("keeps a normal local return path", () =>
  expect(safeReturnTo("/downloads?tab=history")).toBe("/downloads?tab=history"));
it.each([
  "/api/settings",
  "/api/newznab/api?t=caps",
  "/api/download",
  "/settings",
  "/logs",
  "/setup",
  "/api/settings.json",
  "/%61pi/settings",
])("keeps proxy coverage for %s", (url) =>
  expect(unstable_doesMiddlewareMatch({ config: proxyConfig, nextConfig: {}, url })).toBe(true)
);
it("fails closed if the authentication database is unavailable", async () => {
  await db.prisma.$executeRawUnsafe('ALTER TABLE "AuthConfig" RENAME TO "UnavailableAuthConfig"');
  try {
    expect((await proxy(request("/api/settings"))).status).toBe(503);
  } finally {
    await db.prisma.$executeRawUnsafe('ALTER TABLE "UnavailableAuthConfig" RENAME TO "AuthConfig"');
  }
});
