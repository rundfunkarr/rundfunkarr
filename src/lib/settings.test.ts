import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    config: { findUnique },
  },
}));

import { clearSettingsCache, getMinDurationSeconds } from "./settings";

beforeEach(() => {
  clearSettingsCache();
  findUnique.mockReset();
});

describe("getMinDurationSeconds", () => {
  it("uses the configured duration", async () => {
    findUnique.mockResolvedValue({ value: "2700" });

    await expect(getMinDurationSeconds()).resolves.toBe(2700);
  });

  it("allows zero to disable minimum-duration filtering", async () => {
    findUnique.mockResolvedValue({ value: "0" });

    await expect(getMinDurationSeconds()).resolves.toBe(0);
  });

  it.each([null, { value: "invalid" }, { value: "-1" }])(
    "falls back to 300 seconds for %j",
    async (config) => {
      findUnique.mockResolvedValue(config);

      await expect(getMinDurationSeconds()).resolves.toBe(300);
    }
  );
});
