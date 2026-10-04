import { getVideoInfo } from "@/server/ytdlp";
import { getSetting } from "@/lib/settings";
import { isHlsUrl, isMediathekWebsite, withStreamQuality } from "@/lib/stream-url";
import { safeTitle, type Quality } from "./advanced-search";
import { addToQueue } from "./download";

export class ManualDownloadError extends Error {}

export async function manualDownload(value: string, quality: Quality) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new ManualDownloadError(
      "Bitte eine HTTP- oder HTTPS-Adresse ohne Zugangsdaten eingeben."
    );
  const direct = /\.mp4$/i.test(url.pathname);
  const streaming = isHlsUrl(value);
  const webpage = isMediathekWebsite(value);
  if (!direct && !streaming && !webpage)
    throw new ManualDownloadError(
      "Bitte einen MP4-/M3U8-Link oder eine Sendungsseite von ARD, ZDF, Arte, 3sat, ORF oder SRF eingeben."
    );
  if (!direct && (await getSetting("download.enableHLS")) !== "true")
    throw new ManualDownloadError(
      "Für Streams und Sendungsseiten bitte zuerst HLS-Streams in den Einstellungen aktivieren."
    );
  let title: string;
  let source = value;
  if (webpage && !direct && !streaming) {
    const info = await getVideoInfo(value);
    if (!info?.title)
      throw new ManualDownloadError(
        "Diese Sendungsseite konnte nicht aufgelöst werden. Verfügbarkeit und Adresse prüfen."
      );
    title = info.title;
    url.hash = "rundfunkarr-page=1";
    source = withStreamQuality(url.toString(), quality);
  } else {
    try {
      title = decodeURIComponent(url.pathname.split("/").pop() || "Mediathek-Download").replace(
        /\.(mp4|m3u8)$/i,
        ""
      );
    } catch {
      title = "Mediathek-Download";
    }
    if (streaming) source = withStreamQuality(value, quality);
  }
  return { ...(await addToQueue(source, safeTitle(title), "default")), title };
}
