import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { rememberLogSecret } from "@/lib/logger";
import { access, constants, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
export interface Diagnostic {
  id: string;
  label: string;
  status: "ok" | "warn" | "error" | "info";
  message: string;
}
export async function systemDiagnostics(): Promise<Diagnostic[]> {
  const rows: Diagnostic[] = [];
  try {
    await prisma.$queryRaw`SELECT 1`;
    rows.push({ id: "database", label: "Datenbank", status: "ok", message: "SQLite antwortet." });
  } catch {
    rows.push({
      id: "database",
      label: "Datenbank",
      status: "error",
      message: "Die Datenbank ist nicht erreichbar.",
    });
  }
  const base =
    (await getSetting("download.path")) ||
    process.env.DOWNLOAD_FOLDER_PATH ||
    path.join(process.cwd(), "downloads");
  const temporary = process.env.DOWNLOAD_TEMP_PATH || path.join(base, "incomplete");
  for (const [id, label, folder] of [
    ["downloads", "Download-Verzeichnis", base],
    ["temporary", "Temporäres Verzeichnis", temporary],
  ]) {
    try {
      if (!(await stat(folder)).isDirectory()) throw new Error();
      await access(folder, constants.W_OK | constants.R_OK);
      rows.push({ id, label, status: "ok", message: `Lesbar und beschreibbar: ${folder}` });
    } catch {
      rows.push({
        id,
        label,
        status: "warn",
        message: `Nicht vorhanden oder nicht les- und beschreibbar: ${folder}. Ein noch fehlendes Unterverzeichnis wird beim Download angelegt.`,
      });
    }
  }
  rows.push({
    id: "mapping",
    label: "Pfad für Sonarr/Radarr",
    status: "info",
    message: process.env.DOWNLOAD_FOLDER_PATH_MAPPING
      ? `Gemeldeter Basispfad: ${process.env.DOWNLOAD_FOLDER_PATH_MAPPING}. Die Erreichbarkeit auf dem Sonarr-/Radarr-Host muss dort geprüft werden.`
      : `Gemeldeter Basispfad: ${base}. Sonarr und Radarr benötigen Zugriff auf dieselben Dateien oder eine passende Pfadzuordnung.`,
  });
  await Promise.all(
    (["ffmpeg", "ytdlp"] as const).map(async (id) => {
      const executable =
        id === "ffmpeg"
          ? path.join(
              process.cwd(),
              "ffmpeg",
              process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
            )
          : (await getSetting("download.ytdlpPath"))?.trim() ||
            path.join(
              process.cwd(),
              "ytdlp",
              process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
            );
      try {
        const { stdout } = await run(executable, [id === "ffmpeg" ? "-version" : "--version"], {
          timeout: 5000,
          maxBuffer: 256 * 1024,
        });
        rows.push({
          id,
          label: id === "ffmpeg" ? "FFmpeg" : "yt-dlp",
          status: "ok",
          message: stdout.split("\n")[0].slice(0, 200),
        });
      } catch {
        rows.push({
          id,
          label: id === "ffmpeg" ? "FFmpeg" : "yt-dlp",
          status: "warn",
          message:
            "Am verwendeten Programmpfad nicht ausführbar. Bei nativer Installation erfolgt die Bereitstellung beim ersten benötigten Download.",
        });
      }
    })
  );
  const mv = await getSetting("provider.mediathekview.enabled");
  if (mv === "false")
    rows.push({
      id: "provider",
      label: "MediathekView",
      status: "info",
      message: "In den Einstellungen deaktiviert.",
    });
  else {
    try {
      const response = await fetch("https://mediathekviewweb.de/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: [{ fields: ["topic"], query: "Tagesschau" }],
          size: 1,
          offset: 0,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      if (!response.ok || data.err || !Array.isArray(data.result?.results)) throw new Error();
      rows.push({
        id: "provider",
        label: "MediathekView",
        status: "ok",
        message: "Die Such-API antwortet mit einem gültigen Ergebnis.",
      });
    } catch {
      rows.push({
        id: "provider",
        label: "MediathekView",
        status: "error",
        message: "Die Such-API antwortet nicht gültig. Netzwerk und Erreichbarkeit prüfen.",
      });
    }
  }
  const hls = (await getSetting("download.enableHLS")) === "true";
  rows.push({
    id: "streaming",
    label: "HLS und zusätzliche Quellen",
    status: "info",
    message: hls
      ? "HLS aktiviert. SRF und ORF müssen zusätzlich in der Quellenkonfiguration aktiviert sein."
      : "HLS deaktiviert; Stream-Downloads sind nicht verfügbar.",
  });
  console.info("[Diagnose] Systemprüfung abgeschlossen.");
  return rows;
}
export async function testArrConnection(
  kind: "sonarr" | "radarr",
  address: string,
  apiKey: string
): Promise<Diagnostic> {
  rememberLogSecret(apiKey);
  const url = new URL(address);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Bitte eine HTTP-/HTTPS-Basisadresse ohne Zugangsdaten, Parameter oder Fragment eingeben."
    );
  const label = kind === "sonarr" ? "Sonarr" : "Radarr";
  const endpoint = (name: string) => new URL(`${url.toString().replace(/\/$/, "")}/api/v3/${name}`);
  const options = {
    headers: { "X-Api-Key": apiKey },
    signal: AbortSignal.timeout(8000),
    redirect: "error" as const,
  };
  try {
    const status = await fetch(endpoint("system/status"), options);
    if (!status.ok)
      return {
        id: kind,
        label,
        status: "error",
        message:
          status.status === 401 || status.status === 403
            ? "Zugriff abgelehnt. API-Schlüssel prüfen."
            : `Die Anwendung antwortet mit HTTP ${status.status}. Basisadresse prüfen.`,
      };
    const info = await status.json();
    if (
      typeof info.version !== "string" ||
      !info.appName ||
      String(info.appName).toLowerCase() !== kind
    )
      throw new Error();
    const response = await fetch(endpoint("downloadclient"), {
      ...options,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      return {
        id: kind,
        label,
        status: "warn",
        message: "Verbindung erfolgreich; Download-Clients konnten nicht geprüft werden.",
      };
    const clients = await response.json();
    if (!Array.isArray(clients)) throw new Error();
    const count = clients.filter(
      (c: { enable?: boolean; implementation?: string }) =>
        c.enable && c.implementation?.toLowerCase() === "sabnzbd"
    ).length;
    return {
      id: kind,
      label,
      status: count ? "ok" : "warn",
      message: count
        ? `Verbindung erfolgreich. ${count} aktivierte SABnzbd-Clients vorhanden. In ${label} Host, Port, Kategorie und Dateizugriff für RundfunkArr prüfen.`
        : `Verbindung erfolgreich, aber kein aktivierter SABnzbd-Download-Client gefunden.`,
    };
  } catch {
    return {
      id: kind,
      label,
      status: "error",
      message:
        "Verbindung fehlgeschlagen, Zeitüberschreitung oder unerwartete Antwort. Basisadresse, Netzwerk und Zertifikat prüfen.",
    };
  }
}
