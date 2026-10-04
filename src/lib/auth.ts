import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { AuthConfig } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE = "rundfunkarr-session";
const SCRYPT_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const INTEGRATION_PATHS = new Set([
  "/api",
  "/api/download",
  "/api/newznab",
  "/api/newznab/api",
  "/api/newznab/fake_nzb_download",
]);
export class AuthError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(Buffer.from(tokenHash(a), "hex"), Buffer.from(tokenHash(b), "hex"));
}
function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) =>
      error ? reject(error) : resolve(key)
    )
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await derivePassword(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [algorithm, salt, digest] = hash.split("$");
  if (
    algorithm !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(digest || "")
  )
    return false;
  return timingSafeEqual(await derivePassword(password, salt), Buffer.from(digest, "hex"));
}
export function getAuthConfig() {
  return prisma.authConfig.findUnique({ where: { id: 1 } });
}
export function ensureAuthConfig() {
  return prisma.authConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      apiKey: randomBytes(32).toString("hex"),
      revision: randomUUID(),
    },
  });
}
export async function hasSession(request: NextRequest, config: AuthConfig | null) {
  if (!config?.enabled) return false;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const session = await prisma.authSession.findUnique({ where: { tokenHash: tokenHash(token) } });
  return !!session && session.revision === config.revision && session.expiresAt > new Date();
}
export function isIntegrationPath(path: string) {
  return INTEGRATION_PATHS.has(path.replace(/\/$/, ""));
}
export function requestOrigin(request: NextRequest) {
  // Proxy's NextURL can contain the internal bind address. Use the actual HTTP
  // Host, not forwarded headers, unless the operator pins a public origin.
  const origin = new URL(
    process.env.AUTH_PUBLIC_URL ||
      `${request.nextUrl.protocol}//${request.headers.get("host") || request.nextUrl.host}`
  );
  if (!["http:", "https:"].includes(origin.protocol))
    throw new AuthError("Öffentliche Serveradresse prüfen.", 503);
  return origin.origin;
}
export function isSameOrigin(request: NextRequest, requireOrigin = false) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return !requireOrigin;
  try {
    // No address-based bypass and no trust in caller-supplied forwarded headers.
    return new URL(origin).origin === requestOrigin(request);
  } catch {
    return false;
  }
}
export function authResponse(error: unknown) {
  const known = error instanceof AuthError;
  return NextResponse.json(
    { error: known ? error.message : "Die Anmeldung ist vorübergehend nicht verfügbar." },
    { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } }
  );
}
export async function requireSession(request: NextRequest, config: AuthConfig | null) {
  if (config?.enabled && !(await hasSession(request, config)))
    throw new AuthError("Bitte anmelden.", 401);
  if (!isSameOrigin(request, !["GET", "HEAD"].includes(request.method)))
    throw new AuthError("Anfrage von einer fremden Seite abgelehnt.", 403);
}
export async function authorizeRequest(request: NextRequest): Promise<NextResponse | null> {
  const config = await getAuthConfig();
  if (!config?.enabled) return null;
  const apiKey = request.headers.get("X-Api-Key") || request.nextUrl.searchParams.get("apikey");
  if (isIntegrationPath(request.nextUrl.pathname) && apiKey && equalSecret(config.apiKey, apiKey))
    return null;
  if (request.method === "GET" && request.nextUrl.pathname === "/api/newznab/fake_nzb_download") {
    const signature = request.nextUrl.searchParams.get("signature");
    if (signature && equalSecret(signature, nzbSignature(request.nextUrl, config.apiKey)))
      return null;
  }
  await requireSession(request, config);
  return null;
}
export function safeReturnTo(value: string | null | undefined) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n]/.test(value)
  )
    return "/";
  const parsed = new URL(value, "http://local");
  return parsed.origin === "http://local" &&
    parsed.pathname !== "/login" &&
    !parsed.pathname.startsWith("/api")
    ? parsed.pathname + parsed.search
    : "/";
}

