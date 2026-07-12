import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getMinDurationSeconds, getCategoriesForTopics } = vi.hoisted(() => ({
  getMinDurationSeconds: vi.fn(),
  getCategoriesForTopics: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({ getMinDurationSeconds }));
vi.mock("@/services/category", () => ({
  getCategoriesForTopics,
}));

import { GET } from "./route";

function apiItem(title: string, duration: number) {
  return {
    channel: "ARD",
    topic: "Documentary",
    title,
    description: "",
    filmlisteTimestamp: 1_700_000_000,
    duration,
    size: 1_000_000,
    url_website: "https://example.com",
    url_video: `https://example.com/${title}.mp4`,
    url_video_low: "",
    url_video_hd: "",
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  getMinDurationSeconds.mockReset();
  getCategoriesForTopics.mockReset();
  getCategoriesForTopics.mockResolvedValue(new Map());
});

describe("movie search API minimum duration", () => {
  it("uses the configured minimum duration", async () => {
    getMinDurationSeconds.mockResolvedValue(2700);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          result: { results: [apiItem("Too short", 2699), apiItem("Boundary", 2700)] },
        })
      )
    );

    const response = await GET(
      new NextRequest("http://localhost/api/search?q=Documentary&type=movie")
    );
    const body = await response.json();

    expect(body.results.map((item: { title: string }) => item.title)).toEqual(["Boundary"]);
  });

  it("keeps short movie results when minimum duration is disabled", async () => {
    getMinDurationSeconds.mockResolvedValue(0);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result: { results: [apiItem("Short", 120)] } }))
    );

    const response = await GET(
      new NextRequest("http://localhost/api/search?q=Documentary&type=movie")
    );
    const body = await response.json();

    expect(body.results).toHaveLength(1);
  });
});
