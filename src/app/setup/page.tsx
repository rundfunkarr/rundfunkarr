"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSettings } from "@/contexts/settings-context";
import { validateApiCredentials } from "@/lib/validate-api-credentials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/shared/page";
import { Field } from "@/components/shared/field";
import { cn } from "@/lib/utils";
import {
  Tv,
  FolderOpen,
  Key,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
  X,
  Copy,
  ExternalLink,
} from "lucide-react";

const STEPS = [
  { id: "welcome", title: "Willkommen" },
  { id: "paths", title: "Pfade" },
  { id: "api", title: "API-Keys" },
  { id: "test", title: "Test" },
  { id: "arr", title: "*arr Setup" },
  { id: "done", title: "Fertig" },
];

const APPS = [
  {
    id: "sonarr",
    name: "Sonarr",
    indexerPath: "Sonarr → Settings → Indexers",
    indexerType: "Newznab",
    clientPath: "Sonarr → Settings → Download Clients",
    categoryLabel: "Category",
    category: "sonarr",
    note: null,
  },
  {
    id: "radarr",
    name: "Radarr",
    indexerPath: "Radarr → Settings → Indexers",
    indexerType: "Newznab",
    clientPath: "Radarr → Settings → Download Clients",
    categoryLabel: "Category",
    category: "radarr",
    note: null,
  },
  {
    id: "prowlarr",
    name: "Prowlarr",
    indexerPath: "Prowlarr → Indexers",
    indexerType: "Generic Newznab",
    clientPath: "Prowlarr → Settings → Download Clients",
    categoryLabel: "Default Category",
    category: "sonarr",
    note: "Prowlarr synchronisiert den Indexer automatisch zu deinen anderen *arr Apps. Den Download-Client synchronisiert Prowlarr nicht. Richte RundfunkArr dafür zusätzlich direkt in Sonarr und Radarr ein. Der Download-Client hier ist nur für manuelle Downloads aus Prowlarr gedacht.",
  },
];

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? `${label} kopiert` : `${label} kopieren`}
      title={copied ? "Kopiert" : "Kopieren"}
      onClick={() => {
        // navigator.clipboard is missing over plain HTTP on LAN addresses; the
        // value then stays visible for manual copying.
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
    >
      {copied ? <Check className="text-ok" /> : <Copy />}
    </Button>
  );
}

function ValueRow({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1">
        <code className="truncate rounded-md bg-background px-2 py-1 font-mono text-xs">
          {value}
        </code>
        {copyable && <CopyButton value={value} label={label} />}
      </span>
    </div>
  );
}

