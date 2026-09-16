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
