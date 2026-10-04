import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  installLogger: vi.fn(),
  rememberLogSecret: vi.fn(),
  initSettingsFromEnv: vi.fn(),
  initCacheTTL: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { config: { findMany: mocks.findMany } } }));
vi.mock("@/lib/logger", () => ({
  installLogger: mocks.installLogger,
  rememberLogSecret: mocks.rememberLogSecret,
}));
vi.mock("@/lib/env-settings", () => ({ initSettingsFromEnv: mocks.initSettingsFromEnv }));
vi.mock("@/lib/cache", () => ({ initCacheTTL: mocks.initCacheTTL }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "");
  mocks.findMany.mockResolvedValue([]);
  mocks.initSettingsFromEnv.mockResolvedValue(0);
  mocks.initCacheTTL.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("installs logging and initializes settings/cache when optional secret preload fails", async () => {
  mocks.findMany.mockRejectedValueOnce(new Error("temporary config read failure"));
  vi.stubEnv("TVDB_API_KEY", "runtime-sensitive-key");

  await expect(register()).resolves.toBeUndefined();

  expect(mocks.installLogger).toHaveBeenCalledOnce();
  expect(mocks.rememberLogSecret).toHaveBeenCalledWith("runtime-sensitive-key");
  expect(mocks.initSettingsFromEnv).toHaveBeenCalledOnce();
  expect(mocks.initCacheTTL).toHaveBeenCalledOnce();
});

it("preloads stored credentials while leaving ordinary setting values visible", async () => {
  mocks.findMany.mockResolvedValueOnce([
    { key: "api.tvdb.pin", value: "29" },
    { key: "api.tmdb.key", value: "stored-sensitive-key" },
    { key: "download.path", value: "/ordinary/downloads" },
  ]);

  await register();

  expect(mocks.rememberLogSecret).toHaveBeenCalledWith("29");
  expect(mocks.rememberLogSecret).toHaveBeenCalledWith("stored-sensitive-key");
  expect(mocks.rememberLogSecret).not.toHaveBeenCalledWith("/ordinary/downloads");
  expect(mocks.installLogger).toHaveBeenCalledOnce();
});

it("continues to report failures from required settings initialization", async () => {
  const failure = new Error("settings transaction failed");
  mocks.initSettingsFromEnv.mockRejectedValueOnce(failure);

  await expect(register()).rejects.toBe(failure);

  expect(mocks.installLogger).toHaveBeenCalledOnce();
  expect(mocks.initCacheTTL).not.toHaveBeenCalled();
});

it("does not preload credentials or wrap console output during a production build", async () => {
  vi.stubEnv("NEXT_PHASE", "phase-production-build");

  await register();

  expect(mocks.findMany).not.toHaveBeenCalled();
  expect(mocks.rememberLogSecret).not.toHaveBeenCalled();
  expect(mocks.installLogger).not.toHaveBeenCalled();
});
