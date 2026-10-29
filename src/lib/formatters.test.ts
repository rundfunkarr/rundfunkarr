import { describe, expect, it } from "vitest";
import { formatDate, formatDateShort, formatDuration, formatSize } from "./formatters";

describe("formatDuration", () => {
  it.each([
    [0, "0m"],
    [59, "0m"],
    [90, "1m"],
    [3600, "1h 0m"],
    [5400, "1h 30m"],
    [7322, "2h 2m"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe("formatSize", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [700 * 1024 * 1024, "700 MB"],
    [5.25 * 1024 ** 3, "5.3 GB"],
    [2 * 1024 ** 4, "2 TB"],
    // Larger values stay in the largest unit instead of printing "undefined".
    [3 * 1024 ** 5, "3072 TB"],
  ])("formats %d bytes as %s", (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });

  it("treats unknown sizes (null, NaN, negative, fractions of a byte) gracefully", () => {
    expect(formatSize(null as unknown as number)).toBe("0 B");
    expect(formatSize(Number.NaN)).toBe("0 B");
    expect(formatSize(-1)).toBe("0 B");
    expect(formatSize(0.5)).toBe("0.5 B");
  });
});

describe("date formatting", () => {
  // 2024-03-05T07:09:00Z
  const timestamp = Date.UTC(2024, 2, 5, 7, 9) / 1000;
  const local = new Date(timestamp * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");

  it("formats unix seconds as German date with year and time", () => {
    const formatted = formatDate(timestamp);
    expect(formatted).toContain(`${pad(local.getDate())}.${pad(local.getMonth() + 1)}.2024`);
    expect(formatted).toContain(`${pad(local.getHours())}:${pad(local.getMinutes())}`);
  });

  it("omits the year in the short format", () => {
    const formatted = formatDateShort(timestamp);
    expect(formatted).toContain(`${pad(local.getDate())}.${pad(local.getMonth() + 1)}.`);
    expect(formatted).not.toContain("2024");
    expect(formatted).toContain(`${pad(local.getHours())}:${pad(local.getMinutes())}`);
  });
});
