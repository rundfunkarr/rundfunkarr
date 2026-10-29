import { z } from "zod";

const MAX_CHANNEL_LENGTH = 100;

export const mediaMetadataSchema = z
  .object({
    subtitleUrl: z
      .string()
      .url()
      .max(4096)
      .refine((url) => /^https?:\/\//i.test(url))
      .optional(),
    audioLanguage: z
      .string()
      .regex(/^[a-z]{3}$/)
      .optional(),
    /** Broadcaster, e.g. "ARD" or "ZDF"; only used for display in notifications. */
    channel: z
      .string()
      .min(1)
      .max(MAX_CHANNEL_LENGTH)
      .regex(/^[^\x00-\x1f\x7f]+$/)
      .optional(),
  })
  .strict();
export type MediaMetadata = z.infer<typeof mediaMetadataSchema>;

/** Cleans a broadcaster name so it always passes the schema; invalid metadata is dropped as a whole. */
function channelName(channel: string | undefined): string {
  return (channel ?? "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, MAX_CHANNEL_LENGTH)
    .trim();
}

export function mediaMetadata(item: {
  url_subtitle?: string;
  audioLanguage?: string;
  channel?: string;
}): MediaMetadata {
  const channel = channelName(item.channel);
  const parsed = mediaMetadataSchema.safeParse({
    ...(item.url_subtitle ? { subtitleUrl: item.url_subtitle } : {}),
    ...(item.audioLanguage ? { audioLanguage: item.audioLanguage } : {}),
    ...(channel ? { channel } : {}),
  });
  return parsed.success ? parsed.data : {};
}

export function parseMediaMetadata(json: string | null | undefined): MediaMetadata {
  try {
    return mediaMetadataSchema.parse(JSON.parse(json || "{}"));
  } catch {
    return {};
  }
}

export type AudioVariant = "all" | "standard" | "original" | "description";
export function audioVariant(title: string): Exclude<AudioVariant, "all"> {
  if (/Audiodeskription|Hörfassung|\(AD\)/i.test(title)) return "description";
  if (/Originalfassung|Originalversion|Originalton|\b(?:OV|OmU)\b/i.test(title)) return "original";
  return "standard";
}

export function matchesAudioVariant(title: string, preference: string | null): boolean {
  return (
    !["standard", "original", "description"].includes(preference || "") ||
    audioVariant(title) === preference
  );
}

/** Language part of a release name. AD marks audio description, which otherwise looks identical. */
export function releaseAudioTag(title: string): string {
  const variant = audioVariant(title);
  if (variant === "original") return "ORIGINAL";
  return variant === "description" ? "GERMAN.AD" : "GERMAN";
}

export function mediaMetadataComment(item: {
  url_subtitle?: string;
  audioLanguage?: string;
  channel?: string;
}): string {
  const text = `rundfunkarr-media:${JSON.stringify(mediaMetadata(item))}`;
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}
