import { afterEach, describe, expect, it, vi } from "vitest";
import { validateApiCredentials } from "./validate-api-credentials";

afterEach(() => vi.unstubAllGlobals());

describe("validateApiCredentials", () => {
  it("posts provider, key and pin to the server-side validator", async () => {
    const fetchMock = vi.fn(async () => Response.json({ valid: true }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await validateApiCredentials("tvdb", "key", "1234")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/settings/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "tvdb", key: "key", pin: "1234" }),
    });
  });

  it.each([
    ["an error status", () => new Response(null, { status: 500 })],
    ["valid: false", () => Response.json({ valid: false })],
    ["a truthy non-boolean", () => Response.json({ valid: "yes" })],
  ])("reports invalid credentials for %s", async (_label, reply) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply())
    );

    expect(await validateApiCredentials("tmdb", "key")).toBe(false);
  });
});
