"use client";
import { useState } from "react";
import { Loader2, Save, Send } from "lucide-react";
import { useSettings } from "@/contexts/settings-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/checkbox";
import { Field, ToggleRow } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";

type Target = "webhook" | "ntfy" | "gotify" | "discord";

interface TargetField {
  field: "url" | "topic" | "token";
  label: string;
  placeholder: string;
  hint?: string;
  secret?: boolean;
}

const TARGETS: { id: Target; title: string; description: string; fields: TargetField[] }[] = [
  {
    id: "webhook",
    title: "Webhook",
    description:
      "Sendet jedes Ereignis als JSON per POST, zum Beispiel an Home Assistant, n8n oder ein eigenes Skript. Das Format steht in der README.",
    fields: [
      {
        field: "url",
        label: "Webhook-Adresse",
        placeholder: "https://example.org/webhook",
        secret: true,
      },
    ],
  },
  {
    id: "ntfy",
    title: "ntfy",
    description: "Push-Nachrichten über ntfy.sh oder einen eigenen ntfy-Server.",
    fields: [
      {
        field: "url",
        label: "Serveradresse",
        placeholder: "https://ntfy.sh",
        hint: "Nur die Adresse des Servers, ohne Topic.",
      },
      {
        field: "topic",
        label: "Topic",
        placeholder: "rundfunkarr-downloads",
        hint: "Auf ntfy.sh kann jeder ein Topic lesen, der den Namen kennt. Einen schwer zu erratenden Namen wählen.",
      },
      {
        field: "token",
        label: "Zugriffstoken (optional)",
        placeholder: "tk_…",
        hint: "Nur nötig, wenn der Server eine Anmeldung verlangt.",
        secret: true,
      },
    ],
  },
  {
    id: "gotify",
    title: "Gotify",
    description: "Nachrichten an einen eigenen Gotify-Server.",
    fields: [
      { field: "url", label: "Serveradresse", placeholder: "https://gotify.example.org" },
      {
        field: "token",
        label: "App-Token",
        placeholder: "Token der Gotify-Anwendung",
        secret: true,
      },
    ],
  },
  {
    id: "discord",
    title: "Discord",
    description: "Nachrichten in einen Discord-Kanal über einen Kanal-Webhook.",
    fields: [
      {
        field: "url",
        label: "Webhook-Adresse",
        placeholder: "https://discord.com/api/webhooks/…",
        hint: "In Discord unter Kanal bearbeiten → Integrationen → Webhooks.",
        secret: true,
      },
    ],
  },
];

const EVENTS = [
  {
    key: "notifications.event.downloadCompleted",
    label: "Download abgeschlossen",
    hint: "Mit Titel, Sender und Dateiname.",
  },
  {
    key: "notifications.event.downloadFailed",
    label: "Download fehlgeschlagen",
    hint: "Mit Fehlermeldung, zum Beispiel bei einer Geosperre. Automatische Wiederholungen lösen keine Nachricht aus.",
  },
  {
    key: "notifications.event.subscriptionQueued",
    label: "Suchabo hat Downloads gestartet",
    hint: "Eine Nachricht pro Prüfung mit allen neu eingereihten Downloads.",
  },
  {
    key: "notifications.event.subscriptionFound",
    label: "Suchabo hat neue Treffer gefunden",
    hint: "Für Suchabos mit der Aktion „Melden“: eine Nachricht pro Prüfung mit allen neuen Treffern.",
  },
];

const enabledKey = (target: Target) => `notifications.${target}.enabled`;
const fieldKey = (target: Target, field: TargetField["field"]) =>
  `notifications.${target}.${field}`;
const ALL_KEYS = [
  ...EVENTS.map((event) => event.key),
  ...TARGETS.flatMap((target) => [
    enabledKey(target.id),
    ...target.fields.map((field) => fieldKey(target.id, field.field)),
  ]),
];

type TestState = { busy: boolean; result?: { success: boolean; error?: string } };

