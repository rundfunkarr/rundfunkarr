import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./fetch-retry";
import { queryMediathekView } from "./mediathek-client";

vi.mock("./fetch-retry", () => ({ fetchWithRetry: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe("queryMediathekView", () => {
  it("preserves successful empty results", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      Response.json({ result: { results: [] }, err: null })
    );
    expect(await queryMediathekView([], 10)).toEqual([]);
  });

  it.each([
    ["an exhausted HTTP failure", () => new Response("unavailable", { status: 503 })],
    ["invalid JSON", () => new Response("not JSON")],
    ["a missing result envelope", () => Response.json({})],
    ["a non-array result", () => Response.json({ result: { results: {} } })],
    ["an API error", () => Response.json({ err: "unavailable", result: { results: [] } })],
    ["a null response", () => Response.json(null)],
  ])("distinguishes %s from an empty result", async (_name, response) => {
    vi.mocked(fetchWithRetry).mockResolvedValue(response());
    expect(await queryMediathekView([], 10)).toBeNull();
  });

  it("distinguishes a network error from an empty result", async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue(new Error("Connection reset"));
    expect(await queryMediathekView([], 10)).toBeNull();
  });
});

const validItem = {
  channel: "ARD",
  topic: "News",
  title: "News",
  description: "",
  filmlisteTimestamp: 1,
  duration: 1800,
  size: 100,
  url_website: "",
  url_video: "https://example.org/video.mp4",
  url_video_low: "",
  url_video_hd: "",
};
it("returns complete valid items unchanged", async () => {
  vi.mocked(fetchWithRetry).mockResolvedValue(Response.json({ result: { results: [validItem] } }));
  expect(await queryMediathekView([], 10)).toEqual([validItem]);
});
it.each([
  null,
  {},
  { ...validItem, title: null },
  { ...validItem, duration: "1800" },
  { ...validItem, size: "unknown" },
])("rejects malformed result entries: %j", async (item) => {
  vi.mocked(fetchWithRetry).mockResolvedValue(
    Response.json({ result: { results: [validItem, item] } })
  );

  expect(await queryMediathekView([], 10)).toBeNull();
});

it("normalizes the unknown size of live ORF HLS entries to zero", async () => {
  vi.mocked(fetchWithRetry).mockResolvedValue(
    Response.json({
      result: {
        results: [{ ...validItem, size: null, url_video: "https://example.org/orf.m3u8" }],
      },
    })
  );
  expect(await queryMediathekView([], 10)).toEqual([
    { ...validItem, size: 0, url_video: "https://example.org/orf.m3u8" },
  ]);
});