function ValueBlock({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg bg-muted px-3 py-2">{children}</div>;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <h3 className="eyebrow pt-1">{children}</h3>;
}

function StepHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Tv;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function ResultBadge({ value, unset }: { value: boolean | null; unset: string }) {
  if (value === null) return <Badge variant="outline">{unset}</Badge>;
  return value ? (
    <Badge variant="ok">
      <Check /> OK
    </Badge>
  ) : (
    <Badge variant="danger">
      <X /> Fehler
    </Badge>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const { settings, updateSettings } = useSettings();
  const [currentStep, setCurrentStep] = useState(0);
  const [isValidating, setIsValidating] = useState(false);

  // Form state - use settings as initial values, track local overrides
  const [localOverrides, setLocalOverrides] = useState<Record<string, string>>({});

  // Get value: local override > settings > default
  // Note: Empty strings are valid values (e.g., cleared API keys)
  const getValue = (key: string, defaultValue: string) => {
    if (localOverrides[key] !== undefined) return localOverrides[key];
    if (settings?.[key] !== undefined && settings[key] !== null) return settings[key];
    return defaultValue;
  };

  const setValue = (key: string, value: string) => {
    setLocalOverrides((prev) => ({ ...prev, [key]: value }));
  };

  const downloadPath = getValue("download.path", "/downloads");
  const tvdbKey = getValue("api.tvdb.key", "");
  const tvdbPin = getValue("api.tvdb.pin", "");
  const tmdbKey = getValue("api.tmdb.key", "");

  // Validation state
  const [pathValid, setPathValid] = useState<boolean | null>(null);
  const [tvdbValid, setTvdbValid] = useState<boolean | null>(null);
  const [tmdbValid, setTmdbValid] = useState<boolean | null>(null);

  const validatePath = async () => {
    setIsValidating(true);
    // In a real app, this would check if the path exists and is writable
    // For now, just check if it's not empty
    setPathValid(downloadPath.trim().length > 0);
    setIsValidating(false);
  };

  const validateApis = async () => {
    setIsValidating(true);

    // Validate TVDB
    if (tvdbKey.trim()) {
      try {
        setTvdbValid(await validateApiCredentials("tvdb", tvdbKey, tvdbPin));
      } catch {
        setTvdbValid(false);
      }
    } else {
      setTvdbValid(null);
    }

    // Validate TMDB
    if (tmdbKey) {
      try {
        setTmdbValid(await validateApiCredentials("tmdb", tmdbKey));
      } catch {
        setTmdbValid(false);
      }
    } else {
      setTmdbValid(null);
    }

    setIsValidating(false);
  };

  const runAllTests = async () => {
    setIsValidating(true);
    await validatePath();
    await validateApis();
    setIsValidating(false);
  };

  const saveAndContinue = async () => {
    await updateSettings({
      "download.path": downloadPath,
      "api.tvdb.key": tvdbKey,
      "api.tvdb.pin": tvdbPin,
      "api.tmdb.key": tmdbKey,
    });
    setCurrentStep((prev) => prev + 1);
  };

  const finishSetup = async () => {
    await updateSettings({
      "system.setupComplete": "true",
    });
    router.push("/");
  };

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const port = typeof window !== "undefined" ? window.location.port || "3000" : "3000";

  const navigation = (back: number, next?: () => void, extra?: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-5">
      <Button variant="outline" onClick={() => setCurrentStep(back)}>
        <ArrowLeft />
        Zurück
      </Button>
      <div className="flex gap-2">
        {extra}
        {next && (
          <Button onClick={next}>
            Weiter
            <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Page width="compact">
      <nav aria-label="Einrichtungsschritte" className="pt-2">
        <ol className="flex items-start">
          {STEPS.map((step, index) => {
            const state = index < currentStep ? "done" : index === currentStep ? "current" : "todo";
            return (
              <li key={step.id} className="flex flex-1 items-start last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <span
                    aria-current={state === "current" ? "step" : undefined}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border text-sm font-medium transition-colors",
                      state === "done" && "border-primary/40 bg-primary/15 text-primary",
                      state === "current" && "border-primary bg-primary text-primary-foreground",
                      state === "todo" && "border-border text-muted-foreground"
                    )}
                  >
                    {state === "done" ? <Check className="size-4" /> : index + 1}
                  </span>
                  <span
                    className={cn(
                      "hidden whitespace-nowrap text-xs sm:block",
                      state === "current" ? "font-medium" : "text-muted-foreground"
                    )}
                  >
                    {step.title}
                  </span>
                </div>
                {index < STEPS.length - 1 && (
                  <div
                    aria-hidden
                    className={cn(
                      "mx-2 mt-4 h-px flex-1",
                      index < currentStep ? "bg-primary" : "bg-border"
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-center text-xs text-muted-foreground sm:hidden">
          Schritt {currentStep + 1} von {STEPS.length}: {STEPS[currentStep].title}
        </p>
      </nav>

      <Card>
        <CardContent className="p-6">
          {/* Step 1: Welcome */}
          {currentStep === 0 && (
            <div className="py-6 text-center">
              <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Tv className="size-8" />
              </span>
              <h2 className="text-2xl font-semibold tracking-tight">Willkommen bei RundfunkArr</h2>
              <p className="mx-auto mb-6 mt-2 max-w-md text-muted-foreground">
                RundfunkArr indiziert Inhalte aus den Mediatheken und macht sie für Sonarr und
                Radarr verfügbar. Dieser Assistent hilft dir bei der Einrichtung.
              </p>
              <Button onClick={() => setCurrentStep(1)} size="lg">
                Los geht&apos;s
                <ArrowRight />
              </Button>
            </div>
          )}

          {/* Step 2: Paths */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <StepHeading
                icon={FolderOpen}
                title="Download-Pfad"
                description="Wo sollen die Downloads gespeichert werden?"
              />

              <Field
                label="Verzeichnis"
                hint="Das Verzeichnis muss existieren und beschreibbar sein."
              >
                {(id) => (
                  <Input
                    id={id}
                    value={downloadPath}
                    onChange={(e) => {
                      setValue("download.path", e.target.value);
                      setPathValid(null);
                    }}
                    placeholder="/downloads"
                    className="font-mono text-xs md:text-xs"
                  />
                )}
              </Field>

              {pathValid !== null && (
                <div>
                  <Badge variant={pathValid ? "ok" : "danger"}>
                    {pathValid ? <Check /> : <X />}
                    {pathValid ? "Pfad gültig" : "Pfad ungültig"}
                  </Badge>
                </div>
              )}

              {navigation(
                0,
                () => setCurrentStep(2),
                <Button variant="outline" onClick={validatePath} disabled={isValidating}>
                  {isValidating ? <Loader2 className="animate-spin" /> : null}
                  Prüfen
                </Button>
              )}
            </div>
          )}

          {/* Step 3: API Keys */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <StepHeading
                icon={Key}
                title="API-Keys"
                description="Zugänge für Metadaten-Dienste. Beide lassen sich später ergänzen."
              />

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>TheTVDB</CardTitle>
                  <CardDescription>
                    Für Serien-Metadaten. Project API Keys funktionieren ohne PIN; Subscriber-Keys
                    können weiterhin eine PIN verwenden.{" "}
                    <a
                      href="https://thetvdb.com/api-information"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                    >
                      API-Key beantragen <ExternalLink className="size-3" />
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="API Key" srOnlyLabel>
                    {(id) => (
                      <Input
                        id={id}
                        value={tvdbKey}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setValue("api.tvdb.key", e.target.value)}
                        placeholder="API Key"
                        className="font-mono text-xs md:text-xs"
                      />
                    )}
                  </Field>
                  <Field label="PIN (optional)" srOnlyLabel>
                    {(id) => (
                      <Input
                        id={id}
                        value={tvdbPin}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setValue("api.tvdb.pin", e.target.value)}
                        placeholder="PIN (optional)"
                        className="font-mono text-xs md:text-xs"
                      />
                    )}
                  </Field>
                  {tvdbValid !== null && (
                    <div>
                      <Badge variant={tvdbValid ? "ok" : "danger"}>
                        {tvdbValid ? <Check /> : <X />}
                        {tvdbValid ? "Verbunden" : "Fehler"}
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>TMDB</CardTitle>
                  <CardDescription>
                    Für Film-Metadaten (optional).{" "}
                    <a
                      href="https://www.themoviedb.org/settings/api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                    >
                      API-Key beantragen <ExternalLink className="size-3" />
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="API Key" srOnlyLabel>
                    {(id) => (
                      <Input
                        id={id}
                        value={tmdbKey}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setValue("api.tmdb.key", e.target.value)}
                        placeholder="API Key"
                        className="font-mono text-xs md:text-xs"
                      />
                    )}
                  </Field>
                  {tmdbValid !== null && (
                    <div>
                      <Badge variant={tmdbValid ? "ok" : "danger"}>
                        {tmdbValid ? <Check /> : <X />}
                        {tmdbValid ? "Verbunden" : "Fehler"}
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>

              {navigation(
                1,
                saveAndContinue,
                <Button variant="outline" onClick={validateApis} disabled={isValidating}>
                  {isValidating ? <Loader2 className="animate-spin" /> : null}
                  Testen
                </Button>
              )}
            </div>
          )}

          {/* Step 4: Test */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <StepHeading
                icon={CheckCircle}
                title="Verbindungstest"
                description="Überprüfe Pfad und API-Zugänge."
              />

              <div className="divide-y rounded-lg border">
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-sm">Download-Pfad</span>
                  <ResultBadge value={pathValid} unset="Nicht geprüft" />
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-sm">TVDB API</span>
                  <ResultBadge value={tvdbValid} unset="Nicht konfiguriert" />
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-sm">TMDB API</span>
                  <ResultBadge value={tmdbValid} unset="Nicht konfiguriert" />
                </div>
              </div>

              <Button onClick={runAllTests} disabled={isValidating} className="w-full">
                {isValidating ? <Loader2 className="animate-spin" /> : null}
                Alle Tests ausführen
              </Button>

              {navigation(2, () => setCurrentStep(4))}
            </div>
          )}

          {/* Step 5: *arr Integration */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <StepHeading
                icon={Tv}
                title="*arr Integration"
                description="Füge RundfunkArr als Indexer und Download-Client zu deinen *arr Apps hinzu."
              />

              <Tabs defaultValue="sonarr">
                <TabsList>
                  {APPS.map((app) => (
                    <TabsTrigger key={app.id} value={app.id} className="flex-1">
                      {app.name}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {APPS.map((app) => (
                  <TabsContent key={app.id} value={app.id} className="space-y-5">
                    <section className="space-y-3">
                      <Eyebrow>Indexer</Eyebrow>
                      <ol className="list-decimal space-y-1 pl-5 text-sm">
                        <li>Öffne {app.indexerPath}</li>
                        <li>Klicke auf „+“ und wähle „{app.indexerType}“</li>
                        <li>Trage folgende Werte ein:</li>
                      </ol>
                      <ValueBlock>
                        <ValueRow label="Name" value="RundfunkArr" />
                        <ValueRow label="URL" value={`${baseUrl}/api/newznab`} copyable />
                        <ValueRow label="API Key" value="rundfunkarr" />
                      </ValueBlock>
                      <p className="text-sm">4. Klicke „Test“ und dann „Save“</p>
                    </section>

                    <section className="space-y-3 border-t pt-5">
                      <Eyebrow>Download Client</Eyebrow>
                      <ol className="list-decimal space-y-1 pl-5 text-sm">
                        <li>Öffne {app.clientPath}</li>
                        <li>Klicke auf „+“ und wähle „SABnzbd“</li>
                        <li>Trage folgende Werte ein:</li>
                      </ol>
                      <ValueBlock>
                        <ValueRow label="Name" value="RundfunkArr" />
                        <ValueRow label="Host" value={host} copyable />
                        <ValueRow label="Port" value={port} />
                        <ValueRow label="API Key" value="rundfunkarr" />
                        <ValueRow label={app.categoryLabel} value={app.category} />
                      </ValueBlock>
                      <p className="text-xs text-muted-foreground">
                        Docker: Verwende den Container-Namen (z. B. <code>rundfunkarr</code>) statt
                        localhost.
                      </p>
                      <p className="text-sm">4. Klicke „Test“ und dann „Save“</p>
                      {app.note && <p className="text-sm text-muted-foreground">{app.note}</p>}
                    </section>
                  </TabsContent>
                ))}
              </Tabs>

              {navigation(3, () => setCurrentStep(5))}
            </div>
          )}

          {/* Step 6: Done */}
          {currentStep === 5 && (
            <div className="py-6 text-center">
              <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-ok/10 text-ok">
                <CheckCircle className="size-8" />
              </span>
              <h2 className="text-2xl font-semibold tracking-tight">Setup abgeschlossen</h2>
              <p className="mx-auto mb-6 mt-2 max-w-md text-muted-foreground">
                RundfunkArr ist jetzt eingerichtet. Du kannst die Einstellungen jederzeit unter
                „Einstellungen“ anpassen.
              </p>

              <dl className="mx-auto mb-6 grid max-w-sm grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg border p-4 text-left text-sm">
                <dt className="text-muted-foreground">Download-Pfad</dt>
                <dd className="truncate font-mono text-xs">{downloadPath}</dd>
                <dt className="text-muted-foreground">TVDB</dt>
                <dd>{tvdbKey ? "Konfiguriert" : "Nicht konfiguriert"}</dd>
                <dt className="text-muted-foreground">TMDB</dt>
                <dd>{tmdbKey ? "Konfiguriert" : "Nicht konfiguriert"}</dd>
              </dl>

              <Button onClick={finishSetup} size="lg">
                Zum Dashboard
                <ArrowRight />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
