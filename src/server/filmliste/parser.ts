/**
 * Streaming parser for the MediathekView Filmliste.
 *
 * The list is one large JSON object with repeated keys, so it cannot be read
 * with JSON.parse as a whole:
 *   {"Filmliste":[meta...],"Filmliste":[column names...],"X":[entry],"X":[entry],...}
 * Each entry is a JSON array. An empty channel or topic repeats the value of
 * the previous entry, and the low/HD URLs are stored as "<prefix length>|<suffix>"
 * relative to the standard URL.
 */

export interface FilmlisteEntry {
  channel: string;
  topic: string;
  title: string;
  description: string;
  timestamp: number;
  duration: number;
  size: number;
  url_website: string;
  url_subtitle: string;
  url_video: string;
  url_video_low: string;
  url_video_hd: string;
}

export type FilmlisteRecord =
  { type: "meta"; listTimestamp: number } | { type: "entry"; entry: FilmlisteEntry };

const ENTRY_SEPARATOR = ',"X":';
// Withdrawn from MediathekViewWeb's index; kept out for consistent results.
const BLOCKED_TITLES = new Set(["Wir haben genug - Wirtschaft ohne Wachstum"]);

/** The second meta field is the list creation time in UTC ("12.10.2026, 20:19"). */
export function parseListTimestamp(header: string): number {
  const match = /^\s*\{"Filmliste":(\[.*?\]),"Filmliste":/.exec(header);
  if (!match) throw new Error("Filmliste header is missing");
  const meta: unknown = JSON.parse(match[1]);
  const created = Array.isArray(meta) ? meta[1] : undefined;
  const parts =
    typeof created === "string" ? /^(\d+)\.(\d+)\.(\d+),\s?(\d+):(\d+)$/.exec(created) : null;
  if (!parts) throw new Error("Filmliste creation time is missing");
  const [, day, month, year, hours, minutes] = parts.map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, hours, minutes) / 1000);
}

function expandUrl(base: string, compact: unknown): string {
  if (typeof compact !== "string") return "";
  const separator = compact.indexOf("|");
  if (separator === -1) return "";
  const prefixLength = Number(compact.slice(0, separator));
  return Number.isInteger(prefixLength)
    ? base.slice(0, prefixLength) + compact.slice(separator + 1)
    : "";
}

function parseDuration(value: unknown): number {
  if (typeof value !== "string" || !/^\d+(:\d+)*$/.test(value)) return 0;
  return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Parse Filmliste text chunks. Yields the list timestamp first, then entries.
 * Malformed entries are skipped and counted in `stats.skipped`.
 */
export async function* parseFilmliste(
  chunks: AsyncIterable<string>,
  stats: { skipped: number } = { skipped: 0 }
): AsyncGenerator<FilmlisteRecord> {
  let buffer = "";
  let headerDone = false;
  let channel = "";
  let topic = "";

  const toEntry = (raw: string): FilmlisteEntry | null => {
    let fields: unknown;
    try {
      fields = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!Array.isArray(fields) || fields.length < 17 || typeof fields[8] !== "string") return null;
    channel = text(fields[0]) || channel;
    topic = text(fields[1]) || topic;
    const urlVideo = fields[8];
    if (!urlVideo) return null;
    return {
      channel,
      topic,
      title: text(fields[2]),
      description: text(fields[7]),
      timestamp: Number.parseInt(text(fields[16]), 10) || 0,
      duration: parseDuration(fields[5]),
      size: (Number.parseInt(text(fields[6]), 10) || 0) * 1024 * 1024,
      url_website: text(fields[9]),
      url_subtitle: text(fields[10]),
      url_video: urlVideo,
      url_video_low: expandUrl(urlVideo, fields[12]),
      url_video_hd: expandUrl(urlVideo, fields[14]),
    };
  };

  function* drain(segment: string): Generator<FilmlisteRecord> {
    if (!headerDone) {
      headerDone = true;
      yield { type: "meta", listTimestamp: parseListTimestamp(segment) };
      return;
    }
    const entry = toEntry(segment);
    if (!entry) stats.skipped++;
    else if (!BLOCKED_TITLES.has(entry.title)) yield { type: "entry", entry };
  }

  for await (const chunk of chunks) {
    buffer += chunk;
    let start = 0;
    let separator: number;
    while ((separator = buffer.indexOf(ENTRY_SEPARATOR, start)) !== -1) {
      yield* drain(buffer.slice(start, separator));
      start = separator + ENTRY_SEPARATOR.length;
    }
    buffer = buffer.slice(start);
  }
  const last = buffer.trimEnd();
  if (!headerDone || !last.endsWith("}")) throw new Error("Filmliste ended unexpectedly");
  yield* drain(last.slice(0, -1));
}
