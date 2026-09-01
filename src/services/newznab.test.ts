import { describe, it, expect } from "vitest";
import {
  generateAttributes,
  getEmptyRssResult,
  serializeRss,
  convertItemsToRss,
  generateFakeNzb,
  getCapabilitiesXml,
  generateGenericRssItems,
  getValidationRss,
  isMovieCategoryRequest,
  parseNewznabCategoryIds,
} from "./newznab";
import type { NewznabItem, ApiResultItem } from "@/types";

describe("generateAttributes", () => {
  it("should generate category attributes", () => {
    const attrs = generateAttributes(null, ["5000", "5040"]);

    expect(attrs).toHaveLength(2);
    expect(attrs[0]).toEqual({ name: "category", value: "5000" });
    expect(attrs[1]).toEqual({ name: "category", value: "5040" });
  });

  it("should add season attribute when provided", () => {
    const attrs = generateAttributes("01", ["5000"]);

    expect(attrs).toHaveLength(2);
    expect(attrs[1]).toEqual({ name: "season", value: "01" });
  });

  it("should add tvdbid attribute when provided", () => {
    const attrs = generateAttributes(null, ["5000"], 12345);

    expect(attrs).toHaveLength(2);
    expect(attrs[1]).toEqual({ name: "tvdbid", value: "12345" });
  });

  it("should include all attributes when all params provided", () => {
    const attrs = generateAttributes("02", ["5000", "5040"], 99999);

    expect(attrs).toHaveLength(4);
    expect(attrs.find((a) => a.name === "season")).toEqual({ name: "season", value: "02" });
    expect(attrs.find((a) => a.name === "tvdbid")).toEqual({ name: "tvdbid", value: "99999" });
  });
});

describe("getEmptyRssResult", () => {
  it("should return empty RSS structure", () => {
    const result = getEmptyRssResult();

    expect(result.channel.title).toBe("RundfunkArr");
    expect(result.channel.response.offset).toBe(0);
    expect(result.channel.response.total).toBe(0);
    expect(result.channel.items).toEqual([]);
  });
});

describe("serializeRss", () => {
  it("should serialize empty RSS to valid XML", () => {
    const rss = getEmptyRssResult();
    const xml = serializeRss(rss);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<rss");
    expect(xml).toContain("xmlns:newznab");
    expect(xml).toContain("<channel>");
    expect(xml).toContain("<title>RundfunkArr</title>");
  });

  it("should include newznab:response with offset and total", () => {
    const rss = getEmptyRssResult();
    const xml = serializeRss(rss);

    expect(xml).toContain("newznab:response");
    expect(xml).toContain('offset="0"');
    expect(xml).toContain('total="0"');
  });
});

describe("convertItemsToRss", () => {
  const mockItem: NewznabItem = {
    title: "Test.Show.S01E01.720p.WEB.h264-TEST",
    guid: { isPermaLink: true, value: "http://example.com/1" },
    link: "http://example.com/video.mp4",
    comments: "http://example.com/page",
    pubDate: "Mon, 01 Jan 2024 12:00:00 GMT",
    category: "TV > HD",
    description: "Test description",
    enclosure: {
      url: "/api/download?id=1",
      length: 1000000,
      type: "application/x-nzb",
    },
    attributes: [{ name: "category", value: "5040" }],
  };

  it("should convert items to RSS XML", () => {
    const xml = convertItemsToRss([mockItem], 100, 0);

    expect(xml).toContain("Test.Show.S01E01.720p.WEB.h264-TEST");
    expect(xml).toContain('total="1"');
  });

  it("should handle pagination with offset", () => {
    const items = [mockItem, { ...mockItem, title: "Second.Item" }];
    const xml = convertItemsToRss(items, 1, 1);

    expect(xml).toContain("Second.Item");
    expect(xml).not.toContain("Test.Show.S01E01");
    expect(xml).toContain('offset="1"');
    expect(xml).toContain('total="2"');
  });

  it("should return empty RSS for empty items array", () => {
    const xml = convertItemsToRss([], 100, 0);

    expect(xml).toContain('total="0"');
  });

  it("should respect limit parameter", () => {
    const items = Array(5)
      .fill(null)
      .map((_, i) => ({ ...mockItem, title: `Item${i}` }));
    const xml = convertItemsToRss(items, 2, 0);

    expect(xml).toContain("Item0");
    expect(xml).toContain("Item1");
    expect(xml).not.toContain("Item2");
  });
});

describe("Newznab validation categories", () => {
  it("parses unique numeric category IDs", () => {
    expect(parseNewznabCategoryIds("2040, 2030,2040,invalid")).toEqual(["2040", "2030"]);
  });

  it("detects movie categories using exact IDs", () => {
    expect(isMovieCategoryRequest(["2040"])).toBe(true);
    expect(isMovieCategoryRequest(["12000"])).toBe(false);
  });

  it("adds the movie parent category to a validation result", () => {
    const xml = getValidationRss(["2040"], new Date("2026-09-01T00:00:00Z"));

    expect(xml).toContain('name="category" value="2040"');
    expect(xml).toContain('name="category" value="2000"');
    expect(xml).not.toContain('name="category" value="5000"');
  });
});

