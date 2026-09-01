"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSettings } from "@/contexts/settings-context";
import { buildTvdbLoginPayload } from "@/lib/tvdb-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    const tvdbPayload = buildTvdbLoginPayload(tvdbKey, tvdbPin);
    if (tvdbPayload) {
      try {
        const res = await fetch("https://api4.thetvdb.com/v4/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tvdbPayload),
        });
        setTvdbValid(res.ok);
      } catch {
        setTvdbValid(false);
      }
    } else {
      setTvdbValid(null);
    }

    // Validate TMDB
    if (tmdbKey) {
      try {
        const res = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${tmdbKey}`);
        setTmdbValid(res.ok);
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getBaseUrl = () => {
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    return "http://localhost:3000";
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-3xl mx-auto">
      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  index < currentStep
                    ? "bg-primary text-primary-foreground"
                    : index === currentStep
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {index < currentStep ? <Check className="w-4 h-4" /> : index + 1}
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={`h-0.5 w-8 sm:w-16 mx-1 ${
                    index < currentStep ? "bg-primary" : "bg-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Schritt {currentStep + 1} von {STEPS.length}: {STEPS[currentStep].title}
        </p>
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="p-6">
          {/* Step 1: Welcome */}
          {currentStep === 0 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Tv className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Willkommen bei RundfunkArr</h2>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                RundfunkArr indiziert Inhalte aus deutschen Mediatheken und macht sie für Sonarr und
                Radarr verfügbar. Dieser Assistent hilft dir bei der Einrichtung.
              </p>
              <Button onClick={() => setCurrentStep(1)} size="lg">
                Los geht&apos;s
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {/* Step 2: Paths */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-4">
                <FolderOpen className="w-6 h-6 text-primary" />
                <div>
                  <h2 className="text-xl font-bold">Download-Pfad</h2>
                  <p className="text-sm text-muted-foreground">
                    Wo sollen die Downloads gespeichert werden?
                  </p>
                </div>
              </div>

              <div>
                <Input
                  value={downloadPath}
                  onChange={(e) => {
                    setValue("download.path", e.target.value);
                    setPathValid(null);
                  }}
                  placeholder="/downloads"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Das Verzeichnis muss existieren und beschreibbar sein.
                </p>
              </div>

              {pathValid !== null && (
                <Badge variant={pathValid ? "default" : "destructive"}>
                  {pathValid ? <Check className="w-3 h-3 mr-1" /> : <X className="w-3 h-3 mr-1" />}
                  {pathValid ? "Pfad gültig" : "Pfad ungültig"}
                </Badge>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setCurrentStep(0)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Zurück
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={validatePath} disabled={isValidating}>
                    {isValidating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Prüfen
                  </Button>
                  <Button onClick={() => setCurrentStep(2)}>
                    Weiter
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: API Keys */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-4">
                <Key className="w-6 h-6 text-primary" />
                <div>
                  <h2 className="text-xl font-bold">API-Keys</h2>
                  <p className="text-sm text-muted-foreground">API-Zugänge für Metadaten-Dienste</p>
                </div>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">TheTVDB</CardTitle>
                  <CardDescription>
                    Für TV-Serien-Metadaten. Project API Keys funktionieren ohne PIN;
                    Subscriber-Keys können weiterhin eine PIN verwenden.{" "}
                    <a
                      href="https://thetvdb.com/api-information"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      API-Key beantragen <ExternalLink className="w-3 h-3" />
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    value={tvdbKey}
                    onChange={(e) => setValue("api.tvdb.key", e.target.value)}
                    placeholder="API Key"
                  />
                  <Input
                    value={tvdbPin}
                    onChange={(e) => setValue("api.tvdb.pin", e.target.value)}
                    placeholder="PIN (optional)"
                  />
                  {tvdbValid !== null && (
                    <Badge variant={tvdbValid ? "default" : "destructive"}>
                      {tvdbValid ? (
                        <Check className="w-3 h-3 mr-1" />
                      ) : (
                        <X className="w-3 h-3 mr-1" />
                      )}
                      {tvdbValid ? "Verbunden" : "Fehler"}
                    </Badge>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">TMDB</CardTitle>
                  <CardDescription>
                    Für Film-Metadaten (optional).{" "}
                    <a
                      href="https://www.themoviedb.org/settings/api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      API-Key beantragen <ExternalLink className="w-3 h-3" />
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    value={tmdbKey}
                    onChange={(e) => setValue("api.tmdb.key", e.target.value)}
                    placeholder="API Key"
                  />
                  {tmdbValid !== null && (
                    <Badge variant={tmdbValid ? "default" : "destructive"}>
                      {tmdbValid ? (
                        <Check className="w-3 h-3 mr-1" />
                      ) : (
                        <X className="w-3 h-3 mr-1" />
                      )}
                      {tmdbValid ? "Verbunden" : "Fehler"}
                    </Badge>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setCurrentStep(1)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Zurück
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={validateApis} disabled={isValidating}>
                    {isValidating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Testen
                  </Button>
                  <Button onClick={saveAndContinue}>
                    Weiter
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Test */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle className="w-6 h-6 text-primary" />
                <div>
                  <h2 className="text-xl font-bold">Verbindungstest</h2>
                  <p className="text-sm text-muted-foreground">Überprüfe alle Verbindungen</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span>Download-Pfad</span>
                  {pathValid === null ? (
                    <Badge variant="outline">Nicht geprüft</Badge>
                  ) : pathValid ? (
                    <Badge className="bg-green-500">
                      <Check className="w-3 h-3 mr-1" /> OK
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <X className="w-3 h-3 mr-1" /> Fehler
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span>TVDB API</span>
                  {tvdbValid === null ? (
                    <Badge variant="outline">Nicht konfiguriert</Badge>
                  ) : tvdbValid ? (
                    <Badge className="bg-green-500">
                      <Check className="w-3 h-3 mr-1" /> OK
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <X className="w-3 h-3 mr-1" /> Fehler
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span>TMDB API</span>
                  {tmdbValid === null ? (
                    <Badge variant="outline">Nicht konfiguriert</Badge>
                  ) : tmdbValid ? (
                    <Badge className="bg-green-500">
                      <Check className="w-3 h-3 mr-1" /> OK
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <X className="w-3 h-3 mr-1" /> Fehler
                    </Badge>
                  )}
                </div>
              </div>

              <Button onClick={runAllTests} disabled={isValidating} className="w-full">
                {isValidating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Alle Tests ausführen
              </Button>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setCurrentStep(2)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Zurück
                </Button>
                <Button onClick={() => setCurrentStep(4)}>
                  Weiter
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 5: *arr Integration */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold mb-2">*arr Integration</h2>
                <p className="text-sm text-muted-foreground">
                  Füge RundfunkArr als Indexer zu deinen *arr Apps hinzu
                </p>
              </div>

              <Tabs defaultValue="sonarr">
                <TabsList className="w-full">
                  <TabsTrigger value="sonarr" className="flex-1">
                    Sonarr
                  </TabsTrigger>
                  <TabsTrigger value="radarr" className="flex-1">
                    Radarr
                  </TabsTrigger>
                  <TabsTrigger value="prowlarr" className="flex-1">
                    Prowlarr
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="sonarr" className="space-y-4 mt-4">
                  <div className="space-y-3">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                      Indexer
                    </h3>
                    <p className="font-medium">1. Öffne Sonarr → Settings → Indexers</p>
                    <p className="font-medium">
                      2. Klicke auf &quot;+&quot; und wähle &quot;Newznab&quot;
                    </p>
                    <p className="font-medium">3. Trage folgende Werte ein:</p>

                    <div className="bg-muted p-3 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Name:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">RundfunkArr</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">URL:</span>
                        <div className="flex items-center gap-2">
                          <code className="bg-background px-2 py-1 rounded text-sm">
                            {getBaseUrl()}/api/newznab
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(`${getBaseUrl()}/api/newznab`)}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">API Key:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">rundfunkarr</code>
                      </div>
                    </div>

                    <p className="font-medium">
                      4. Klicke &quot;Test&quot; und dann &quot;Save&quot;
                    </p>

                    <hr className="my-4" />

                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                      Download Client
                    </h3>
                    <p className="font-medium">1. Öffne Sonarr → Settings → Download Clients</p>
                    <p className="font-medium">
                      2. Klicke auf &quot;+&quot; und wähle &quot;SABnzbd&quot;
                    </p>
                    <p className="font-medium">3. Trage folgende Werte ein:</p>

                    <div className="bg-muted p-3 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Name:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">RundfunkArr</code>
                      </div>
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-sm">Host:</span>
                        <div className="flex items-center gap-2">
                          <code className="bg-background px-2 py-1 rounded text-sm">
                            {typeof window !== "undefined" ? window.location.hostname : "localhost"}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              copyToClipboard(
                                typeof window !== "undefined"
                                  ? window.location.hostname
                                  : "localhost"
                              )
                            }
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Port:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">
                          {typeof window !== "undefined" ? window.location.port || "3000" : "3000"}
                        </code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">API Key:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">rundfunkarr</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Category:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">sonarr</code>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Docker: Verwende den Container-Namen (z.B.{" "}
                      <code className="bg-muted px-1 rounded">rundfunkarr</code>) statt localhost.
                    </p>

                    <p className="font-medium">
                      4. Klicke &quot;Test&quot; und dann &quot;Save&quot;
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="radarr" className="space-y-4 mt-4">
                  <div className="space-y-3">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                      Indexer
                    </h3>
                    <p className="font-medium">1. Öffne Radarr → Settings → Indexers</p>
                    <p className="font-medium">
                      2. Klicke auf &quot;+&quot; und wähle &quot;Newznab&quot;
                    </p>
                    <p className="font-medium">3. Trage folgende Werte ein:</p>

                    <div className="bg-muted p-3 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Name:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">RundfunkArr</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">URL:</span>
                        <div className="flex items-center gap-2">
                          <code className="bg-background px-2 py-1 rounded text-sm">
                            {getBaseUrl()}/api/newznab
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(`${getBaseUrl()}/api/newznab`)}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">API Key:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">rundfunkarr</code>
                      </div>
                    </div>

                    <p className="font-medium">
                      4. Klicke &quot;Test&quot; und dann &quot;Save&quot;
                    </p>

                    <hr className="my-4" />

                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                      Download Client
                    </h3>
                    <p className="font-medium">1. Öffne Radarr → Settings → Download Clients</p>
                    <p className="font-medium">
                      2. Klicke auf &quot;+&quot; und wähle &quot;SABnzbd&quot;
                    </p>
                    <p className="font-medium">3. Trage folgende Werte ein:</p>

                    <div className="bg-muted p-3 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Name:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">RundfunkArr</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Host:</span>
                        <div className="flex items-center gap-2">
                          <code className="bg-background px-2 py-1 rounded text-sm">
                            {typeof window !== "undefined" ? window.location.hostname : "localhost"}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              copyToClipboard(
                                typeof window !== "undefined"
                                  ? window.location.hostname
                                  : "localhost"
                              )
                            }
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Port:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">
                          {typeof window !== "undefined" ? window.location.port || "3000" : "3000"}
                        </code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">API Key:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">rundfunkarr</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Category:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">radarr</code>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Docker: Verwende den Container-Namen (z.B.{" "}
                      <code className="bg-muted px-1 rounded">rundfunkarr</code>) statt localhost.
                    </p>

                    <p className="font-medium">
                      4. Klicke &quot;Test&quot; und dann &quot;Save&quot;
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="prowlarr" className="space-y-4 mt-4">
                  <div className="space-y-3">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                      Indexer
                    </h3>
                    <p className="font-medium">1. Öffne Prowlarr → Indexers</p>
                    <p className="font-medium">
                      2. Klicke auf &quot;+&quot; und wähle &quot;Generic Newznab&quot;
                    </p>
                    <p className="font-medium">3. Trage folgende Werte ein:</p>

                    <div className="bg-muted p-3 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Name:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">RundfunkArr</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">URL:</span>
                        <div className="flex items-center gap-2">
                          <code className="bg-background px-2 py-1 rounded text-sm">
                            {getBaseUrl()}/api/newznab
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(`${getBaseUrl()}/api/newznab`)}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">API Key:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">rundfunkarr</code>
                      </div>
                    </div>

                    <p className="font-medium">
                      4. Klicke &quot;Test&quot; und dann &quot;Save&quot;
                    </p>

                    <hr className="my-4" />

                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                      Download Client
                    </h3>
                    <p className="font-medium">1. Öffne Prowlarr → Settings → Download Clients</p>
                    <p className="font-medium">
                      2. Klicke auf &quot;+&quot; und wähle &quot;SABnzbd&quot;
                    </p>
                    <p className="font-medium">3. Trage folgende Werte ein:</p>

                    <div className="bg-muted p-3 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Name:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">RundfunkArr</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Host:</span>
                        <div className="flex items-center gap-2">
                          <code className="bg-background px-2 py-1 rounded text-sm">
                            {typeof window !== "undefined" ? window.location.hostname : "localhost"}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              copyToClipboard(
                                typeof window !== "undefined"
                                  ? window.location.hostname
                                  : "localhost"
                              )
                            }
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Port:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">
                          {typeof window !== "undefined" ? window.location.port || "3000" : "3000"}
                        </code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">API Key:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">rundfunkarr</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Default Category:</span>
                        <code className="bg-background px-2 py-1 rounded text-sm">sonarr</code>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Docker: Verwende den Container-Namen (z.B.{" "}
                      <code className="bg-muted px-1 rounded">rundfunkarr</code>) statt localhost.
                    </p>

                    <p className="font-medium">
                      4. Klicke &quot;Test&quot; und dann &quot;Save&quot;
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Prowlarr synchronisiert den Indexer automatisch zu deinen anderen *arr Apps.
                      Den Download-Client synchronisiert Prowlarr nicht. Richte RundfunkArr dafür
                      zusätzlich direkt in Sonarr und Radarr ein. Der Download-Client hier ist nur
                      für manuelle Downloads aus Prowlarr gedacht.
                    </p>
                  </div>
                </TabsContent>
              </Tabs>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setCurrentStep(3)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Zurück
                </Button>
                <Button onClick={() => setCurrentStep(5)}>
                  Weiter
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 6: Done */}
          {currentStep === 5 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Setup abgeschlossen!</h2>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                RundfunkArr ist jetzt eingerichtet. Du kannst die Einstellungen jederzeit unter
                &quot;Settings&quot; anpassen.
              </p>

              <div className="bg-muted p-4 rounded-lg text-left mb-6 max-w-sm mx-auto">
                <h3 className="font-medium mb-2">Zusammenfassung:</h3>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>Download-Pfad: {downloadPath}</li>
                  <li>TVDB: {tvdbKey ? "Konfiguriert" : "Nicht konfiguriert"}</li>
                  <li>TMDB: {tmdbKey ? "Konfiguriert" : "Nicht konfiguriert"}</li>
                </ul>
              </div>

              <Button onClick={finishSetup} size="lg">
                Zum Dashboard
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
