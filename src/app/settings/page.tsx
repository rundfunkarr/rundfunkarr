"use client";

import { useState } from "react";
import { useSettings } from "@/contexts/settings-context";
import { buildTvdbLoginPayload } from "@/lib/tvdb-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Settings,
  Key,
  Sliders,
  Database,
  Info,
  Check,
  X,
  Loader2,
  Save,
  RefreshCw,
  Trash2,
} from "lucide-react";
import packageJson from "../../../package.json";

// Helper functions
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

export default function SettingsPage() {
  const { settings, isLoading, updateSettings } = useSettings();
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearResult, setClearResult] = useState<{
    show: boolean;
    success: boolean;
    message: string;
  }>({
    show: false,
    success: false,
    message: "",
  });
  const [validatingApi, setValidatingApi] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<Record<string, boolean | null>>({});
  const [systemInfo, setSystemInfo] = useState<{
    version: { node: string; ffmpeg: string | null };
    database: { sizeBytes: number; shows: number; episodes: number; configEntries: number };
    downloads: { completed: number; inQueue: number; failed: number };
    uptime: number;
  } | null>(null);

  // Fetch system info when System tab is viewed
  const fetchSystemInfo = async () => {
    try {
      const res = await fetch("/api/system");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setSystemInfo(data);
    } catch (error) {
      console.error("Failed to fetch system info:", error);
    }
  };

  // Local form state
  const [formState, setFormState] = useState<Record<string, string>>({});

  const getFieldValue = (key: string) => {
    return formState[key] ?? settings?.[key] ?? "";
  };

  const setFieldValue = (key: string, value: string) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (keys: string[]) => {
    setIsSaving(true);
    try {
      const updates: Record<string, string> = {};
      for (const key of keys) {
        if (formState[key] !== undefined) {
          updates[key] = formState[key];
        }
      }
      if (Object.keys(updates).length > 0) {
        await updateSettings(updates);
        setFormState({});
      }
    } finally {
      setIsSaving(false);
    }
  };

  const validateTvdbApi = async () => {
    setValidatingApi("tvdb");
    try {
      const key = getFieldValue("api.tvdb.key");
      const pin = getFieldValue("api.tvdb.pin");
      const payload = buildTvdbLoginPayload(key, pin);
      if (!payload) {
        setApiStatus((prev) => ({ ...prev, tvdb: false }));
        return;
      }
      // Attempt to login to TVDB
      const res = await fetch("https://api4.thetvdb.com/v4/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setApiStatus((prev) => ({ ...prev, tvdb: res.ok }));
    } catch {
      setApiStatus((prev) => ({ ...prev, tvdb: false }));
    } finally {
      setValidatingApi(null);
    }
  };

  const validateTmdbApi = async () => {
    setValidatingApi("tmdb");
    try {
      const key = getFieldValue("api.tmdb.key");
      if (!key) {
        setApiStatus((prev) => ({ ...prev, tmdb: false }));
        return;
      }
      const res = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${key}`);
      setApiStatus((prev) => ({ ...prev, tmdb: res.ok }));
    } catch {
      setApiStatus((prev) => ({ ...prev, tmdb: false }));
    } finally {
      setValidatingApi(null);
    }
  };

  const handleClearCache = async () => {
    setShowClearConfirm(false);
    setIsClearing(true);
    try {
      const res = await fetch("/api/cache", { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();

      if (data.success) {
        setClearResult({
          show: true,
          success: true,
          message: `${data.cleared.tvdbSeries} Serien und ${data.cleared.tvdbEpisodes} Episoden gelöscht.`,
        });
      } else {
        setClearResult({
          show: true,
          success: false,
          message: "Fehler beim Leeren des Caches.",
        });
      }
    } catch (error) {
      console.error("Failed to clear cache:", error);
      setClearResult({
        show: true,
        success: false,
        message: "Fehler beim Leeren des Caches.",
      });
    } finally {
      setIsClearing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 lg:p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm">Konfiguriere RundfunkArr</p>
      </div>

      {/* Tabs */}
      <Card>
        <CardContent className="p-6">
          <Tabs
            defaultValue="general"
            onValueChange={(value) => value === "system" && fetchSystemInfo()}
          >
            <TabsList className="grid w-full grid-cols-5 mb-6">
              <TabsTrigger value="general" className="flex items-center gap-2">
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Allgemein</span>
              </TabsTrigger>
              <TabsTrigger value="api" className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                <span className="hidden sm:inline">API-Keys</span>
              </TabsTrigger>
              <TabsTrigger value="matching" className="flex items-center gap-2">
                <Sliders className="w-4 h-4" />
                <span className="hidden sm:inline">Matching</span>
              </TabsTrigger>
              <TabsTrigger value="cache" className="flex items-center gap-2">
                <Database className="w-4 h-4" />
                <span className="hidden sm:inline">Cache</span>
              </TabsTrigger>
              <TabsTrigger value="system" className="flex items-center gap-2">
                <Info className="w-4 h-4" />
                <span className="hidden sm:inline">System</span>
              </TabsTrigger>
            </TabsList>

            {/* General Tab */}
            <TabsContent value="general" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Allgemeine Einstellungen</CardTitle>
                  <CardDescription>Download-Pfad und Qualitätspräferenzen</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Download-Pfad</label>
                    <Input
                      value={getFieldValue("download.path")}
                      onChange={(e) => setFieldValue("download.path", e.target.value)}
                      placeholder="/downloads"
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Verzeichnis für heruntergeladene Dateien
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Bevorzugte Qualität</label>
                    <select
                      value={getFieldValue("download.quality")}
                      onChange={(e) => setFieldValue("download.quality", e.target.value)}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="all">Alle Qualitäten</option>
                      <option value="best">Nur beste verfügbare</option>
                      <option value="1080p">Nur 1080p (Full HD)</option>
                      <option value="720p">Nur 720p (HD)</option>
                      <option value="480p">Nur 480p (SD)</option>
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Welche Qualitäten sollen im Newznab-Feed angezeigt werden?
                    </p>
                  </div>
                  <label className="flex items-center justify-between gap-4 rounded-md border border-input p-3">
                    <span>
                      <span className="block text-sm font-medium">MP4 in MKV konvertieren</span>
                      <span className="block text-xs text-muted-foreground mt-1">
                        Deaktivieren, wenn ein externes Tool wie Tdarr die Medienverarbeitung
                        übernimmt. Heruntergeladene MP4-Dateien bleiben dann unverändert.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={getFieldValue("download.convertToMkv") !== "false"}
                      onChange={(e) =>
                        setFieldValue("download.convertToMkv", String(e.target.checked))
                      }
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                  </label>

                  <Button
                    onClick={() =>
                      handleSave(["download.path", "download.quality", "download.convertToMkv"])
                    }
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Speichern
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* API Keys Tab */}
            <TabsContent value="api" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>TVDB API</CardTitle>
                  <CardDescription>
                    TheTVDB.com API-Zugangsdaten für Show-Metadaten. Project API Keys funktionieren
                    ohne PIN; Subscriber-Keys können weiterhin eine PIN verwenden.{" "}
                    <a
                      href="https://thetvdb.com/api-information"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      API-Key beantragen
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">API Key</label>
                    <Input
                      value={getFieldValue("api.tvdb.key")}
                      onChange={(e) => setFieldValue("api.tvdb.key", e.target.value)}
                      placeholder="TVDB API Key"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">PIN (optional)</label>
                    <Input
                      value={getFieldValue("api.tvdb.pin")}
                      onChange={(e) => setFieldValue("api.tvdb.pin", e.target.value)}
                      placeholder="TVDB PIN (optional)"
                      className="mt-1"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={validateTvdbApi}
                      disabled={validatingApi === "tvdb"}
                    >
                      {validatingApi === "tvdb" ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4 mr-2" />
                      )}
                      Testen
                    </Button>
                    {apiStatus.tvdb !== undefined && (
                      <Badge variant={apiStatus.tvdb ? "default" : "destructive"}>
                        {apiStatus.tvdb ? (
                          <Check className="w-3 h-3 mr-1" />
                        ) : (
                          <X className="w-3 h-3 mr-1" />
                        )}
                        {apiStatus.tvdb ? "Verbunden" : "Fehler"}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>TMDB API</CardTitle>
                  <CardDescription>
                    TheMovieDB.org API für Film-Metadaten.{" "}
                    <a
                      href="https://www.themoviedb.org/settings/api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      API-Key beantragen
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">API Key</label>
                    <Input
                      value={getFieldValue("api.tmdb.key")}
                      onChange={(e) => setFieldValue("api.tmdb.key", e.target.value)}
                      placeholder="TMDB API Key"
                      className="mt-1"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={validateTmdbApi}
                      disabled={validatingApi === "tmdb"}
                    >
                      {validatingApi === "tmdb" ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4 mr-2" />
                      )}
                      Testen
                    </Button>
                    {apiStatus.tmdb !== undefined && (
                      <Badge variant={apiStatus.tmdb ? "default" : "destructive"}>
                        {apiStatus.tmdb ? (
                          <Check className="w-3 h-3 mr-1" />
                        ) : (
                          <X className="w-3 h-3 mr-1" />
                        )}
                        {apiStatus.tmdb ? "Verbunden" : "Fehler"}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Button
                onClick={() => handleSave(["api.tvdb.key", "api.tvdb.pin", "api.tmdb.key"])}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                API-Keys speichern
              </Button>
            </TabsContent>

            {/* Matching Tab */}
            <TabsContent value="matching" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Matching-Einstellungen</CardTitle>
                  <CardDescription>Konfiguriere wie Shows abgeglichen werden</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Matching-Strategie</label>
                    <select
                      value={getFieldValue("matching.strategy")}
                      onChange={(e) => setFieldValue("matching.strategy", e.target.value)}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="fuzzy">Fuzzy (flexibel)</option>
                      <option value="strict">Strict (exakt)</option>
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Fuzzy: Erlaubt ähnliche Titel-Matches. Strict: Nur exakte Übereinstimmungen.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Schwellwert</label>
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={getFieldValue("matching.threshold")}
                      onChange={(e) => setFieldValue("matching.threshold", e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      0.0 = sehr locker, 1.0 = exakte Übereinstimmung
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Mindestdauer (Sekunden)</label>
                    <Input
                      type="number"
                      value={getFieldValue("matching.minDuration")}
                      onChange={(e) => setFieldValue("matching.minDuration", e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Ignoriere Videos kürzer als diese Dauer
                    </p>
                  </div>
                  <Button
                    onClick={() =>
                      handleSave([
                        "matching.strategy",
                        "matching.threshold",
                        "matching.minDuration",
                      ])
                    }
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Speichern
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Cache Tab */}
            <TabsContent value="cache" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Cache-Einstellungen</CardTitle>
                  <CardDescription>
                    Der Cache speichert Daten temporär, um wiederholte Anfragen zu beschleunigen.
                    Die TTL (Time-to-Live) bestimmt, wie lange Daten im Cache bleiben bevor sie neu
                    geladen werden.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Such-Cache (Sekunden)</label>
                    <Input
                      type="number"
                      value={getFieldValue("cache.ttl.search")}
                      onChange={(e) => setFieldValue("cache.ttl.search", e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Wie lange Suchergebnisse von der Mediathek zwischengespeichert werden.
                      Standard: 3600 (1 Stunde). Niedrigere Werte = aktuellere Ergebnisse, mehr
                      API-Anfragen.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Metadaten-Cache (Sekunden)</label>
                    <Input
                      type="number"
                      value={getFieldValue("cache.ttl.metadata")}
                      onChange={(e) => setFieldValue("cache.ttl.metadata", e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Wie lange Show-Informationen (Episodenlisten, Titel) gespeichert werden.
                      Standard: 86400 (24 Stunden). Diese Daten ändern sich selten.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleSave(["cache.ttl.search", "cache.ttl.metadata"])}
                      disabled={isSaving}
                    >
                      {isSaving ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      Speichern
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowClearConfirm(true)}
                      disabled={isClearing}
                    >
                      {isClearing ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4 mr-2" />
                      )}
                      {isClearing ? "Wird geleert..." : "Cache leeren"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tipp: &quot;Cache leeren&quot; erzwingt das Neuladen aller Daten bei der
                    nächsten Anfrage.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* System Tab */}
            <TabsContent value="system" className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>System-Informationen</CardTitle>
                  <Button variant="ghost" size="sm" onClick={fetchSystemInfo}>
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Version Info */}
                  <div>
                    <h4 className="text-sm font-medium mb-3">Versionen</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">RundfunkArr</p>
                        <p className="font-medium">{packageJson.version}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Node.js</p>
                        <p className="font-medium">{systemInfo?.version.node || "..."}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">FFmpeg</p>
                        <p className="font-medium">
                          {systemInfo?.version.ffmpeg ? (
                            <span className="text-green-500">{systemInfo.version.ffmpeg}</span>
                          ) : systemInfo ? (
                            <span className="text-red-500">Nicht gefunden</span>
                          ) : (
                            "..."
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Uptime</p>
                        <p className="font-medium">
                          {systemInfo ? formatUptime(systemInfo.uptime) : "..."}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Database Stats */}
                  <div>
                    <h4 className="text-sm font-medium mb-3">Datenbank</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Größe</p>
                        <p className="font-medium">
                          {systemInfo ? formatBytes(systemInfo.database.sizeBytes) : "..."}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Gecachte Shows</p>
                        <p className="font-medium">{systemInfo?.database.shows ?? "..."}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Gecachte Episoden</p>
                        <p className="font-medium">{systemInfo?.database.episodes ?? "..."}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Einstellungen</p>
                        <p className="font-medium">{systemInfo?.database.configEntries ?? "..."}</p>
                      </div>
                    </div>
                  </div>

                  {/* Downloads Stats */}
                  <div>
                    <h4 className="text-sm font-medium mb-3">Downloads</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Abgeschlossen</p>
                        <p className="font-medium text-green-500">
                          {systemInfo?.downloads.completed ?? "..."}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">In Warteschlange</p>
                        <p className="font-medium text-blue-500">
                          {systemInfo?.downloads.inQueue ?? "..."}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Fehlgeschlagen</p>
                        <p className="font-medium text-red-500">
                          {systemInfo?.downloads.failed ?? "..."}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Clear Cache Confirmation Dialog */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cache leeren?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle gecachten Daten werden gelöscht und bei der nächsten Anfrage neu geladen. Dies
              betrifft Mediathek-Suchergebnisse und TVDB-Metadaten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearCache}>Cache leeren</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear Cache Result Dialog */}
      <AlertDialog
        open={clearResult.show}
        onOpenChange={(open) => setClearResult({ ...clearResult, show: open })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{clearResult.success ? "Cache geleert" : "Fehler"}</AlertDialogTitle>
            <AlertDialogDescription>{clearResult.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
