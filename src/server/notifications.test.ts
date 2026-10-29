import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { values, findFirst } = vi.hoisted(() => ({
  values: new Map<string, string>(),
  findFirst: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    config: {
      findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.flatMap((key) => (values.has(key) ? [{ key, value: values.get(key)! }] : []))
      ),
    },
    subscriptionMatch: { findFirst },
  },
}));

import { clearSettingsCache } from "@/lib/settings";
import { redactLog } from "@/lib/logger";
import {
  activeTargets,
  buildDownloadCompletedPayload,
  buildDownloadFailedPayload,
  buildRequest,
  buildSubscriptionQueuedPayload,
  buildTestPayload,
  dispatchNotification,
  notifyDownloadCompleted,
  notifyDownloadFailed,
  notifySubscriptionQueued,
  sendToTarget,
  SEND_TIMEOUT_MS,
} from "./notifications";

const now = new Date("2026-10-29T12:00:00.000Z");
const completed = () =>
  buildDownloadCompletedPayload(
    {
      id: "d1",
      title: "Tatort - Murot und das Murmeltier",
      channel: "ARD",
      category: "tv",
      filePath: "/downloads/tv/d1/Tatort - Murot und das Murmeltier.mkv",
      size: 1234,
      warning: null,
    },
    now
  );
