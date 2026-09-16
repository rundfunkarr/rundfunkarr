import { describe, it, expect } from "vitest";
import { parseNzbContent, formatSabnzbdTimeleft } from "./download";

function b64(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64");
}

describe("parseNzbContent", () => {
  it.each(["https://example.com/video.mp4", "http://example.com/video.mp4?token=abc&quality=hd"])(
    "accepts a saved legacy NZB with raw URL %s",
    (url) => {
      const content = `filename="Show.S01E01.nzb"\n<!-- Show title -->\n<!-- ${url} -->`;
      expect(parseNzbContent(content)).toEqual({ fileName: "Show.S01E01", url });
    }
  );

  it("accepts a legacy NZB with a single URL comment", () => {
    expect(parseNzbContent('filename="Show.nzb"\n<!-- https://example.com/video.mp4 -->')).toEqual({
      fileName: "Show",
      url: "https://example.com/video.mp4",
    });
  });

  it("does not treat an arbitrary title comment as a legacy URL", () => {
    expect(
      parseNzbContent('filename="Show.nzb"\n<!-- https://example.com is mentioned here -->')
    ).toBeNull();
  });

  // Real generator output: title comment first, then URL comment, both
  // base64-encoded - see the doc comment on COMMENT_REGEX in ./download
  // for why (a raw URL containing "--" broke XML comment syntax outright).
  it("should parse valid NZB content with a title comment and a base64 URL comment", () => {
    const nzbContent = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.0//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.0.dtd">
<!-- ${b64("Show.S01E01.720p.WEB.h264-GROUP")} -->
<!-- ${b64("https://example.com/video.mp4")} -->
<nzb>
    <file poster="RundfunkArr" subject='filename="Show.S01E01.720p.WEB.h264-GROUP.nzb"'>
        <segments></segments>
    </file>
</nzb>`;

    const result = parseNzbContent(nzbContent);

    expect(result).not.toBeNull();
    expect(result?.fileName).toBe("Show.S01E01.720p.WEB.h264-GROUP");
    expect(result?.url).toBe("https://example.com/video.mp4");
  });

  // Regression test: this exact URL (a real ORF CDN filename) broke every
  // download of the affected releases before the base64 fix - Sonarr's own
  // XML validation rejected the .nzb file outright with "An XML comment
  // cannot contain '--'" before it ever reached this parser.
  it("round-trips a URL containing '--', which would break a raw XML comment", () => {
    const trickyUrl =
      "https://apasfiis.sf.apa.at/ipad/cms-worldwide/2026/03/21/2026-03-21_2350_in_01_BOesterreich--6_____14315861__o__4262673436__s16057076_QXA.mp4/chunklist_b6100000.m3u8";
    const nzbContent = `filename="Boesterreich.S01E06.nzb"
    <!-- ${b64("Boesterreich.S01E06")} -->
    <!-- ${b64(trickyUrl)} -->`;

    const result = parseNzbContent(nzbContent);

    expect(result).not.toBeNull();
    expect(result?.url).toBe(trickyUrl);
  });

  it("should parse filename with special characters", () => {
    const nzbContent = `filename="Der.Tatort.S2024E01.German.720p.WEB.h264-MEDiATHEK.nzb"
    <!-- ${b64("https://example.com/video.mp4")} -->`;

    const result = parseNzbContent(nzbContent);

    expect(result).not.toBeNull();
    expect(result?.fileName).toBe("Der.Tatort.S2024E01.German.720p.WEB.h264-MEDiATHEK");
  });

  it("should return null when filename is missing", () => {
    const nzbContent = `<!-- ${b64("https://example.com/video.mp4")} -->`;

    const result = parseNzbContent(nzbContent);

    expect(result).toBeNull();
  });

  it("should return null when URL is missing", () => {
    const nzbContent = `filename="Show.S01E01.nzb"`;

    const result = parseNzbContent(nzbContent);

    expect(result).toBeNull();
  });

  it("should return null for empty content", () => {
    const result = parseNzbContent("");

    expect(result).toBeNull();
  });

  it("should handle HTTP (non-S) URLs", () => {
    const nzbContent = `filename="Show.nzb"
    <!-- ${b64("http://example.com/video.mp4")} -->`;

    const result = parseNzbContent(nzbContent);

    expect(result).not.toBeNull();
    expect(result?.url).toBe("http://example.com/video.mp4");
  });

  it("should handle URLs with query parameters", () => {
    const nzbContent = `filename="Show.nzb"
    <!-- ${b64("https://example.com/video.mp4?token=abc123")} -->`;

    const result = parseNzbContent(nzbContent);

    expect(result).not.toBeNull();
    expect(result?.url).toBe("https://example.com/video.mp4?token=abc123");
  });
});

describe("formatSabnzbdTimeleft", () => {
  // Regression test: Radarr/Sonarr's SABnzbd client parser rejects any
  // timeleft value that isn't exactly "H:MM:SS" or "D:H:MM:SS". This used
  // to produce "M:SS" for anything under an hour, which made every queue
  // poll fail with "Expected either 0:0:0:0 or 0:0:0 format, but received:
  // 5:20" - so Radarr never saw a download as in-progress even while it
  // was genuinely downloading (confirmed live against a real Radarr log).

  it("always includes the hours component, even when zero", () => {
    expect(formatSabnzbdTimeleft(320)).toBe("0:05:20");
  });

  it("formats multi-hour durations correctly", () => {
    expect(formatSabnzbdTimeleft(3725)).toBe("1:02:05");
  });

  it("formats zero seconds as a valid three-part value", () => {
    expect(formatSabnzbdTimeleft(0)).toBe("0:00:00");
  });

  it("every output matches SABnzbd's expected H:MM:SS shape", () => {
    for (const seconds of [1, 59, 60, 3599, 3600, 86399]) {
      expect(formatSabnzbdTimeleft(seconds)).toMatch(/^\d+:\d{2}:\d{2}$/);
    }
  });
});
