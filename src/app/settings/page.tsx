"use client";

import { useState } from "react";
import { ApiKeySettings } from "@/components/settings/api-key-settings";
import { CacheSettings } from "@/components/settings/cache-settings";
import { DisplaySettings } from "@/components/settings/display-settings";
import { GeneralSettings } from "@/components/settings/general-settings";
import { MatchingSettings } from "@/components/settings/matching-settings";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { useSettingsForm } from "@/components/settings/settings-form";
import { SystemSettings, useSystemInfo } from "@/components/settings/system-settings";
import { useSettings } from "@/contexts/settings-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Page, PageHeader } from "@/components/shared/page";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/shared/field";
import { Settings, Key, Sliders, Database, Info, Palette, Bell, Loader2 } from "lucide-react";

const sections = [
  { value: "general", label: "Allgemein", icon: Settings },
  { value: "display", label: "Darstellung", icon: Palette },
  { value: "api", label: "API-Keys", icon: Key },
  { value: "notifications", label: "Benachrichtigungen", icon: Bell },
  { value: "matching", label: "Matching", icon: Sliders },
  { value: "cache", label: "Cache", icon: Database },
  { value: "system", label: "System", icon: Info },
] as const;

export default function SettingsPage() {
  const { isLoading } = useSettings();
  const form = useSettingsForm();
  const { systemInfo, fetchSystemInfo } = useSystemInfo();
  const [tab, setTab] = useState<string>("general");

  const changeTab = (value: string) => {
    setTab(value);
    if (value === "system") void fetchSystemInfo();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4 md:p-6 lg:p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Page width="narrow">
      <PageHeader
        title="Einstellungen"
        description="Pfade, Quellen, Schlüssel und Abgleich von RundfunkArr konfigurieren."
      />

      <Tabs value={tab} onValueChange={changeTab} className="@container">
        {/* Phones get a native select; seven tabs never fit in one row there. */}
        <Field
          label="Bereich"
          htmlFor="settings-section"
          srOnlyLabel
          className="@min-[28rem]:hidden"
        >
          <Select id="settings-section" value={tab} onChange={(e) => changeTab(e.target.value)}>
            {sections.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {/*
          The bar adapts to its own width: icons and labels when everything fits, labels only
          from 44rem (desktop with sidebar), and below that only the active tab keeps its label.
          Hidden labels stay the accessible name; the title shows them on hover.
        */}
        <TabsList className="hidden @min-[28rem]:flex">
          {sections.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} title={label} className="group/tab">
              <Icon aria-hidden className="@min-[44rem]:hidden @min-[54rem]:block" />
              <span className="sr-only group-data-[state=active]/tab:not-sr-only @min-[44rem]:not-sr-only">
                {label}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <GeneralSettings form={form} />
        </TabsContent>

        <TabsContent value="display" className="space-y-4">
          <DisplaySettings form={form} />
        </TabsContent>

        <TabsContent value="api" className="space-y-4">
          <ApiKeySettings form={form} />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <NotificationSettings />
        </TabsContent>

        <TabsContent value="matching" className="space-y-4">
          <MatchingSettings form={form} />
        </TabsContent>

        <TabsContent value="cache" className="space-y-4">
          <CacheSettings form={form} />
        </TabsContent>

        <TabsContent value="system" className="space-y-4">
          <SystemSettings systemInfo={systemInfo} onRefresh={fetchSystemInfo} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
