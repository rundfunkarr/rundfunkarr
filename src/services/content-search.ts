import {
  queryMediathekView,
  type MediathekQueryField,
  type MediathekQueryOptions,
} from "@/lib/mediathek-client";
import { getSetting } from "@/lib/settings";
import { srfProvider } from "@/providers/srf";
import type { ApiResultItem } from "@/types";

/** Shared source for UI, Newznab and ruleset discovery, before episode/movie matching. */
export async function queryContent(
  queries: MediathekQueryField[],
  size: number,
  options: MediathekQueryOptions = {}
): Promise<ApiResultItem[] | null> {
  const [mvSetting, orfSetting, hlsSetting] = await Promise.all([
    getSetting("provider.mediathekview.enabled"),
    getSetting("provider.orf.enabled"),
    getSetting("download.enableHLS"),
  ]);
  const mvEnabled = mvSetting !== "false";
  const orfEnabled = orfSetting === "true" && hlsSetting === "true";
  const srfEnabled = await srfProvider.isEnabled();

  try {
    const [indexed, swiss] = await Promise.all([
      mvEnabled || orfEnabled ? queryMediathekView(queries, size, options) : Promise.resolve([]),
      srfEnabled
        ? srfProvider.search({
            query: queries.find((q) => q.fields.includes("topic"))?.query || "",
            limit: Math.min(size, 100),
          })
        : Promise.resolve([]),
    ]);
    // Do not cache incomplete results when an enabled source fails.
    if (indexed === null) return null;
    const items = indexed.filter((item) => (/^ORF\b/i.test(item.channel) ? orfEnabled : mvEnabled));
    for (const item of swiss) {
      const converted: ApiResultItem = {
        channel: item.channel,
        topic: item.topic,
        title: item.title,
        description: item.description,
        filmlisteTimestamp: item.timestamp,
        duration: item.duration,
        size: item.size,
        url_website: item.websiteUrl,
        url_video: item.videoUrls.standard,
        url_video_hd: item.videoUrls.high || "",
        url_video_low: item.videoUrls.low || "",
      };
      if (
        queries.every(({ fields, query }) =>
          fields.some((field) =>
            String(converted[field as keyof ApiResultItem] ?? "")
              .toLowerCase()
              .includes(query.toLowerCase())
          )
        )
      )
        items.push(converted);
    }
    return [...new Map(items.map((item) => [item.url_video, item])).values()]
      .sort((a, b) => b.filmlisteTimestamp - a.filmlisteTimestamp)
      .slice(0, size);
  } catch (error) {
    console.error("[ContentSearch] Provider failed:", error);
    return null;
  }
}
