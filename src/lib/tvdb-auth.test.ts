import { describe, expect, it } from "vitest";
import { buildTvdbLoginPayload, isTvdbCredentialSettingKey } from "./tvdb-auth";

describe("buildTvdbLoginPayload", () => {
  it("builds a payload for project API keys without a PIN", () => {
    expect(buildTvdbLoginPayload("project-api-key")).toEqual({ apikey: "project-api-key" });
  });

  it("includes the PIN when one is provided", () => {
    expect(buildTvdbLoginPayload("subscriber-api-key", "1234")).toEqual({
      apikey: "subscriber-api-key",
      pin: "1234",
    });
  });

  it("omits blank or whitespace-only PIN values", () => {
    expect(buildTvdbLoginPayload("project-api-key", "   ")).toEqual({
      apikey: "project-api-key",
    });
  });

  it("trims pasted credentials", () => {
    expect(buildTvdbLoginPayload("  project-api-key  ", "  1234  ")).toEqual({
      apikey: "project-api-key",
      pin: "1234",
    });
  });

  it("returns null when no API key is provided", () => {
    expect(buildTvdbLoginPayload("   ", "1234")).toBeNull();
  });
});

describe("isTvdbCredentialSettingKey", () => {
  it("matches the TVDB credential settings", () => {
    expect(isTvdbCredentialSettingKey("api.tvdb.key")).toBe(true);
    expect(isTvdbCredentialSettingKey("api.tvdb.pin")).toBe(true);
  });

  it("does not match unrelated settings", () => {
    expect(isTvdbCredentialSettingKey("api.tmdb.key")).toBe(false);
  });
});
