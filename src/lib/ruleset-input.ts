import { z } from "zod";
import type { Ruleset } from "@/types";

const pattern = z
  .string()
  .max(300)
  .refine((value) => {
    try {
      new RegExp(value);
      return true;
    } catch {
      return false;
    }
  }, "Ungültiger regulärer Ausdruck.");
const field = z.enum([
  "channel",
  "topic",
  "title",
  "description",
  "timestamp",
  "duration",
  "size",
  "url_website",
  "url_video",
  "url_video_low",
  "url_video_hd",
]);
const filters = z
  .array(
    z
      .object({
        attribute: field,
        type: z.enum(["ExactMatch", "Contains", "Regex", "GreaterThan", "LessThan"]),
        value: z.union([z.string().max(500), z.number()]),
      })
      .superRefine((filter, ctx) => {
        if (filter.type === "Regex" && !pattern.safeParse(String(filter.value)).success)
          ctx.addIssue({ code: "custom", message: "Ungültiger Filter-Ausdruck." });
      })
  )
  .max(20);
const titleRules = z
  .array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("static"), value: z.string().max(500) }),
      z.object({ type: z.literal("regex"), field, pattern }),
    ])
  )
  .max(20);

function jsonField<T>(schema: z.ZodType<T>) {
  return z
    .string()
    .max(16000)
    .transform((value, ctx) => {
      try {
        const parsed = schema.safeParse(JSON.parse(value));
        if (parsed.success) return JSON.stringify(parsed.data);
      } catch {
        /* Die Fehlermeldung bleibt unabhängig vom JSON-Inhalt. */
      }
      ctx.addIssue({ code: "custom", message: "Ungültige JSON-Regeln oder reguläre Ausdrücke." });
      return z.NEVER;
    });
}

export const rulesetInput = z.object({
  id: z.string().max(120).optional(),
  topic: z.string().trim().min(1).max(300),
  tvdbId: z.number().int().positive().max(2147483647),
  matchingStrategy: z.enum([
    "SeasonAndEpisodeNumber",
    "ItemTitleIncludes",
    "ItemTitleExact",
    "ItemTitleEqualsAirdate",
  ]),
  filters: jsonField(filters),
  titleRegexRules: jsonField(titleRules),
  episodeRegex: pattern,
  seasonRegex: pattern,
});

export type RulesetInput = z.infer<typeof rulesetInput>;

export function inputToRuleset(input: RulesetInput, showName: string): Ruleset {
  return {
    id: 0,
    mediaId: input.tvdbId,
    priority: 0,
    topic: input.topic,
    matchingStrategy: input.matchingStrategy as Ruleset["matchingStrategy"],
    filters: input.filters,
    titleRegexRules: input.titleRegexRules,
    episodeRegex: input.episodeRegex || null,
    seasonRegex: input.seasonRegex || null,
    media: {
      media_id: input.tvdbId,
      media_tvdbId: input.tvdbId,
      media_name: showName,
      media_type: "show",
      media_tmdbId: null,
      media_imdbId: null,
    },
  };
}
