import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    config: { findUnique },
  },
}));

import { clearSettingsCache, getMinDurationSeconds, isMkvConversionEnabled } from "./settings";

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

describe("isMkvConversionEnabled", () => {
  it("defaults to enabled when the setting does not exist", async () => {
    findUnique.mockResolvedValue(null);

    await expect(isMkvConversionEnabled()).resolves.toBe(true);
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("maps %s to %s", async (value, expected) => {
    findUnique.mockResolvedValue({ value });

    await expect(isMkvConversionEnabled()).resolves.toBe(expected);
  });
});
