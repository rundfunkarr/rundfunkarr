"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      setMessage(
        data.enabled
          ? "Anmeldung aktiviert. Andere Sitzungen wurden abgemeldet."
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
            <label className="text-sm flex flex-col gap-1">
              Authentifizierung
              <select
                className="h-9 rounded-md border border-input bg-background px-3 max-w-sm"
                value={enabled ? "forms" : "none"}
                onChange={(e) => setEnabled(e.target.value === "forms")}
                disabled={busy}
              >
                <option value="none">Deaktiviert</option>
                <option value="forms">Anmeldeformular</option>
              </select>
            </label>
            <p className="text-sm text-muted-foreground">
              {enabled
                ? "Die Anmeldung gilt für alle Adressen, auch im lokalen Netz. Sonarr/Radarr verwenden den Integrationsschlüssel unten."
                : "Oberfläche und APIs sind ohne Anmeldung zugänglich. Nur in einem vertrauenswürdigen Netzwerk betreiben."}
            </p>
            {enabled && (
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="text-sm flex flex-col gap-1 sm:col-span-2">
                  Benutzername
                  <Input
                    required
                    autoComplete="username"
                    maxLength={64}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className="text-sm flex flex-col gap-1">
                  Neues Passwort
                  <Input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={256}
                    required={!saved.hasPassword}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                  <span className="text-xs text-muted-foreground">
                    Mindestens 12 Zeichen{saved.hasPassword ? "; leer lassen zum Beibehalten" : ""}.
                  </span>
                </label>
                <label className="text-sm flex flex-col gap-1">
                  Neues Passwort wiederholen
                  <Input
                    type="password"
                    autoComplete="new-password"
                    required={!!password}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={busy}
                  />
                </label>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm flex flex-col gap-1">
                Integrationsschlüssel
                <Input
                  type={visible ? "text" : "password"}
                  readOnly
                  value={saved.apiKey}
                  autoComplete="off"
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <Button variant="outline" type="button" onClick={() => setVisible(!visible)}>
                {visible ? "Schlüssel verbergen" : "Schlüssel anzeigen"}
              </Button>
              <p className="text-sm text-muted-foreground">
                Beim Aktivieren diesen Wert in Sonarr/Radarr als API-Key für den RundfunkArr-Indexer
                und den SABnzbd-Download-Client eintragen. Der Schlüssel erlaubt keine Änderung der
                Sicherheitseinstellungen.
              </p>
              <label className="text-sm flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={regenerateApiKey}
                  onChange={(e) => setRegenerateApiKey(e.target.checked)}
                  disabled={busy}
                />
                Beim Speichern einen neuen Schlüssel erzeugen
              </label>
              {regenerateApiKey && (
                <p className="text-sm text-amber-600">
                  Danach den neuen Schlüssel in allen verbundenen Anwendungen eintragen. Bisherige
                  NZB-Links verlieren ihre Gültigkeit.
                </p>
              )}
            </div>
            {saved.enabled && (
              <label className="text-sm flex flex-col gap-1 max-w-sm">
                Aktuelles Passwort zur Bestätigung
                <Input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Wird gespeichert…" : "Sicherheit speichern"}
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-500 mt-3">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm mt-3">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
