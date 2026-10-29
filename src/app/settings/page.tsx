"use client";

import { useState } from "react";
import { SecuritySettings } from "@/components/auth/security-settings";
import { FilmlisteIndexSettings } from "@/components/settings/filmliste-index-settings";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { PostProcessSettings } from "@/components/settings/post-process-settings";
import { useSettings } from "@/contexts/settings-context";
import { appVersion } from "@/lib/app-version";
import { validateApiCredentials } from "@/lib/validate-api-credentials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Page, PageHeader } from "@/components/shared/page";
import { Field, ToggleRow } from "@/components/shared/field";
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
  Palette,
  Bell,
  Check,
  X,
  Loader2,
  Save,
  RefreshCw,
  Trash2,
} from "lucide-react";

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

function SaveButton({
  saving,
  onClick,
  children = "Speichern",
}: {
  saving: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Button onClick={onClick} disabled={saving}>
      {saving ? <Loader2 className="animate-spin" /> : <Save />}
      {children}
    </Button>
  );
}

function ApiStatus({ status }: { status: boolean | null | undefined }) {
  if (status === undefined || status === null) return null;
  return status ? (
    <Badge variant="ok">
      <Check />
      Verbunden
    </Badge>
  ) : (
    <Badge variant="danger">
      <X />
      Fehler
    </Badge>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="tabular mt-1 truncate text-sm font-medium">{children}</dd>
    </div>
  );
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
    version: { node: string; ffmpeg: string | null; ytdlp: string | null };
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
      // eslint-disable-next-line no-console -- client component, logs to the browser console
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
      const valid = await validateApiCredentials("tvdb", key, pin);
      setApiStatus((prev) => ({ ...prev, tvdb: valid }));
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
      const valid = await validateApiCredentials("tmdb", key);
      setApiStatus((prev) => ({ ...prev, tmdb: valid }));
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
      // eslint-disable-next-line no-console -- client component, logs to the browser console
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
      <div className="flex items-center justify-center p-4 md:p-6 lg:p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Page width="narrow">
      <PageHeader
        title="Einstellungen"
        description="Pfade, Quellen, Schlüssel und Abgleich von RundfunkArr konfigurieren."
      />

      <Tabs
        defaultValue="general"
        onValueChange={(value) => value === "system" && fetchSystemInfo()}
      >
        <TabsList>
          <TabsTrigger value="general">
            <Settings />
            Allgemein
          </TabsTrigger>
          <TabsTrigger value="display">
            <Palette />
            Darstellung
          </TabsTrigger>
          <TabsTrigger value="api">
            <Key />
            API-Keys
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell />
            Benachrichtigungen
          </TabsTrigger>
          <TabsTrigger value="matching">
            <Sliders />
            Matching
          </TabsTrigger>
          <TabsTrigger value="cache">
            <Database />
            Cache
          </TabsTrigger>
          <TabsTrigger value="system">
            <Info />
            System
          </TabsTrigger>
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general" className="space-y-4">
          <SecuritySettings />
          <Card>
            <CardHeader>
              <CardTitle>Downloads</CardTitle>
              <CardDescription>Zielordner, Qualität, Untertitel und Fassungen</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Download-Pfad" hint="Verzeichnis für heruntergeladene Dateien.">
                {(id) => (
                  <Input
                    id={id}
                    value={getFieldValue("download.path")}
                    onChange={(e) => setFieldValue("download.path", e.target.value)}
                    placeholder="/downloads"
                    className="font-mono text-xs md:text-xs"
                  />
                )}
              </Field>
              <Field
                label="Bevorzugte Qualität"
                hint="Welche Qualitäten im Newznab-Feed angeboten werden."
              >
                {(id) => (
                  <Select
                    id={id}
                    value={getFieldValue("download.quality")}
                    onChange={(e) => setFieldValue("download.quality", e.target.value)}
                  >
                    <option value="all">Alle Qualitäten</option>
                    <option value="best">Nur beste verfügbare</option>
                    <option value="1080p">Nur 1080p (Full HD)</option>
                    <option value="720p">Nur 720p (HD)</option>
                    <option value="480p">Nur 480p (SD)</option>
                  </Select>
                )}
              </Field>
              <Field
                label="Untertitel"
                htmlFor="subtitle-mode"
                hint="Nutzt die von der Mediathek bereitgestellten Untertitel. SRT, WebVTT und TTML werden unterstützt. Wenn Einbetten scheitert, bleibt die SRT-Datei erhalten und die Historie zeigt den Hinweis."
              >
                <Select
                  id="subtitle-mode"
                  value={getFieldValue("download.subtitleMode") || "off"}
                  onChange={(e) => setFieldValue("download.subtitleMode", e.target.value)}
                >
                  <option value="off">Nicht herunterladen</option>
                  <option value="sidecar">Als SRT-Datei daneben speichern</option>
                  <option value="embed">In MKV oder MP4 einbetten</option>
                </Select>
              </Field>
              <Field
                label="Fassungen in Suche und Feed"
                htmlFor="audio-variant"
                hint="Erkennt Fassungen anhand der Titelangaben. Die tatsächliche Audiosprache wird dabei nicht ermittelt. Vorhandene Sprachangaben bleiben beim Konvertieren erhalten. Im Release-Titel stehen Originalfassungen als ORIGINAL und Audiodeskriptionen als GERMAN.AD."
              >
                <Select
                  id="audio-variant"
                  value={getFieldValue("matching.audioVariant") || "all"}
                  onChange={(e) => setFieldValue("matching.audioVariant", e.target.value)}
                >
                  <option value="all">Alle Fassungen</option>
                  <option value="standard">Standardfassung</option>
                  <option value="original">Originalfassung / OmU</option>
                  <option value="description">Audiodeskription / Hörfassung</option>
                </Select>
              </Field>
              <ToggleRow
                label="MP4 in MKV konvertieren"
                hint="Deaktivieren, wenn ein externes Tool wie Tdarr die Medienverarbeitung übernimmt. Heruntergeladene MP4-Dateien bleiben dann unverändert."
                control={
                  <Switch
                    checked={getFieldValue("download.convertToMkv") !== "false"}
                    onChange={(e) =>
                      setFieldValue("download.convertToMkv", String(e.target.checked))
                    }
                  />
                }
              />
              <SaveButton
                saving={isSaving}
                onClick={() =>
                  handleSave([
                    "download.path",
                    "download.quality",
                    "download.convertToMkv",
                    "download.subtitleMode",
                    "matching.audioVariant",
                  ])
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Streaming</CardTitle>
              <CardDescription>HLS-Streams, ORF-Suche, yt-dlp und Proxy</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                label="HLS-Streams aktivieren"
                hint="Ermöglicht das Herunterladen von HLS-Streams, zum Beispiel von SRF und ORF."
                control={
                  <Switch
                    checked={getFieldValue("download.enableHLS") === "true"}
                    onChange={(e) => setFieldValue("download.enableHLS", String(e.target.checked))}
                  />
                }
              />
              <ToggleRow
                label="ORF-Suche aktivieren"
                hint="Bezieht ORF-Treffer aus MediathekView ein. Benötigt HLS. Viele ORF-Sendungen sind nur in Österreich abrufbar."
                control={
                  <Switch
                    checked={getFieldValue("provider.orf.enabled") === "true"}
                    onChange={(e) =>
                      setFieldValue("provider.orf.enabled", String(e.target.checked))
                    }
                  />
                }
              />
              <Field
                label="yt-dlp-Pfad (optional)"
                hint="Pfad zur yt-dlp-Binary. Leer lassen für den geprüften automatischen Download."
              >
                {(id) => (
                  <Input
                    id={id}
                    value={getFieldValue("download.ytdlpPath")}
                    onChange={(e) => setFieldValue("download.ytdlpPath", e.target.value)}
                    placeholder="Leer = automatischer Download"
                    className="font-mono text-xs md:text-xs"
                  />
                )}
              </Field>
              <Field
                label="Proxy-URL (optional)"
                hint="Optionaler Proxy für yt-dlp und Downloads. Unterstützt HTTP, HTTPS, SOCKS4 und SOCKS5."
              >
                {(id) => (
                  <Input
                    id={id}
                    value={getFieldValue("download.proxyUrl")}
                    onChange={(e) => setFieldValue("download.proxyUrl", e.target.value)}
                    placeholder="socks5://localhost:1080"
                    className="font-mono text-xs md:text-xs"
                  />
                )}
              </Field>
              <SaveButton
                saving={isSaving}
                onClick={() =>
                  handleSave([
                    "download.enableHLS",
                    "download.ytdlpPath",
                    "download.proxyUrl",
                    "provider.orf.enabled",
                  ])
                }
              />
            </CardContent>
          </Card>

          <PostProcessSettings />

          <FilmlisteIndexSettings />
        </TabsContent>

        {/* Display Tab */}
        <TabsContent value="display" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Farbschema</CardTitle>
              <CardDescription>
                Gilt nur für diesen Browser und wird sofort übernommen. „System“ folgt der hellen
                oder dunklen Einstellung des Geräts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ThemeToggle showLabels />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bilder</CardTitle>
              <CardDescription>Gilt für alle Browser, die diese Instanz verwenden.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                label="Vorschaubilder in Suche, Filmen und Suchabos"
                hint="RundfunkArr ruft die Sendungsseite des Senders einmal ab, merkt sich die Bildadresse und zeigt das Bild direkt aus dem Netz des Senders. SRF liefert Bilder über seine API. Ausgeschaltet ruft RundfunkArr keine Sendungsseiten ab, und die Trefferlisten bleiben reine Textlisten."
                control={
                  <Switch
                    checked={getFieldValue("search.thumbnails") !== "false"}
                    onChange={(e) => setFieldValue("search.thumbnails", String(e.target.checked))}
                  />
                }
              />
              <ToggleRow
                label="Serienposter in Serien und Rulesets"
                hint="Poster aus TVDB, die beim Abgleich mit Sonarr ohnehin mitgeladen werden. Der Browser lädt sie vom Bildserver von TVDB."
                control={
                  <Switch
                    checked={getFieldValue("ui.posters") !== "false"}
                    onChange={(e) => setFieldValue("ui.posters", String(e.target.checked))}
                  />
                }
              />
              <SaveButton
                saving={isSaving}
                onClick={() => handleSave(["search.thumbnails", "ui.posters"])}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Keys Tab */}
        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>TVDB API</CardTitle>
              <CardDescription>
                TheTVDB.com API-Zugangsdaten für Serien-Metadaten. Project API Keys funktionieren
                ohne PIN; Subscriber-Keys können weiterhin eine PIN verwenden.{" "}
                <a
                  href="https://thetvdb.com/api-information"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  API-Key beantragen
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="API Key">
                {(id) => (
                  <Input
                    id={id}
                    value={getFieldValue("api.tvdb.key")}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setFieldValue("api.tvdb.key", e.target.value)}
                    placeholder="TVDB API Key"
                    className="font-mono text-xs md:text-xs"
                  />
                )}
              </Field>
              <Field label="PIN (optional)">
                {(id) => (
                  <Input
                    id={id}
                    value={getFieldValue("api.tvdb.pin")}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setFieldValue("api.tvdb.pin", e.target.value)}
                    placeholder="TVDB PIN (optional)"
                    className="font-mono text-xs md:text-xs"
                  />
                )}
              </Field>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={validateTvdbApi}
                  disabled={validatingApi === "tvdb"}
                >
                  {validatingApi === "tvdb" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Testen
                </Button>
                <ApiStatus status={apiStatus.tvdb} />
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
                  className="text-primary underline-offset-4 hover:underline"
                >
                  API-Key beantragen
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="API Key">
                {(id) => (
                  <Input
                    id={id}
                    value={getFieldValue("api.tmdb.key")}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setFieldValue("api.tmdb.key", e.target.value)}
                    placeholder="TMDB API Key"
                    className="font-mono text-xs md:text-xs"
                  />
                )}
              </Field>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={validateTmdbApi}
                  disabled={validatingApi === "tmdb"}
                >
                  {validatingApi === "tmdb" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Testen
                </Button>
                <ApiStatus status={apiStatus.tmdb} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>SRG-SSR API (SRF/RTS/RSI)</CardTitle>
              <CardDescription>
                API der Schweizer Sender für Inhalte von SRF, RTS und RSI.{" "}
                <a
                  href="https://developer.srgssr.ch/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  API-Zugang beantragen
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Consumer Key">
                {(id) => (
                  <Input
                    id={id}
                    value={getFieldValue("api.srgssr.consumerKey")}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setFieldValue("api.srgssr.consumerKey", e.target.value)}
                    placeholder="SRG-SSR Consumer Key"
                    className="font-mono text-xs md:text-xs"
                  />
                )}
              </Field>
              <Field
                label="Consumer Secret"
                hint="Viele SRF-Inhalte sind nur in der Schweiz abrufbar; außerhalb liefert der Sender dann keinen Stream."
              >
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    value={getFieldValue("api.srgssr.consumerSecret")}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setFieldValue("api.srgssr.consumerSecret", e.target.value)}
                    placeholder="SRG-SSR Consumer Secret"
                    className="font-mono text-xs md:text-xs"
                  />
                )}
              </Field>
            </CardContent>
          </Card>

          <SaveButton
            saving={isSaving}
            onClick={() =>
              handleSave([
                "api.tvdb.key",
                "api.tvdb.pin",
                "api.tmdb.key",
                "api.srgssr.consumerKey",
                "api.srgssr.consumerSecret",
              ])
            }
          >
            API-Keys speichern
          </SaveButton>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-4">
          <NotificationSettings />
        </TabsContent>

        {/* Matching Tab */}
        <TabsContent value="matching" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Matching</CardTitle>
              <CardDescription>
                Wie Mediathek-Treffer Serien und Folgen zugeordnet werden
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field
                label="Matching-Strategie"
                hint="Fuzzy erlaubt ähnliche Titel, Strict nur exakte Übereinstimmungen."
              >
                {(id) => (
                  <Select
                    id={id}
                    value={getFieldValue("matching.strategy")}
                    onChange={(e) => setFieldValue("matching.strategy", e.target.value)}
                  >
                    <option value="fuzzy">Fuzzy (flexibel)</option>
                    <option value="strict">Strict (exakt)</option>
                  </Select>
                )}
              </Field>
              <Field label="Schwellwert" hint="0.0 = sehr locker, 1.0 = exakte Übereinstimmung.">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={getFieldValue("matching.threshold")}
                    onChange={(e) => setFieldValue("matching.threshold", e.target.value)}
                    className="w-32"
                  />
                )}
              </Field>
              <Field label="Mindestdauer (Sekunden)" hint="Kürzere Videos werden ignoriert.">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    value={getFieldValue("matching.minDuration")}
                    onChange={(e) => setFieldValue("matching.minDuration", e.target.value)}
                    className="w-32"
                  />
                )}
              </Field>
              <ToggleRow
                label="Seriennamen für Sonarr normalisieren"
                hint="Schreibt Umlaute in Seriennamen ohne e (ö → o statt oe), damit Sonarr Releases von Serien wie Löwenzahn zuordnen kann."
                control={
                  <Switch
                    checked={getFieldValue("matching.normalizeSeriesNamesForSonarr") === "true"}
                    onChange={(e) =>
                      setFieldValue(
                        "matching.normalizeSeriesNamesForSonarr",
                        String(e.target.checked)
                      )
                    }
                  />
                }
              />
              <SaveButton
                saving={isSaving}
                onClick={() =>
                  handleSave([
                    "matching.strategy",
                    "matching.threshold",
                    "matching.minDuration",
                    "matching.normalizeSeriesNamesForSonarr",
                  ])
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cache Tab */}
        <TabsContent value="cache" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Cache</CardTitle>
              <CardDescription>
                Der Cache speichert Daten temporär, um wiederholte Anfragen zu beschleunigen. Die
                TTL (Time-to-Live) bestimmt, wie lange Daten im Cache bleiben, bevor sie neu geladen
                werden.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field
                label="Such-Cache (Sekunden)"
                hint="Wie lange Suchergebnisse der Mediathek zwischengespeichert werden. Standard: 3600 (1 Stunde). Niedrigere Werte liefern aktuellere Ergebnisse, erzeugen aber mehr Anfragen."
              >
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    value={getFieldValue("cache.ttl.search")}
                    onChange={(e) => setFieldValue("cache.ttl.search", e.target.value)}
                    className="w-40"
                  />
                )}
              </Field>
              <Field
                label="Metadaten-Cache (Sekunden)"
                hint="Wie lange Serieninformationen (Episodenlisten, Titel) gespeichert werden. Standard: 86400 (24 Stunden). Diese Daten ändern sich selten."
              >
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    value={getFieldValue("cache.ttl.metadata")}
                    onChange={(e) => setFieldValue("cache.ttl.metadata", e.target.value)}
                    className="w-40"
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-2">
                <SaveButton
                  saving={isSaving}
                  onClick={() => handleSave(["cache.ttl.search", "cache.ttl.metadata"])}
                />
                <Button
                  variant="outline"
                  onClick={() => setShowClearConfirm(true)}
                  disabled={isClearing}
                >
                  {isClearing ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  {isClearing ? "Wird geleert…" : "Cache leeren"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                „Cache leeren“ erzwingt das Neuladen aller Daten bei der nächsten Anfrage.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Tab */}
        <TabsContent value="system" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>System</CardTitle>
                <CardDescription>Versionen, Datenbank und Download-Statistik</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={fetchSystemInfo}
                aria-label="Aktualisieren"
              >
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
        </TabsContent>
      </Tabs>

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
    </Page>
  );
}
