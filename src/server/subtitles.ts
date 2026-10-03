import { parseStringPromise, processors } from "xml2js";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { getSetting } from "@/lib/settings";
import { parseMediaMetadata } from "@/lib/media-metadata";
import { publishSubtitleSidecar, type SubtitleArtifact } from "./subtitle-artifact";

interface Cue {
  start: number;
  end: number;
  text: string;
}
interface XmlNode {
  $?: Record<string, string>;
  $$?: XmlNode[];
  "#name"?: string;
  _?: string;
}

function seconds(value: string): number {
  const clock = /^(?:(\d+):)?(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(value);
  if (clock)
    return (
      Number(clock[1] || 0) * 3600 +
      Number(clock[2]) * 60 +
      Number(clock[3]) +
      Number(`0.${clock[4] || 0}`)
    );
  const offset = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  if (offset) return Number(offset[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[offset[2]]!;
  throw new Error("Nicht unterstützte Zeitangabe in den Untertiteln.");
}
function timestamp(value: number): string {
  const ms = Math.round(value * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
function xmlText(node: XmlNode): string {
  if (node["#name"] === "br") return "\n";
  if (node.$$) return node.$$.map(xmlText).join("");
  return node._ || "";
}

export async function subtitleToSrt(source: string): Promise<string> {
  const input = source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const cues: Cue[] = [];
  if (input.startsWith("<")) {
    if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new Error("Nicht unterstütztes Untertitel-XML.");
    const parsed = await parseStringPromise(input, {
      explicitChildren: true,
      preserveChildrenOrder: true,
      charsAsChildren: true,
      includeWhiteChars: true,
      tagNameProcessors: [processors.stripPrefix],
    });
    if (!parsed.tt) throw new Error("Kein TTML-Untertiteldokument.");
    const visit = (node: XmlNode, parentStart: number, parentEnd: number) => {
      const start = parentStart + (node.$?.begin ? seconds(node.$.begin) : 0);
      const end = node.$?.end
        ? parentStart + seconds(node.$.end)
        : node.$?.dur
          ? start + seconds(node.$.dur)
          : parentEnd;
      if (node["#name"] === "p") cues.push({ start, end, text: xmlText(node).trim() });
      else for (const child of node.$$ || []) visit(child, start, end);
    };
    visit(parsed.tt, 0, Infinity);
  } else {
    for (const block of input.split(/\n\s*\n/)) {
      if (/^(?:WEBVTT|NOTE|STYLE|REGION)\b/.test(block)) continue;
      const lines = block.split("\n");
      const timing = lines.findIndex((line) => line.includes(" --> "));
      if (timing < 0) continue;
      const match = /^(\S+)\s+-->\s+(\S+)/.exec(lines[timing]);
      if (!match) throw new Error("Ungültige Untertitel-Zeitangabe.");
      const text = lines
        .slice(timing + 1)
        .join("\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
      cues.push({ start: seconds(match[1]), end: seconds(match[2]), text });
    }
  }
  if (!cues.length || cues.some((cue) => !Number.isFinite(cue.end) || cue.end <= cue.start))
    throw new Error("Keine gültigen Untertitel gefunden.");
  return cues
    .map((cue, i) => `${i + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`)
    .join("\n");
}

async function fetchSubtitle(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body)
    throw new Error(`Untertitelabruf fehlgeschlagen (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5 * 1024 * 1024) throw new Error("Die Untertiteldatei ist größer als 5 MiB.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function embed(video: string, subtitle: string, output: string): Promise<void> {
  const { ensureFfmpegExists, getFfmpegPath } = await import("./ffmpeg");
  if (!(await ensureFfmpegExists())) throw new Error("FFmpeg ist nicht verfügbar.");
  const codec = path.extname(video).toLowerCase() === ".mp4" ? "mov_text" : "srt";
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(getFfmpegPath(), [
      "-nostdin",
      "-v",
      "error",
      "-i",
      video,
      "-i",
      subtitle,
      "-map",
      "0",
      "-map",
      "1:0",
      "-c",
      "copy",
      "-c:s",
      codec,
      "-y",
      output,
    ]);
    const timer = setTimeout(
      () => {
        proc.kill("SIGKILL");
      },
      10 * 60 * 1000
    );
    proc.stderr.resume();
    proc.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            "Einbetten der Untertitel fehlgeschlagen; die SRT-Datei bleibt separat erhalten."
          )
        );
    });
  });
}

/** Ein fehlender Untertitel darf einen erfolgreichen Videodownload nicht verwerfen. */
export async function processSubtitles(
  videoPath: string,
  metadataJson?: string | null
): Promise<{ warning: string | null; artifact: SubtitleArtifact | null }> {
  let mode: string | null;
  try {
    mode = await getSetting("download.subtitleMode");
  } catch {
    return { warning: "Untertitel konnten nicht verarbeitet werden.", artifact: null };
  }
  if (mode !== "sidecar" && mode !== "embed") return { warning: null, artifact: null };
  const metadata = parseMediaMetadata(metadataJson);
  if (!metadata.subtitleUrl) return { warning: null, artifact: null };
  const base = videoPath.slice(0, -path.extname(videoPath).length);
  const sidecar = `${base}.srt`;
  let directory: string | undefined;
  let artifact: SubtitleArtifact | null = null;
  try {
    const srt = await subtitleToSrt(await fetchSubtitle(metadata.subtitleUrl));
    directory = await fs.mkdtemp(path.join(path.dirname(videoPath), ".rundfunkarr-subtitles-"));
    const staged = path.join(directory, "subtitle.srt");
    await fs.writeFile(staged, srt, { encoding: "utf8", flag: "wx" });
    if (mode === "embed" && [".mkv", ".mp4"].includes(path.extname(videoPath).toLowerCase())) {
      const temporary = path.join(directory, `video${path.extname(videoPath)}`);
      try {
        await embed(videoPath, staged, temporary);
        await fs.rename(temporary, videoPath);
        return { warning: null, artifact: null };
      } catch (error) {
        artifact = await publishSubtitleSidecar(staged, sidecar);
        throw error;
      }
    }
    artifact = await publishSubtitleSidecar(staged, sidecar);
    return {
      warning:
        mode === "embed"
          ? "Untertitel wurden separat gespeichert; Einbetten ist nur für MKV und MP4 verfügbar."
          : null,
      artifact,
    };
  } catch (error) {
    return {
      warning:
        error instanceof Error
          ? `Untertitel: ${error.message}`
          : "Untertitel konnten nicht verarbeitet werden.",
      artifact,
    };
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
