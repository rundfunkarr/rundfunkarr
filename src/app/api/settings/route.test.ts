import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "./route";
import { redactLog } from "@/lib/logger";

const { values, upsert, clearSrfTokenCache } = vi.hoisted(() => ({
  values: new Map<string, string>(),
  upsert: vi.fn(),
  clearSrfTokenCache: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    config: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        values.has(where.key) ? { value: values.get(where.key) } : null
      ),
      findMany: vi.fn(async () => [...values].map(([key, value]) => ({ key, value }))),
      upsert,
      delete: vi.fn(async ({ where }: { where: { key: string } }) => values.delete(where.key)),
    },
  },
}));
vi.mock("@/lib/settings", () => ({ clearSettingsCache: vi.fn() }));
vi.mock("@/lib/cache", () => ({ clearTTLCache: vi.fn(), mediathekCache: { clear: vi.fn() } }));
vi.mock("@/services/tvdb", () => ({ clearTvdbTokenCache: vi.fn() }));
vi.mock("@/services/srgssr-api", () => ({ clearTokenCache: clearSrfTokenCache }));

beforeEach(() => {
  vi.clearAllMocks();
  values.clear();
  values.set("api.srgssr.consumerKey", "private-key");
  values.set("api.srgssr.consumerSecret", "private-secret");
  upsert.mockImplementation(
    async ({ where, update }: { where: { key: string }; update: { value: string } }) =>
      values.set(where.key, update.value)
  );
});

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/settings", { method: "POST", body: JSON.stringify(body) })
  );
}

it("leaves series name umlaut stripping off by default", async () => {
  const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect(all["matching.normalizeSeriesNamesForSonarr"]).toBe("false");
});

it("masks both SRF credentials in bulk and single-setting responses", async () => {
  const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect(JSON.stringify(all)).not.toContain("private-");
  expect(all["api.srgssr.consumerSecret"]).toBeTruthy();
  const single = await (
    await GET(new NextRequest("http://localhost/api/settings?key=api.srgssr.consumerKey"))
  ).json();
  expect(single.value).toBe(all["api.srgssr.consumerKey"]);
});

it("preserves stored credentials when a client saves masked settings again", async () => {
  const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect((await post(all)).status).toBe(200);
  await post({ key: "api.srgssr.consumerSecret", value: all["api.srgssr.consumerSecret"] });
  expect(values.get("api.srgssr.consumerKey")).toBe("private-key");
  expect(values.get("api.srgssr.consumerSecret")).toBe("private-secret");
});

it("allows replacing and clearing a credential and invalidates the token", async () => {
  await post({ "api.srgssr.consumerSecret": "new-secret" });
  expect(values.get("api.srgssr.consumerSecret")).toBe("new-secret");
  await post({ key: "api.srgssr.consumerSecret", value: "" });
  expect(values.get("api.srgssr.consumerSecret")).toBe("");
  expect(clearSrfTokenCache).toHaveBeenCalledTimes(2);
  await DELETE(new NextRequest("http://localhost/api/settings?key=api.srgssr.consumerKey"));
  expect(clearSrfTokenCache).toHaveBeenCalledTimes(3);
});

it.each(["api.tvdb.key", "api.tvdb.pin", "api.tmdb.key", "tvdb_token"])(
  "masks %s and preserves it through single and bulk saves",
  async (key) => {
    values.set(key, "private-metadata-credential");
    const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
    expect(all[key]).toBe("••••••••");
    const single = await (
      await GET(new NextRequest(`http://localhost/api/settings?key=${key}`))
    ).json();
    expect(single.value).toBe(all[key]);
    await post(all);
    await post({ key, value: single.value });
    expect(values.get(key)).toBe("private-metadata-credential");
    await post({ key, value: "replacement" });
    expect(values.get(key)).toBe("replacement");
    await post({ key, value: "" });
    expect(values.get(key)).toBe("");
  }
);

it("masks notification secrets and keeps them when masked values are saved again", async () => {
  values.set("notifications.webhook.url", "https://hooks.example.org/private-hook");
  values.set("notifications.discord.url", "https://discord.com/api/webhooks/1/private-discord");
  values.set("notifications.ntfy.token", "private-ntfy");
  values.set("notifications.gotify.token", "private-gotify");
  values.set("notifications.ntfy.topic", "visible-topic");
  const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect(JSON.stringify(all)).not.toContain("private-");
  expect(all["notifications.ntfy.topic"]).toBe("visible-topic");
  expect(all["notifications.ntfy.url"]).toBe("https://ntfy.sh");
  expect(all["notifications.event.downloadFailed"]).toBe("true");

  await post({
    "notifications.webhook.url": all["notifications.webhook.url"],
    "notifications.gotify.token": all["notifications.gotify.token"],
    "notifications.ntfy.topic": "new-topic",
  });
  expect(values.get("notifications.webhook.url")).toBe("https://hooks.example.org/private-hook");
  expect(values.get("notifications.gotify.token")).toBe("private-gotify");
  expect(values.get("notifications.ntfy.topic")).toBe("new-topic");
});

it("masks webhook headers and validates them before saving", async () => {
  values.set("notifications.webhook.headers", "Authorization: Bearer private-header");
  const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect(all["notifications.webhook.headers"]).not.toContain("private-");

  const kept = await post({
    "notifications.webhook.headers": all["notifications.webhook.headers"],
  });
  expect(kept.status).toBe(200);
  expect(values.get("notifications.webhook.headers")).toBe("Authorization: Bearer private-header");

  for (const headers of ["Host: evil.example", "X-A: 1\rX-B: 2", "kein header"]) {
    const response = await post({ "notifications.webhook.headers": headers });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/^Webhook-Header: Zeile 1: /);
  }
  const single = await post({ key: "notifications.webhook.headers", value: "Content-Length: 1" });
  expect(single.status).toBe(400);
  expect(upsert).not.toHaveBeenCalled();

  await post({ "notifications.webhook.headers": "X-Api-Key: new-private-key" });
  expect(values.get("notifications.webhook.headers")).toBe("X-Api-Key: new-private-key");
  expect(redactLog("key new-private-key")).toBe("key [vertraulich]");
});
