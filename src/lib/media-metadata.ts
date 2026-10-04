import { z } from "zod";

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
  })
  .strict();
export type MediaMetadata = z.infer<typeof mediaMetadataSchema>;

export function mediaMetadata(item: {
  url_subtitle?: string;
  audioLanguage?: string;
}): MediaMetadata {
  const parsed = mediaMetadataSchema.safeParse({
    ...(item.url_subtitle ? { subtitleUrl: item.url_subtitle } : {}),
    ...(item.audioLanguage ? { audioLanguage: item.audioLanguage } : {}),
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

export function releaseLanguage(title: string): string {
  return audioVariant(title) === "original" ? "ORIGINAL" : "GERMAN";
}

export function mediaMetadataComment(item: {
  url_subtitle?: string;
  audioLanguage?: string;
}): string {
  const text = `rundfunkarr-media:${JSON.stringify(mediaMetadata(item))}`;
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}
