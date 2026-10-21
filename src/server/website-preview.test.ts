import { describe, expect, it } from "vitest";
import { extractPreviewImage, isAllowedPreviewHost, normalizePreviewUrl } from "./website-preview";

describe("website preview host allowlist", () => {
  it("accepts public broadcaster hosts and their subdomains", () => {
    expect(isAllowedPreviewHost("www.ardmediathek.de")).toBe(true);
    expect(isAllowedPreviewHost("www.zdf.de")).toBe(true);
    expect(isAllowedPreviewHost("www1.wdr.de")).toBe(true);
    expect(isAllowedPreviewHost("tvthek.orf.at")).toBe(true);
    expect(isAllowedPreviewHost("www.srf.ch")).toBe(true);
    expect(isAllowedPreviewHost("ARTE.TV.")).toBe(true);
  });

  it("rejects look-alike, private and unknown hosts", () => {
    expect(isAllowedPreviewHost("zdf.de.evil.example")).toBe(false);
    expect(isAllowedPreviewHost("notzdf.de")).toBe(false);
    expect(isAllowedPreviewHost("localhost")).toBe(false);
    expect(isAllowedPreviewHost("127.0.0.1")).toBe(false);
    expect(isAllowedPreviewHost("sonarr")).toBe(false);
  });

  it("normalizes only plain http(s) URLs on allowed hosts", () => {
    expect(normalizePreviewUrl("https://www.zdf.de/video/x#t=10")?.toString()).toBe(
      "https://www.zdf.de/video/x"
    );
    expect(normalizePreviewUrl("ftp://www.zdf.de/x")).toBeNull();
    expect(normalizePreviewUrl("https://user:pw@www.zdf.de/x")).toBeNull();
    expect(normalizePreviewUrl("https://192.168.1.10/admin")).toBeNull();
    expect(normalizePreviewUrl("not a url")).toBeNull();
  });
});

describe("extractPreviewImage", () => {
  const base = "https://www.ardmediathek.de/video/abc";

  it("prefers og:image and resolves relative addresses", () => {
    const html = `<html><head>
      <meta name="twitter:image" content="/t.jpg">
      <meta property="og:image" content="//img.ardmediathek.de/a.jpg?w=960">
      </head><body></body></html>`;
    expect(extractPreviewImage(html, base)).toBe("https://img.ardmediathek.de/a.jpg?w=960");
  });

  it("handles attribute order, single quotes and entities", () => {
    const html = `<meta content='https://cdn.zdf.de/b.jpg?x=1&amp;y=2' property='og:image' />`;
    expect(extractPreviewImage(html, base)).toBe("https://cdn.zdf.de/b.jpg?x=1&y=2");
  });

  it("falls back to twitter:image and link rel=image_src", () => {
    expect(
      extractPreviewImage(`<meta name="twitter:image" content="https://x.de/c.jpg">`, base)
    ).toBe("https://x.de/c.jpg");
    expect(extractPreviewImage(`<link rel="image_src" href="/d.png">`, base)).toBe(
      "https://www.ardmediathek.de/d.png"
    );
  });

  it("ignores pages without a usable image", () => {
    expect(
      extractPreviewImage(`<meta property="og:image" content="data:image/png;base64,AAA">`, base)
    ).toBeNull();
    expect(extractPreviewImage(`<meta property="og:title" content="Titel">`, base)).toBeNull();
    expect(extractPreviewImage("", base)).toBeNull();
  });
});
