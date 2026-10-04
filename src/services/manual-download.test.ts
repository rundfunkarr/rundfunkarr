import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/search/manual/route";

const { addToQueue, getSetting, getVideoInfo } = vi.hoisted(() => ({
  addToQueue: vi.fn(),
  getSetting: vi.fn(),
  getVideoInfo: vi.fn(),
}));
vi.mock("./download", () => ({ addToQueue }));
vi.mock("@/lib/settings", () => ({ getSetting }));
vi.mock("@/server/ytdlp", () => ({ getVideoInfo }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  addToQueue.mockResolvedValue({ id: "download" });
  getSetting.mockResolvedValue("false");
  getVideoInfo.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

function request(url: string) {
  return new NextRequest("http://localhost/api/search/manual", {
    method: "POST",
    body: JSON.stringify({ url, quality: "high" }),
  });
}

it.each([
  ["file:///tmp/Film.mp4", false, "HTTP- oder HTTPS-Adresse"],
  ["https://user:password@example.org/Film.mp4", false, "ohne Zugangsdaten"],
  ["https://example.org/page", false, "MP4-/M3U8-Link"],
  ["https://www.zdf.de/video/test", false, "HLS-Streams"],
  ["https://www.zdf.de/video/test", true, "Sendungsseite konnte nicht aufgelöst"],
] as const)("returns an actionable input error for %s (HLS: %s)", async (url, hls, message) => {
  getSetting.mockResolvedValue(String(hls));
  const response = await POST(request(url));
  expect(response.status).toBe(422);
  expect((await response.json()).error).toContain(message);
  expect(addToQueue).not.toHaveBeenCalled();
});

it.each(["settings", "queue", "extractor"] as const)(
  "returns a generic server error for an unexpected %s failure",
  async (source) => {
    const failure = new Error("Internal database or process details");
    getSetting.mockResolvedValue("true");
    if (source === "settings") getSetting.mockRejectedValue(failure);
    if (source === "queue") addToQueue.mockRejectedValue(failure);
    if (source === "extractor") getVideoInfo.mockRejectedValue(failure);

    const response = await POST(
      request(source === "queue" ? "https://example.org/Film.mp4" : "https://www.zdf.de/video/test")
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Der Download konnte nicht hinzugefügt werden.",
    });
    if (source !== "queue") expect(addToQueue).not.toHaveBeenCalled();
  }
);

it("queues a valid direct download", async () => {
  const response = await POST(request("https://example.org/Film.mp4"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: "download", title: "Film" });
  expect(addToQueue).toHaveBeenCalledExactlyOnceWith(
    "https://example.org/Film.mp4",
    "Film",
    "default"
  );
});
