import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, POST } from "./route";
import { clearSettingsCache, getSetting } from "@/lib/settings";

// Uses the real settings cache to check that saving and deleting through the
// API invalidates cached values and cached misses alike.
const { values, findUnique } = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
      values.has(where.key) ? { key: where.key, value: values.get(where.key)! } : null
    ),
  };
});
vi.mock("@/lib/db", () => ({
  prisma: {
    config: {
      findUnique,
      upsert: vi.fn(
        async ({ where, update }: { where: { key: string }; update: { value: string } }) =>
          values.set(where.key, update.value)
      ),
      delete: vi.fn(async ({ where }: { where: { key: string } }) => values.delete(where.key)),
    },
  },
}));
vi.mock("@/lib/cache", () => ({ clearTTLCache: vi.fn(), mediathekCache: { clear: vi.fn() } }));
vi.mock("@/services/tvdb", () => ({ clearTvdbTokenCache: vi.fn() }));
vi.mock("@/services/srgssr-api", () => ({ clearTokenCache: vi.fn() }));

beforeEach(() => {
  values.clear();
  clearSettingsCache();
  findUnique.mockClear();
});

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/settings", { method: "POST", body: JSON.stringify(body) })
  );
}

it("caches a missing setting and shows it right after it is saved", async () => {
  expect(await getSetting("matching.minDuration")).toBeNull();
  expect(await getSetting("matching.minDuration")).toBeNull();
  expect(findUnique).toHaveBeenCalledTimes(1);

  await post({ key: "matching.minDuration", value: "600" });
  expect(await getSetting("matching.minDuration")).toBe("600");

  expect(await getSetting("download.enableHLS")).toBeNull();
  await post({ "download.enableHLS": "true" });
  expect(await getSetting("download.enableHLS")).toBe("true");
});

it("returns null right after a cached setting is deleted", async () => {
  values.set("matching.minDuration", "600");
  expect(await getSetting("matching.minDuration")).toBe("600");

  await DELETE(new NextRequest("http://localhost/api/settings?key=matching.minDuration"));
  expect(await getSetting("matching.minDuration")).toBeNull();
});