export function NotificationSettings() {
  const { settings, updateSettings } = useSettings();
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [tests, setTests] = useState<Partial<Record<Target, TestState>>>({});

  const value = (key: string) => form[key] ?? settings?.[key] ?? "";
  const set = (key: string, next: string) => setForm((prev) => ({ ...prev, [key]: next }));
  const dirty = ALL_KEYS.some((key) => form[key] !== undefined && form[key] !== settings?.[key]);

  async function save() {
    setSaving(true);
    setSaveError("");
    try {
      const updates = Object.fromEntries(
        ALL_KEYS.flatMap((k) => (k in form ? [[k, form[k]]] : []))
      );
      await updateSettings(updates);
      setForm({});
    } catch {
      setSaveError("Einstellungen konnten nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(target: (typeof TARGETS)[number]) {
    setTests((prev) => ({ ...prev, [target.id]: { busy: true } }));
    let result: TestState["result"];
    try {
      const config = Object.fromEntries(
        target.fields.map((field) => [field.field, value(fieldKey(target.id, field.field))])
      );
      const response = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.id, config }),
      });
      const data = await response.json().catch(() => ({}));
      result = {
        success: response.ok && data.success === true,
        error: data.error || (response.ok ? undefined : `HTTP ${response.status}`),
      };
    } catch (error) {
      result = { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    setTests((prev) => ({ ...prev, [target.id]: { busy: false, result } }));
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Ereignisse</CardTitle>
          <CardDescription>
            Welche Ereignisse eine Nachricht auslösen. Gilt für alle aktiven Ziele.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {EVENTS.map((event) => (
            <ToggleRow
              key={event.key}
              label={event.label}
              hint={event.hint}
              control={
                <Switch
                  checked={value(event.key) !== "false"}
                  onChange={(e) => set(event.key, String(e.target.checked))}
                />
              }
            />
          ))}
        </CardContent>
      </Card>

      {TARGETS.map((target) => {
        const test = tests[target.id];
        return (
          <Card key={target.id}>
            <CardHeader>
              <CardTitle>{target.title}</CardTitle>
              <CardDescription>{target.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                label="Aktiv"
                hint="Sendet, sobald die Pflichtfelder ausgefüllt sind."
                control={
                  <Switch
                    checked={value(enabledKey(target.id)) !== "false"}
                    onChange={(e) => set(enabledKey(target.id), String(e.target.checked))}
                  />
                }
              />
              {target.fields.map((field) => {
                const key = fieldKey(target.id, field.field);
                return (
                  <Field key={key} label={field.label} hint={field.hint}>
                    {(id) => (
                      <Input
                        id={id}
                        type={field.secret ? "password" : "text"}
                        autoComplete="off"
                        spellCheck={false}
                        value={value(key)}
                        onFocus={field.secret ? (e) => e.currentTarget.select() : undefined}
                        onChange={(e) => set(key, e.target.value)}
                        placeholder={field.placeholder}
                        className="font-mono text-xs md:text-xs"
                      />
                    )}
                  </Field>
                );
              })}
              <Button variant="outline" onClick={() => sendTest(target)} disabled={test?.busy}>
                {test?.busy ? <Loader2 className="animate-spin" /> : <Send />}
                Testnachricht senden
              </Button>
              {test?.result &&
                (test.result.success ? (
                  <Notice tone="ok">Testnachricht gesendet.</Notice>
                ) : (
                  <Notice tone="danger">
                    Testnachricht fehlgeschlagen: {test.result.error || "Unbekannter Fehler"}
                  </Notice>
                ))}
            </CardContent>
          </Card>
        );
      })}

      {saveError && <Notice tone="danger">{saveError}</Notice>}
      <Button onClick={save} disabled={saving || !dirty}>
        {saving ? <Loader2 className="animate-spin" /> : <Save />}
        Benachrichtigungen speichern
      </Button>
    </>
  );
}
