"use client";

import { useState } from "react";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { SaveButton, type SettingsForm } from "@/components/settings/settings-form";
import { validateApiCredentials } from "@/lib/validate-api-credentials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/shared/field";

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

export function ApiKeySettings({ form }: { form: SettingsForm }) {
  const { getFieldValue, setFieldValue, save: handleSave, isSaving } = form;
  const [validatingApi, setValidatingApi] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<Record<string, boolean | null>>({});

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

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>TVDB API</CardTitle>
          <CardDescription>
            TheTVDB.com API-Zugangsdaten für Serien-Metadaten. Project API Keys funktionieren ohne
            PIN; Subscriber-Keys können weiterhin eine PIN verwenden.{" "}
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
            <Button variant="outline" onClick={validateTvdbApi} disabled={validatingApi === "tvdb"}>
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
            <Button variant="outline" onClick={validateTmdbApi} disabled={validatingApi === "tmdb"}>
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
    </>
  );
}
