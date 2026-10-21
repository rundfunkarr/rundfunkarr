"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";

interface AuthSettings {
  enabled: boolean;
  username: string;
  hasPassword: boolean;
  apiKey: string;
}
export function SecuritySettings() {
  const [saved, setSaved] = useState<AuthSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [regenerateApiKey, setRegenerateApiKey] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/settings", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setSaved(data);
        setEnabled(data.enabled);
        setUsername(data.username);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Sicherheitseinstellungen konnten nicht geladen werden."
          );
      });
    return () => controller.abort();
  }, []);
  async function save() {
    setError("");
    setMessage("");
    if (password !== confirm) {
      setError("Die neuen Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, username, password, currentPassword, regenerateApiKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Speichern fehlgeschlagen.");
      setSaved(data);
      setPassword("");
      setConfirm("");
      setCurrentPassword("");
      setRegenerateApiKey(false);
      setVisible(false);
      setMessage(
        data.enabled
          ? "Anmeldung aktiviert. Andere Sitzungen wurden abgemeldet." +
              (data.apiKey !== saved?.apiKey
                ? " Ein neuer Integrationsschlüssel wurde erzeugt. Bitte in Sonarr/Radarr übernehmen."
                : "")
          : "Anmeldung deaktiviert."
      );
      window.dispatchEvent(new Event("auth-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sicherheit</CardTitle>
        <CardDescription>Optionale Anmeldung für Oberfläche und Verwaltungs-API.</CardDescription>
      </CardHeader>
      <CardContent>
        {!saved && !error && <p className="text-sm text-muted-foreground">Wird geladen…</p>}
        {saved && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="space-y-4"
          >
            <Field
              label="Authentifizierung"
              className="max-w-sm"
              hint={
                enabled
                  ? saved.enabled
                    ? "Die Anmeldung gilt für alle Adressen, auch im lokalen Netz. Sonarr/Radarr verwenden den Integrationsschlüssel unten."
                    : "Beim Aktivieren wird ein neuer Integrationsschlüssel erzeugt. Nach dem Speichern in Sonarr/Radarr eintragen; bisherige Schlüssel und NZB-Links werden ungültig. Die Anmeldung gilt auch im lokalen Netz."
                  : "Oberfläche und APIs sind ohne Anmeldung zugänglich. Nur in einem vertrauenswürdigen Netzwerk betreiben."
              }
            >
              {(id) => (
                <Select
                  id={id}
                  value={enabled ? "forms" : "none"}
                  onChange={(e) => setEnabled(e.target.value === "forms")}
                  disabled={busy}
                >
                  <option value="none">Deaktiviert</option>
                  <option value="forms">Anmeldeformular</option>
                </Select>
              )}
            </Field>
            {enabled && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Benutzername" className="sm:col-span-2">
                  {(id) => (
                    <Input
                      id={id}
                      required
                      autoComplete="username"
                      maxLength={64}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={busy}
                    />
                  )}
                </Field>
                <Field
                  label="Neues Passwort"
                  hint={`Mindestens 12 Zeichen${saved.hasPassword ? "; leer lassen zum Beibehalten" : ""}.`}
                >
                  {(id) => (
                    <Input
                      id={id}
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={256}
                      required={!saved.hasPassword}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                    />
                  )}
                </Field>
                <Field label="Neues Passwort wiederholen">
                  {(id) => (
                    <Input
                      id={id}
                      type="password"
                      autoComplete="new-password"
                      required={!!password}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      disabled={busy}
                    />
                  )}
                </Field>
              </div>
            )}
            {saved.enabled && (
              <div className="space-y-3 rounded-md border p-3">
                <Field
                  label="Integrationsschlüssel"
                  hint="Diesen Wert in Sonarr/Radarr als API-Key für den RundfunkArr-Indexer und den SABnzbd-Download-Client eintragen. Der Schlüssel erlaubt keine Änderung der Sicherheitseinstellungen."
                >
                  {(id) => (
                    <div className="flex gap-2">
                      <Input
                        id={id}
                        type={visible ? "text" : "password"}
                        readOnly
                        value={saved.apiKey}
                        autoComplete="off"
                        onFocus={(e) => e.target.select()}
                        className="font-mono text-xs md:text-xs"
                      />
                      <Button
                        variant="outline"
                        type="button"
                        className="shrink-0"
                        onClick={() => setVisible(!visible)}
                      >
                        {visible ? "Verbergen" : "Anzeigen"}
                      </Button>
                    </div>
                  )}
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={regenerateApiKey}
                    onChange={(e) => setRegenerateApiKey(e.target.checked)}
                    disabled={busy}
                  />
                  Beim Speichern einen neuen Schlüssel erzeugen
                </label>
                {regenerateApiKey && (
                  <Notice tone="warn">
                    Danach den neuen Schlüssel in allen verbundenen Anwendungen eintragen. Bisherige
                    NZB-Links verlieren ihre Gültigkeit.
                  </Notice>
                )}
              </div>
            )}
            {saved.enabled && (
              <Field label="Aktuelles Passwort zur Bestätigung" className="max-w-sm">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={busy}
                  />
                )}
              </Field>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Wird gespeichert…" : "Sicherheit speichern"}
            </Button>
          </form>
        )}
        {error && (
          <Notice tone="danger" className="mt-3">
            {error}
          </Notice>
        )}
        {message && (
          <Notice tone="ok" className="mt-3">
            {message}
          </Notice>
        )}
      </CardContent>
    </Card>
  );
}
