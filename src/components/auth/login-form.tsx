"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function LoginForm({ returnTo }: { returnTo: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, remember }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : response.status === 429
              ? "Zu viele Anmeldeversuche. Bitte kurz warten und erneut versuchen."
              : "Anmeldung fehlgeschlagen."
        );
      setPassword("");
      window.location.replace(returnTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Anmeldung fehlgeschlagen.");
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen grid place-items-center p-4 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">RundfunkArr</p>
          <CardTitle className="text-2xl">Anmelden</CardTitle>
          <CardDescription>Mit deinem Administratorkonto fortfahren.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="text-sm flex flex-col gap-1">
              Benutzername
              <Input
                autoComplete="username"
                required
                maxLength={64}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="text-sm flex flex-col gap-1">
              Passwort
              <Input
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              30 Tage angemeldet bleiben
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-500">
                {error}
              </p>
            )}
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? "Wird angemeldet…" : "Anmelden"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
