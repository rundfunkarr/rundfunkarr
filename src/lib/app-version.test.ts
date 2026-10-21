import { describe, expect, it } from "vitest";
import { formatAppVersion } from "./app-version";

describe("formatAppVersion", () => {
  it("shows the release version for tag builds", () => {
    expect(formatAppVersion("1.4.0", "5e0d4194f2683a53", "1.4.0")).toBe("v1.4.0");
  });

  it("accepts a tag name with v prefix", () => {
    expect(formatAppVersion("v1.4.0", undefined, "1.3.2")).toBe("v1.4.0");
  });

  it("keeps pre-release suffixes", () => {
    expect(formatAppVersion("1.5.0-rc.1", "abc", "1.4.0")).toBe("v1.5.0-rc.1");
  });

  it("shows channel and short commit for branch builds", () => {
    expect(formatAppVersion("main", "5e0d4194f2683a53e9e6", "1.4.0")).toBe("main · 5e0d419");
    expect(formatAppVersion("nightly", "b15a9a6d7dfd", "1.4.0")).toBe("nightly · b15a9a6");
    expect(formatAppVersion("pr-72", "c966770ab498", "1.4.0")).toBe("pr-72 · c966770");
  });

  it("shows the channel alone when the commit is missing", () => {
    expect(formatAppVersion("main", "", "1.4.0")).toBe("main");
    expect(formatAppVersion("main", undefined, "1.4.0")).toBe("main");
  });

  it("falls back to the package version without build info", () => {
    expect(formatAppVersion(undefined, undefined, "1.4.0")).toBe("v1.4.0");
    expect(formatAppVersion("  ", "5e0d419", "1.4.0")).toBe("v1.4.0");
  });
});
