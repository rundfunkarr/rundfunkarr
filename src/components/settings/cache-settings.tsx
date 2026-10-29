"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { SaveButton, type SettingsForm } from "@/components/settings/settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/shared/field";
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

export function CacheSettings({ form }: { form: SettingsForm }) {
  const { getFieldValue, setFieldValue, save: handleSave, isSaving } = form;
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

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Cache</CardTitle>
          <CardDescription>
            Der Cache speichert Daten temporär, um wiederholte Anfragen zu beschleunigen. Die TTL
            (Time-to-Live) bestimmt, wie lange Daten im Cache bleiben, bevor sie neu geladen werden.
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
    </>
  );
}
