"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Save } from "lucide-react";
import { useSettings } from "@/contexts/settings-context";
import { Button } from "@/components/ui/button";

/**
 * Unsaved edits of the settings page. The state lives in the page so edits survive
 * switching tabs; each tab saves only its own keys.
 */
export interface SettingsForm {
  getFieldValue: (key: string) => string;
  setFieldValue: (key: string, value: string) => void;
  save: (keys: string[]) => Promise<void>;
  isSaving: boolean;
}

export function useSettingsForm(): SettingsForm {
  const { settings, updateSettings } = useSettings();
  const [isSaving, setIsSaving] = useState(false);
  const [formState, setFormState] = useState<Record<string, string>>({});

  const getFieldValue = (key: string) => {
    return formState[key] ?? settings?.[key] ?? "";
  };

  const setFieldValue = (key: string, value: string) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const save = async (keys: string[]) => {
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

  return { getFieldValue, setFieldValue, save, isSaving };
}

export function SaveButton({
  saving,
  onClick,
  children = "Speichern",
}: {
  saving: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <Button onClick={onClick} disabled={saving}>
      {saving ? <Loader2 className="animate-spin" /> : <Save />}
      {children}
    </Button>
  );
}
