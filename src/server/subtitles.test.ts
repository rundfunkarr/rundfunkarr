import { describe, expect, it } from "vitest";
import { subtitleToSrt } from "./subtitles";
import { mediaMetadataComment, matchesAudioVariant, releaseLanguage } from "@/lib/media-metadata";
import { parseNzbContent } from "@/services/download";

describe("Untertitel", () => {
  it("wandelt WebVTT mit Positionierung und UTF-8 in SRT um", async () => {
    expect(
      await subtitleToSrt(
        "WEBVTT\n\n00:01.250 --> 00:03.500 align:start\n<c.red>Grüße &amp; Wissen</c>\n"
      )
    ).toBe("1\n00:00:01,250 --> 00:00:03,500\nGrüße & Wissen\n");
  });
  it("erhält Textreihenfolge, Spans und Zeilenumbrüche in TTML", async () => {
    expect(
      await subtitleToSrt(
        '<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="10s"><p begin="1s" dur="2s">Vor <span>dem</span> Haus<br/>danach.</p></div></body></tt>'
      )
    ).toBe("1\n00:00:11,000 --> 00:00:13,000\nVor dem Haus\ndanach.\n");
  });
  it("weist unvollständige Zeiten, HTML und externe Entitäten zurück", async () => {
    for (const input of [
      "<html>Fehler</html>",
      '<tt><body><p begin="1s">ohne Ende</p></body></tt>',
      '<!DOCTYPE tt SYSTEM "file:///etc/passwd"><tt/>',
    ])
      await expect(subtitleToSrt(input)).rejects.toThrow();
  });
  it("erhält Leerzeichen zwischen TTML-Spans", async () => {
    expect(
      await subtitleToSrt(
        '<tt><body><p begin="0s" end="1s"><span>Ein</span> <span>Untertitel</span></p></body></tt>'
      )
    ).toContain("Ein Untertitel");
  });
  it("behält SRT-Zeitangaben bei", async () => {
    const srt = "1\n01:02:03,045 --> 01:02:05,100\nText\n";
    expect(await subtitleToSrt(srt)).toBe(srt);
  });
});

describe("Fassungen und NZB-Metadaten", () => {
  it("übergibt Untertitel auch nach dem URL-Kommentar und ohne XML-Konflikte", () => {
    const subtitle = "https://example.org/ü--titel.vtt";
    const comment = mediaMetadataComment({ url_subtitle: subtitle });
    expect(comment).not.toContain("--");
    expect(
      parseNzbContent(`<!-- https://example.org/video.mp4 --><!-- ${comment} -->`, "Test.nzb")
    ).toEqual({
      fileName: "Test",
      url: "https://example.org/video.mp4",
      metadata: { subtitleUrl: subtitle },
    });
  });
  it("ignoriert ungültige Zusatzdaten bei einem älteren NZB", () => {
    const bad = Buffer.from('rundfunkarr-media:{"subtitleUrl":"file:///etc/passwd"}').toString(
      "base64"
    );
    expect(
      parseNzbContent(`<!-- ${bad} --><!-- https://example.org/video.mp4 -->`, "Test.nzb")
    ).toEqual({ fileName: "Test", url: "https://example.org/video.mp4" });
  });
  it("kennzeichnet Originalfassungen ohne eine erfundene Sprache", () => {
    expect(releaseLanguage("Die Reise (OmU)")).toBe("ORIGINAL");
    expect(matchesAudioVariant("Die Reise (Originalversion)", "original")).toBe(true);
    expect(matchesAudioVariant("Die Reise (Hörfassung)", "standard")).toBe(false);
    expect(matchesAudioVariant("Die Reise (Audiodeskription)", "description")).toBe(true);
  });
});
