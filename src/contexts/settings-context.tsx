"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

interface Settings {
  // General
  "download.path": string;
  "download.quality": string;
  "download.convertToMkv": string;

  // API Keys
  "api.tvdb.key": string;
  "api.tvdb.pin": string;
  "api.tmdb.key": string;

  // Matching
  "matching.strategy": string;
  "matching.threshold": string;
  "matching.minDuration": string;

  // Cache
  "cache.ttl.search": string;
  "cache.ttl.metadata": string;

  // System
  "system.setupComplete": string;

  [key: string]: string;
}

interface SettingsContextType {
  settings: Settings | null;
  isLoading: boolean;
  error: string | null;
  updateSetting: (key: string, value: string) => Promise<void>;
  updateSettings: (updates: Partial<Settings>) => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSetting = useCallback(async (key: string, value: string) => {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error("Failed to update setting");

      setSettings((prev) => (prev ? { ...prev, [key]: value } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      throw err;
    }
  }, []);

  const updateSettings = useCallback(async (updates: Partial<Settings>) => {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update settings");

      setSettings((prev) => {
        if (!prev) return null;
        const updated = { ...prev };
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            updated[key] = value;
          }
        }
        return updated;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      throw err;
    }
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        settings,
        isLoading,
        error,
        updateSetting,
        updateSettings,
        refreshSettings: fetchSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
