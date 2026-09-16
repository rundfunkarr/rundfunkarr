import { describe, it, expect } from "vitest";
import { generateRegexPatterns } from "./ruleset-generator";
import type { ApiResultItem } from "@/types";

function item(title: string): ApiResultItem {
  return {
    channel: "ORF",
    topic: "Soko Kitzbühel Staffel 17",
    title,
    description: "",
    filmlisteTimestamp: 0,
    duration: 2700,
    size: 0,
    url_website: "",
    url_video: "",
    url_video_low: "",
    url_video_hd: "",
  };
}

describe("generateRegexPatterns - ItemTitleIncludes fallback", () => {
  // Regression test for a real bug: the fallback used to return an empty
  // titleRegexRules ("[]") whenever the title didn't literally start with
  // the topic string, which is common for MediathekView topics with a
  // "Staffel N" suffix (topic "Soko Kitzbühel Staffel 17" vs. title
  // "Soko Kitzbühel (8/15): Schöpfung"). An empty titleRegexRules makes
  // buildTitleFromRegexRules() in services/mediathek.ts always return "",
  // which matchesItemTitleIncludes() then treats as "no title" and rejects
  // unconditionally - so ruleset auto-generation silently produced a
  // ruleset that could never match a single episode.

  it("extracts the text after a colon separator, not anchored to the topic", () => {
    const results = [item("Soko Kitzbühel (8/15): Schöpfung")];
    const { titleRegexRules } = generateRegexPatterns(
      results,
      "ItemTitleIncludes",
      results[0].topic
    );

    expect(titleRegexRules).not.toBe("[]");
    const rules = JSON.parse(titleRegexRules);
    expect(rules).toHaveLength(1);

    const extracted = "Soko Kitzbühel (8/15): Schöpfung".match(rules[0].pattern);
    expect(extracted?.[extracted.length - 1]).toBe("Schöpfung");
  });

  it("extracts the text after a dash separator when there's no colon", () => {
    const results = [item("Landkrimi - Der Tote im Wald")];
    const { titleRegexRules } = generateRegexPatterns(
      results,
      "ItemTitleIncludes",
      results[0].topic
    );

    expect(titleRegexRules).not.toBe("[]");
    const rules = JSON.parse(titleRegexRules);

    const extracted = "Landkrimi - Der Tote im Wald".match(rules[0].pattern);
    expect(extracted?.[extracted.length - 1]).toBe("Der Tote im Wald");
  });

  it("falls back to matching the whole title when there's no separator at all", () => {
    const results = [item("Schöpfung")];
    const { titleRegexRules } = generateRegexPatterns(
      results,
      "ItemTitleIncludes",
      results[0].topic
    );

    expect(titleRegexRules).not.toBe("[]");
    const rules = JSON.parse(titleRegexRules);

    const extracted = "Schöpfung".match(rules[0].pattern);
    expect(extracted?.[extracted.length - 1]).toBe("Schöpfung");
  });

  it("still uses the topic-anchored pattern for ItemTitleExact when the title starts with the topic", () => {
    const topic = "Weltspiegel extra";
    const results = [{ ...item("Weltspiegel extra: Erdbeben in..."), topic }];
    const { titleRegexRules } = generateRegexPatterns(results, "ItemTitleExact", topic);

    const rules = JSON.parse(titleRegexRules);
    expect(rules[0].pattern).toContain(topic);
  });
});