export async function readAuthJson(request: NextRequest): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new AuthError("Anfrage zu groß.", 413);
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return null;
    }
  } finally {
    reader.releaseLock();
  }
}
function newSession(revision: string, remember = false) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + (remember ? 30 * 24 : 12) * 3600_000);
  return { token, data: { tokenHash: tokenHash(token), revision, expiresAt } };
}
export function setSessionCookie(
  response: NextResponse,
  request: NextRequest,
  token: string,
  expiresAt: Date
) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
    secure:
      process.env.AUTH_COOKIE_SECURE === "true" ||
      new URL(process.env.AUTH_PUBLIC_URL || request.url).protocol === "https:",
  });
}
export function clearSessionCookie(response: NextResponse, request: NextRequest) {
  setSessionCookie(response, request, "", new Date(0));
}
export async function login(username: string, password: string, remember: boolean) {
  const config = await getAuthConfig();
  if (!config?.enabled) throw new AuthError("Die Anmeldung ist deaktiviert.", 400);
  const now = new Date();
  // Bound password-hashing work with fixed, persistent pacing. Failures must
  // not extend this shared window and lock out the administrator for longer.
  // Public deployments also need per-client limits at their trusted proxy.
  const claimed = await prisma.authConfig.updateMany({
    where: {
      id: 1,
      revision: config.revision,
      OR: [{ loginBlockedUntil: null }, { loginBlockedUntil: { lte: now } }],
    },
    data: { loginBlockedUntil: new Date(now.getTime() + 2000) },
  });
  if (!claimed.count)
    throw new AuthError("Zu viele Anmeldeversuche. Bitte kurz warten und erneut versuchen.", 429);
  const passwordMatches = await verifyPassword(password, config.passwordHash);
  if (!passwordMatches || !equalSecret(username, config.username)) {
    await prisma.authConfig.updateMany({
      where: { id: 1, revision: config.revision },
      data: { failedLogins: { increment: 1 } },
    });
    throw new AuthError("Benutzername oder Passwort ist falsch.", 401);
  }
  const session = newSession(config.revision, remember);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.authConfig.updateMany({
      where: { id: 1, revision: config.revision, enabled: true },
      data: { failedLogins: 0, loginBlockedUntil: null },
    });
    if (!updated.count)
      throw new AuthError("Die Zugangsdaten wurden geändert. Bitte erneut anmelden.", 401);
    await tx.authSession.deleteMany({ where: { expiresAt: { lte: now } } });
    await tx.authSession.create({ data: session.data });
  });
  return session;
}

export async function saveAuthConfig(
  request: NextRequest,
  input: {
    enabled: boolean;
    username: string;
    password?: string;
    currentPassword?: string;
    regenerateApiKey?: boolean;
  }
) {
  const config = await ensureAuthConfig();
  await requireSession(request, config);
  if (config.enabled && !(await verifyPassword(input.currentPassword || "", config.passwordHash)))
    throw new AuthError("Das aktuelle Passwort ist falsch.", 401);
  const passwordHash = input.password ? await hashPassword(input.password) : config.passwordHash;
  if (input.enabled && (!input.username || !passwordHash))
    throw new AuthError("Zum Aktivieren werden Benutzername und Passwort benötigt.", 422);
  const revision = randomUUID();
  const session = input.enabled ? newSession(revision) : null;
  const next = await prisma.$transaction(async (tx) => {
    const updated = await tx.authConfig.updateMany({
      where: { id: 1, revision: config.revision },
      data: {
        enabled: input.enabled,
        username: input.username,
        passwordHash,
        revision,
        // Disabled-mode settings are public, so their key cannot become an
        // authenticated credential when the operator enables login.
        apiKey:
          input.regenerateApiKey || (input.enabled && !config.enabled)
            ? randomBytes(32).toString("hex")
            : config.apiKey,
        failedLogins: 0,
        loginBlockedUntil: null,
      },
    });
    if (!updated.count)
      throw new AuthError("Die Einstellungen wurden gleichzeitig geändert. Bitte neu laden.", 409);
    await tx.authSession.deleteMany({});
    if (session) await tx.authSession.create({ data: session.data });
    return tx.authConfig.findUniqueOrThrow({ where: { id: 1 } });
  });
  return { config: next, session };
}

function nzbSignature(url: URL, key: string) {
  const params = new URLSearchParams(url.search);
  params.delete("signature");
  params.delete("apikey");
  params.sort();
  return createHmac("sha256", key).update(`nzb-download\n${params}`).digest("hex");
}
export function signNzbLinks(xml: string, key: string) {
  // These links are generated locally and XML-escaped by xml2js. Sign the exact
  // NZB payload without placing the general integration key in RSS/download URLs.
  return xml.replace(/\/api\/newznab\/fake_nzb_download\?[^<"\s]+/g, (escaped) => {
    const url = new URL(escaped.replaceAll("&amp;", "&"), "http://local");
    url.searchParams.set("signature", nzbSignature(url, key));
    return (url.pathname + url.search).replaceAll("&", "&amp;");
  });
}