describe("generateFakeNzb", () => {
  it("should generate valid NZB XML", () => {
    const nzb = generateFakeNzb("http://example.com/video.mp4", "Test.Show.S01E01");

    expect(nzb).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(nzb).toContain("<!DOCTYPE nzb");
    expect(nzb).toContain("<nzb");
  });

  it("should include URL in comment", () => {
    const url = "http://example.com/video.mp4";
    const nzb = generateFakeNzb(url, "Test");

    expect(nzb).toContain(`<!-- ${url} -->`);
  });

  it("should include title in meta", () => {
    const title = "My.Show.S01E01.720p";
    const nzb = generateFakeNzb("http://example.com", title);

    expect(nzb).toContain(`<meta type="title">${title}</meta>`);
  });

  it("should include base64 encoded URL in segment", () => {
    const url = "http://example.com/test.mp4";
    const nzb = generateFakeNzb(url, "Test");
    const encoded = Buffer.from(url).toString("base64");

    expect(nzb).toContain(encoded);
  });
});

describe("getCapabilitiesXml", () => {
  it("should return valid capabilities XML", () => {
    const xml = getCapabilitiesXml();

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<caps>");
  });

  it("should include server info", () => {
    const xml = getCapabilitiesXml();

    expect(xml).toContain('title="RundfunkArr"');
    expect(xml).toContain("German Public TV Indexer");
  });

  it("should include supported search types", () => {
    const xml = getCapabilitiesXml();

    expect(xml).toContain("<searching>");
    expect(xml).toContain('available="yes"');
    expect(xml).toContain("tv-search");
    expect(xml).toContain("movie-search");
  });

  it("should include category definitions", () => {
    const xml = getCapabilitiesXml();

    expect(xml).toContain('id="5000"');
    expect(xml).toContain('name="TV"');
    expect(xml).toContain('id="2000"');
    expect(xml).toContain('name="Movies"');
  });

  it("should indicate registration is not available", () => {
    const xml = getCapabilitiesXml();

    expect(xml).toContain("<registration");
    expect(xml).toContain('available="no"');
  });
});

describe("generateGenericRssItems", () => {
  const baseItem: ApiResultItem = {
    channel: "ARD",
    topic: "Beispielserie",
    title: "Folge 5: Der Anfang",
    description: "An example description",
    filmlisteTimestamp: 1700000000,
    duration: 2700,
    size: 1_000_000_000,
    url_website: "https://example.com/video",
    url_video: "https://example.com/video_720.mp4",
    url_video_low: "https://example.com/video_480.mp4",
    url_video_hd: "https://example.com/video_1080.mp4",
  };

  it("emits one item per available quality with preference all", () => {
    const items = generateGenericRssItems(baseItem, "all");

    expect(items).toHaveLength(3);
    const guids = items.map((i) => i.guid.value);
    expect(guids.some((g) => g.endsWith("#1080p"))).toBe(true);
    expect(guids.some((g) => g.endsWith("#720p"))).toBe(true);
    expect(guids.some((g) => g.endsWith("#480p"))).toBe(true);
  });

  it("picks only the highest quality with preference best", () => {
    const items = generateGenericRssItems(baseItem, "best");

    expect(items).toHaveLength(1);
    expect(items[0].guid.value).toBe("https://example.com/video#1080p");
  });

  it("parses Folge N titles into season/episode attributes", () => {
    const items = generateGenericRssItems(baseItem, "best");
    const attrs = items[0].attributes;

    expect(attrs.find((a) => a.name === "season")).toEqual({ name: "season", value: "01" });
    expect(attrs.find((a) => a.name === "episode")).toEqual({ name: "episode", value: "05" });
  });

  it("parses explicit S<season>/E<episode> titles", () => {
    const items = generateGenericRssItems({ ...baseItem, title: "Tolle Folge (S02/E03)" }, "best");
    const attrs = items[0].attributes;

    expect(attrs.find((a) => a.name === "season")).toEqual({ name: "season", value: "02" });
    expect(attrs.find((a) => a.name === "episode")).toEqual({ name: "episode", value: "03" });
  });

  it("still emits a generic item when no episode info is present", () => {
    const items = generateGenericRssItems(
      { ...baseItem, title: "Reportage without a number" },
      "best"
    );

    expect(items).toHaveLength(1);
    expect(items[0].attributes.find((a) => a.name === "episode")).toBeUndefined();
    expect(items[0].attributes.some((a) => a.name === "category")).toBe(true);
  });
});

describe("generateGenericRssItems - edge cases", () => {
  const base: ApiResultItem = {
    channel: "ARD",
    topic: "Beispielserie",
    title: "",
    description: "An example description",
    filmlisteTimestamp: 1700000000,
    duration: 2700,
    size: 1_000_000_000,
    url_website: "https://example.com/video",
    url_video: "https://example.com/video_720.mp4",
    url_video_low: "https://example.com/video_480.mp4",
    url_video_hd: "https://example.com/video_1080.mp4",
  };

  it("keeps episode 0 and does not let later patterns overwrite it", () => {
    const items = generateGenericRssItems({ ...base, title: "Folge 0 (2/6)" }, "best");
    const attrs = items[0].attributes;

    expect(attrs.find((a) => a.name === "episode")).toEqual({ name: "episode", value: "00" });
    expect(attrs.find((a) => a.name === "season")).toEqual({ name: "season", value: "01" });
  });

  it("parses Staffel N Folge N", () => {
    const items = generateGenericRssItems({ ...base, title: "Staffel 2 Folge 3" }, "best");
    const attrs = items[0].attributes;

    expect(attrs.find((a) => a.name === "season")).toEqual({ name: "season", value: "02" });
    expect(attrs.find((a) => a.name === "episode")).toEqual({ name: "episode", value: "03" });
  });

  it("emits only the available quality variant", () => {
    const only720 = { ...base, title: "Some show", url_video_hd: "", url_video_low: "" };
    const items = generateGenericRssItems(only720, "all");

    expect(items).toHaveLength(1);
    expect(items[0].guid.value).toBe("https://example.com/video#720p");
  });
});
