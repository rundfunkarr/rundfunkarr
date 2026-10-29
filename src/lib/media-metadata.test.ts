import { describe, expect, it } from "vitest";
import { parseNzbContent } from "@/services/download";
import { mediaMetadata, mediaMetadataComment, parseMediaMetadata } from "./media-metadata";

describe("broadcaster in media metadata", () => {
  it("stores the channel next to the subtitle and audio metadata", () => {
    expect(
      mediaMetadata({
        url_subtitle: "https://example.com/t.vtt",
        audioLanguage: "deu",
        channel: " ZDF ",
      })
    ).toEqual({ subtitleUrl: "https://example.com/t.vtt", audioLanguage: "deu", channel: "ZDF" });
  });

  it("cleans unusual channel names instead of dropping the subtitle", () => {
    const metadata = mediaMetadata({
      url_subtitle: "https://example.com/t.vtt",
      channel: `ARD\n${"x".repeat(200)}`,
    });
    expect(metadata.subtitleUrl).toBe("https://example.com/t.vtt");
    expect(metadata.channel).toHaveLength(100);
    expect(metadata.channel).not.toContain("\n");
    expect(mediaMetadata({ channel: " \t " })).toEqual({});
  });

  it("round-trips the channel through the NZB comment of the web UI", () => {
    const nzb = `filename="Film.nzb"\n<!-- https://example.com/film.mp4 -->\n<!-- ${mediaMetadataComment({ channel: "3sat" })} -->`;
    expect(parseNzbContent(nzb)?.metadata).toEqual({ channel: "3sat" });
  });

  it("keeps reading metadata stored before the channel existed", () => {
    expect(parseMediaMetadata('{"subtitleUrl":"https://example.com/t.vtt"}')).toEqual({
      subtitleUrl: "https://example.com/t.vtt",
    });
    expect(parseMediaMetadata('{"channel":""}')).toEqual({});
  });
});
