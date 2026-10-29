"use client";

import { useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { appVersion } from "@/lib/app-version";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="tabular mt-1 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

export interface SystemInfo {
  version: { node: string; ffmpeg: string | null; ytdlp: string | null };
  database: { sizeBytes: number; shows: number; episodes: number; configEntries: number };
  downloads: { completed: number; inQueue: number; failed: number };
  uptime: number;
}

/**
 * Loads the system info on demand. The page owns it so the last values stay visible
 * while the System tab is reopened and refreshed.
 */
export function useSystemInfo() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  const fetchSystemInfo = async () => {
    try {
      const res = await fetch("/api/system");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setSystemInfo(data);
    } catch (error) {
      // eslint-disable-next-line no-console -- client component, logs to the browser console
      console.error("Failed to fetch system info:", error);
    }
  };

  return { systemInfo, fetchSystemInfo };
}

export function SystemSettings({
  systemInfo,
  onRefresh,
}: {
  systemInfo: SystemInfo | null;
  onRefresh: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>System</CardTitle>
          <CardDescription>Versionen, Datenbank und Download-Statistik</CardDescription>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onRefresh} aria-label="Aktualisieren">
          <RefreshCw />
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <section>
          <h4 className="mb-3 text-sm font-medium">Versionen</h4>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <Stat label="RundfunkArr">{appVersion}</Stat>
            <Stat label="Node.js">{systemInfo?.version.node || "…"}</Stat>
            <Stat label="FFmpeg">
              {systemInfo?.version.ffmpeg ? (
                <Badge variant="ok">{systemInfo.version.ffmpeg}</Badge>
              ) : systemInfo ? (
                <Badge variant="danger">Nicht gefunden</Badge>
              ) : (
                "…"
              )}
            </Stat>
            <Stat label="yt-dlp">
              {systemInfo?.version.ytdlp ? (
                <Badge variant="ok">{systemInfo.version.ytdlp}</Badge>
              ) : systemInfo ? (
                <Badge variant="danger">Nicht gefunden</Badge>
              ) : (
                "…"
              )}
            </Stat>
            <Stat label="Laufzeit">{systemInfo ? formatUptime(systemInfo.uptime) : "…"}</Stat>
          </dl>
        </section>

        <section>
          <h4 className="mb-3 text-sm font-medium">Datenbank</h4>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Größe">
              {systemInfo ? formatBytes(systemInfo.database.sizeBytes) : "…"}
            </Stat>
            <Stat label="Serien im Cache">{systemInfo?.database.shows ?? "…"}</Stat>
            <Stat label="Episoden im Cache">{systemInfo?.database.episodes ?? "…"}</Stat>
            <Stat label="Einstellungen">{systemInfo?.database.configEntries ?? "…"}</Stat>
          </dl>
        </section>

        <section>
          <h4 className="mb-3 text-sm font-medium">Downloads</h4>
          <dl className="grid grid-cols-3 gap-4">
            <Stat label="Abgeschlossen">{systemInfo?.downloads.completed ?? "…"}</Stat>
            <Stat label="In Warteschlange">{systemInfo?.downloads.inQueue ?? "…"}</Stat>
            <Stat label="Fehlgeschlagen">{systemInfo?.downloads.failed ?? "…"}</Stat>
          </dl>
        </section>
      </CardContent>
    </Card>
  );
}
