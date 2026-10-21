"use client";
import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";

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
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <Image src="/logo.svg" alt="" width={40} height={40} className="size-10 rounded-xl" />
          <span className="text-lg font-semibold tracking-tight">RundfunkArr</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Anmelden</CardTitle>
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
              <Field label="Benutzername">
                {(id) => (
                  <Input
                    id={id}
                    autoComplete="username"
                    required
                    maxLength={64}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={busy}
                  />
                )}
              </Field>
              <Field label="Passwort">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={256}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                )}
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  disabled={busy}
                />
                30 Tage angemeldet bleiben
              </label>
              {error && <Notice tone="danger">{error}</Notice>}
              <Button className="w-full" type="submit" disabled={busy}>
                {busy ? "Wird angemeldet…" : "Anmelden"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
