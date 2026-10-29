import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { values, sendToTarget } = vi.hoisted(() => ({
  values: new Map<string, string>(),
  sendToTarget: vi.fn(),
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (key: string) => values.get(key) ?? null),
}));
vi.mock("@/server/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/notifications")>()),
  sendToTarget,
}));

import { redactLog } from "@/lib/logger";
import { maskSetting } from "@/lib/settings-redaction";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/notifications/test", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

beforeEach(() => {
  values.clear();
  sendToTarget.mockReset().mockResolvedValue({ target: "gotify", success: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

it("sends a test message with the unsaved form values", async () => {
  const response = await post({
    target: "ntfy",
    config: { url: "https://ntfy.example.org", topic: "neu", token: "tk_new", extra: "x" },
  });
  expect(await response.json()).toEqual({ success: true });
  expect(sendToTarget).toHaveBeenCalledWith(
    "ntfy",
    { url: "https://ntfy.example.org", topic: "neu", token: "tk_new" },
    expect.objectContaining({ event: "test", title: "Testnachricht von RundfunkArr" })
  );
});

it("resolves masked secrets from the stored settings", async () => {
  values.set("notifications.gotify.token", "stored-token");
  await post({
    target: "gotify",
    config: {
      url: "https://g.example",
      token: maskSetting("notifications.gotify.token", "stored-token"),
    },
  });
  expect(sendToTarget).toHaveBeenCalledWith(
    "gotify",
    { url: "https://g.example", token: "stored-token" },
    expect.anything()
  );
});

it("returns the error of a failed test", async () => {
  sendToTarget.mockResolvedValue({ target: "webhook", success: false, error: "HTTP 404" });
  const response = await post({ target: "webhook", config: { url: "http://127.0.0.1:1" } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: false, error: "HTTP 404" });
});

it.each([{ target: "email" }, "kein json"])("rejects invalid requests", async (body) => {
  const response = await post(body);
  expect(response.status).toBe(400);
  expect(sendToTarget).not.toHaveBeenCalled();
});

it("redacts unsaved secrets that a failing target echoes back", async () => {
  const secretUrl = "https://hooks.example.org/api/webhooks/123/unsaved-secret-path";
  sendToTarget.mockResolvedValue({
    target: "discord",
    success: false,
    error: `HTTP 404 for ${secretUrl}`,
  });
  await post({ target: "discord", config: { url: secretUrl } });
  expect(redactLog(`HTTP 404 for ${secretUrl}`)).not.toContain("unsaved-secret-path");
});

it("resolves masked webhook headers and redacts unsaved ones", async () => {
  values.set("notifications.webhook.headers", "Authorization: Bearer stored-header");
  await post({
    target: "webhook",
    config: {
      url: "http://127.0.0.1:1/hook",
      headers: maskSetting("notifications.webhook.headers", "x"),
    },
  });
  expect(sendToTarget).toHaveBeenLastCalledWith(
    "webhook",
    { url: "http://127.0.0.1:1/hook", headers: "Authorization: Bearer stored-header" },
    expect.anything()
  );
  await post({
    target: "webhook",
    config: { url: "http://127.0.0.1:1/hook", headers: "X-Api-Key: unsaved-header-key" },
  });
  expect(redactLog("echo unsaved-header-key")).toBe("echo [vertraulich]");
});
