import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getSetting } from "@/lib/settings";
import { maskSetting } from "@/lib/settings-redaction";
import { POST } from "./route";
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));
const providerFetch = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", providerFetch);
  providerFetch.mockResolvedValue(Response.json({ data: { token: "private-token" } }));
  vi.mocked(getSetting).mockImplementation(async (key) => `stored-${key}`);
});
afterEach(() => vi.unstubAllGlobals());
function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/settings/validate", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}
it("validates masked TVDB credentials server-side without returning keys or tokens", async () => {
  const response = await post({
    provider: "tvdb",
    key: maskSetting("api.tvdb.key", "secret"),
    pin: maskSetting("api.tvdb.pin", "secret"),
  });
  expect(await response.json()).toEqual({ valid: true });
  expect(JSON.parse(providerFetch.mock.calls[0][1].body)).toEqual({
    apikey: "stored-api.tvdb.key",
    pin: "stored-api.tvdb.pin",
  });
});
it("validates new credentials without reading or overwriting saved values", async () => {
  await post({ provider: "tvdb", key: " new-key ", pin: "" });
  expect(getSetting).not.toHaveBeenCalled();
  expect(JSON.parse(providerFetch.mock.calls[0][1].body)).toEqual({ apikey: "new-key" });
});
it("resolves a masked TMDB key and encodes query parameters", async () => {
  vi.mocked(getSetting).mockResolvedValue("key&private=value");
  expect(
    await (await post({ provider: "tmdb", key: maskSetting("api.tmdb.key", "secret") })).json()
  ).toEqual({ valid: true });
  const url = providerFetch.mock.calls[0][0] as URL;
  expect(url.searchParams.get("api_key")).toBe("key&private=value");
  expect([...url.searchParams]).toHaveLength(1);
});
it("rejects empty or missing saved credentials without contacting a provider", async () => {
  vi.mocked(getSetting).mockResolvedValue(null);
  for (const key of ["", "  ", maskSetting("api.tvdb.key", "secret")]) {
    expect(await (await post({ provider: "tvdb", key })).json()).toEqual({ valid: false });
  }
  expect(providerFetch).not.toHaveBeenCalled();
});
it("reports provider rejection and failure without disclosing provider content", async () => {
  providerFetch
    .mockResolvedValueOnce(new Response("private-key", { status: 401 }))
    .mockRejectedValueOnce(new Error("private-key"));
  for (let i = 0; i < 2; i++)
    expect(await (await post({ provider: "tmdb", key: "key" })).json()).toEqual({ valid: false });
});
it.each([
  null,
  {},
  { provider: "unknown", key: "key" },
  { provider: "tvdb", key: 1 },
  { provider: "tvdb", key: "key", pin: 1 },
])("rejects invalid requests: %j", async (body) => {
  expect((await post(body)).status).toBe(400);
  expect(providerFetch).not.toHaveBeenCalled();
});