const json = (body: string) => JSON.parse(body);
const fetchMock = vi.fn();
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  values.clear();
  clearSettingsCache();
  findFirst.mockReset().mockResolvedValue(null);
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe("payloads", () => {
  it("describes a completed download with title, broadcaster and file name", () => {
    expect(completed()).toEqual({
      version: 1,
      event: "download.completed",
      type: "success",
      title: "Download abgeschlossen",
      body: "Tatort - Murot und das Murmeltier (ARD)\nDatei: Tatort - Murot und das Murmeltier.mkv",
      timestamp: "2026-10-29T12:00:00.000Z",
      download: {
        id: "d1",
        title: "Tatort - Murot und das Murmeltier",
        channel: "ARD",
        category: "tv",
        fileName: "Tatort - Murot und das Murmeltier.mkv",
        filePath: "/downloads/tv/d1/Tatort - Murot und das Murmeltier.mkv",
        size: 1234,
        warning: null,
        error: null,
      },
      subscription: null,
    });
  });

  it("includes the error of a failed download and omits an unknown broadcaster", () => {
    const payload = buildDownloadFailedPayload(
      {
        id: "d2",
        title: "Universum History",
        channel: null,
        category: "tv",
        error: "ORF-Geosperre: Dieses Video ist nur in Österreich abrufbar.",
      },
      now
    );
    expect(payload).toMatchObject({
      event: "download.failed",
      type: "failure",
      title: "Download fehlgeschlagen",
      body: "Universum History\nFehler: ORF-Geosperre: Dieses Video ist nur in Österreich abrufbar.",
      download: { id: "d2", error: expect.stringContaining("ORF-Geosperre"), fileName: null },
    });
  });

  it("aggregates a subscription run and shortens long lists", () => {
    const downloads = Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}`,
      title: `Natur - Folge ${i + 1}`,
      channel: "ZDF",
    }));
    const payload = buildSubscriptionQueuedPayload(
      { id: "s1", name: "Naturfilme", query: "Natur", downloads },
      now
    );
    expect(payload.title).toBe("Suchabo „Naturfilme“: 12 neue Downloads");
    expect(payload.body.split("\n")).toHaveLength(11);
    expect(payload.body).toContain("• Natur - Folge 1 (ZDF)");
    expect(payload.body).toMatch(/… und 2 weitere$/);
    expect(payload.subscription?.downloads).toHaveLength(12);
    expect(
      buildSubscriptionQueuedPayload(
        { id: "s1", name: "Naturfilme", query: "Natur", downloads: downloads.slice(0, 1) },
        now
      ).title
    ).toBe("Suchabo „Naturfilme“: 1 neuer Download");
  });

  it("truncates very long error texts", () => {
    const payload = buildDownloadFailedPayload(
      { id: "d", title: "T", channel: null, category: null, error: "x".repeat(5000) },
      now
    );
    expect(payload.body.length).toBeLessThanOrEqual(1500);
    expect(payload.body.endsWith("…")).toBe(true);
  });
});

describe("requests per target", () => {
  it("posts the documented payload unchanged to a generic webhook", () => {
    const request = buildRequest("webhook", { url: "http://127.0.0.1:9000/hook?k=1" }, completed());
    expect(request.url).toBe("http://127.0.0.1:9000/hook?k=1");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(json(request.body)).toEqual(completed());
  });

  it("publishes JSON to the ntfy server root with optional bearer token", () => {
    const request = buildRequest(
      "ntfy",
      { url: "", topic: " rundfunkarr ", token: "tk_secret" },
      completed()
    );
    expect(request.url).toBe("https://ntfy.sh/");
    expect(request.headers.Authorization).toBe("Bearer tk_secret");
    expect(json(request.body)).toEqual({
      topic: "rundfunkarr",
      title: "Download abgeschlossen",
      message: completed().body,
      tags: ["white_check_mark"],
      priority: 3,
    });
    const anonymous = buildRequest(
      "ntfy",
      { url: "https://ntfy.example.org", topic: "t", token: "" },
      completed()
    );
    expect(anonymous.headers.Authorization).toBeUndefined();
    expect(anonymous.url).toBe("https://ntfy.example.org/");
  });

  it("sends Gotify messages to /message with the app token in a header", () => {
    const failed = buildDownloadFailedPayload(
      { id: "d", title: "T", channel: null, category: null, error: "kaputt" },
      now
    );
    const request = buildRequest(
      "gotify",
      { url: "https://example.org/gotify/", token: "AbCdEf123" },
      failed
    );
    expect(request.url).toBe("https://example.org/gotify/message");
    expect(request.url).not.toContain("AbCdEf123");
    expect(request.headers["X-Gotify-Key"]).toBe("AbCdEf123");
    expect(json(request.body)).toEqual({
      title: "Download fehlgeschlagen",
      message: "T\nFehler: kaputt",
      priority: 8,
    });
  });

  it("builds a Discord embed and suppresses mentions", () => {
    const request = buildRequest(
      "discord",
      { url: "https://discord.com/api/webhooks/1/abc" },
      completed()
    );
    const body = json(request.body);
    expect(body.username).toBe("RundfunkArr");
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds).toEqual([
      {
        title: "Download abgeschlossen",
        description: completed().body,
        color: expect.any(Number),
        timestamp: "2026-10-29T12:00:00.000Z",
      },
    ]);
  });

  it.each([
    ["webhook", { url: "" }, "Webhook: Adresse fehlt."],
    ["webhook", { url: "ftp://example.org" }, "nur http:// und https://"],
    ["ntfy", { url: "", topic: "" }, "ntfy: Topic fehlt."],
    ["gotify", { url: "https://g.example", token: "" }, "Gotify: App-Token fehlt."],
    ["discord", { url: "kein link" }, "ungültige Adresse"],
  ] as const)("rejects incomplete %s settings", (target, config, message) => {
    expect(() => buildRequest(target, config, completed())).toThrow(message);
  });
});

describe("sending", () => {
  it("sends once with a timeout and reports success", async () => {
    await expect(
      sendToTarget("webhook", { url: "http://127.0.0.1:1/hook" }, completed())
    ).resolves.toEqual({ target: "webhook", success: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.lastCall!;
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports HTTP errors with a short response excerpt and does not retry", async () => {
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await expect(
      sendToTarget("ntfy", { url: "", topic: "t", token: "x" }, completed())
    ).resolves.toEqual({ target: "ntfy", success: false, error: "HTTP 401: unauthorized" });
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(
      sendToTarget("webhook", { url: "http://127.0.0.1:1" }, completed())
    ).resolves.toMatchObject({ error: "HTTP 503" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("turns timeouts and network errors into messages instead of throwing", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    await expect(
      sendToTarget("webhook", { url: "http://127.0.0.1:1" }, completed())
    ).resolves.toMatchObject({
      success: false,
      error: `Keine Antwort nach ${SEND_TIMEOUT_MS / 1000} Sekunden.`,
    });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(
      sendToTarget("webhook", { url: "http://127.0.0.1:1" }, completed())
    ).resolves.toMatchObject({ success: false, error: "Nicht erreichbar: fetch failed" });
  });

  it("aborts a hanging request through its timeout signal", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener("abort", () => reject(init.signal!.reason))
          )
      );
      const pending = sendToTarget("webhook", { url: "http://127.0.0.1:1" }, completed());
      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1);
      await expect(pending).resolves.toMatchObject({
        success: false,
        error: `Keine Antwort nach ${SEND_TIMEOUT_MS / 1000} Sekunden.`,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("event filtering and targets", () => {
  it("uses only configured, enabled targets", async () => {
    values.set("notifications.webhook.url", "http://127.0.0.1:1/hook");
    values.set("notifications.ntfy.topic", "");
    values.set("notifications.gotify.url", "https://g.example");
    values.set("notifications.discord.url", "https://discord.com/api/webhooks/1/abc");
    values.set("notifications.discord.enabled", "false");
    expect((await activeTargets("download.completed")).map((t) => t.target)).toEqual(["webhook"]);
  });

  it("sends nothing for a switched-off event", async () => {
    values.set("notifications.webhook.url", "http://127.0.0.1:1/hook");
    values.set("notifications.event.downloadCompleted", "false");
    await expect(dispatchNotification(completed())).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    values.delete("notifications.event.downloadCompleted");
    clearSettingsCache();
    await dispatchNotification(completed());
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends to all active targets and logs failures without secrets", async () => {
    values.set("notifications.webhook.url", "http://127.0.0.1:1/hook");
    values.set("notifications.gotify.url", "https://g.example");
    values.set("notifications.gotify.token", "gotify-app-token");
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("g.example")
        ? new Response("invalid token gotify-app-token", { status: 401 })
        : new Response(null, { status: 204 })
    );
    const results = await dispatchNotification(completed());
    expect(results.map((r) => [r.target, r.success])).toEqual([
      ["webhook", true],
      ["gotify", false],
    ]);
    expect(warn).toHaveBeenCalledOnce();
    expect(redactLog(String(warn.mock.lastCall![0]))).not.toContain("gotify-app-token");
  });
});

describe("fire-and-forget hooks", () => {
  it("returns immediately and never throws, even when settings cannot be read", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.config.findMany).mockRejectedValueOnce(new Error("database locked"));
    expect(notifyDownloadFailed({ id: "d", title: "T", error: "kaputt" })).toBeUndefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(String(warn.mock.lastCall![0])).toContain("database locked");
  });

  it("does not wait for a slow target", async () => {
    values.set("notifications.webhook.url", "http://127.0.0.1:1/hook");
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    notifyDownloadCompleted({ id: "d", title: "T", filePath: "/x/T.mkv", size: 1 });
    expect(Date.now() - started).toBeLessThan(50);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });

  it("adds the broadcaster of subscription downloads", async () => {
    values.set("notifications.webhook.url", "http://127.0.0.1:1/hook");
    findFirst.mockResolvedValue({ channel: "3sat" });
    notifyDownloadCompleted({
      id: "d",
      title: "Doku",
      category: "tv",
      filePath: "/x/Doku.mkv",
      size: 5,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(findFirst).toHaveBeenCalledWith({
      where: { downloadId: "d" },
      select: { channel: true },
    });
    const body = json(fetchMock.mock.lastCall![1].body);
    expect(body.download).toMatchObject({ channel: "3sat", fileName: "Doku.mkv" });
    expect(body.body).toBe("Doku (3sat)\nDatei: Doku.mkv");
  });

  it("skips empty subscription runs", async () => {
    values.set("notifications.webhook.url", "http://127.0.0.1:1/hook");
    notifySubscriptionQueued({ id: "s", name: "n", query: "q", downloads: [] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds a German test message", () => {
    expect(buildTestPayload("gotify", now)).toMatchObject({
      event: "test",
      title: "Testnachricht von RundfunkArr",
      body: "Wenn diese Nachricht ankommt, ist Gotify richtig eingerichtet.",
    });
  });
});
