"use client";

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
import { Settings, Key, Sliders, Database, Info, Palette, Bell, Loader2 } from "lucide-react";

export default function SettingsPage() {
  const { isLoading } = useSettings();
  const form = useSettingsForm();
  const { systemInfo, fetchSystemInfo } = useSystemInfo();

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

      <Tabs
        defaultValue="general"
        onValueChange={(value) => value === "system" && fetchSystemInfo()}
      >
        <TabsList>
          <TabsTrigger value="general">
            <Settings />
            Allgemein
          </TabsTrigger>
          <TabsTrigger value="display">
            <Palette />
            Darstellung
          </TabsTrigger>
          <TabsTrigger value="api">
            <Key />
            API-Keys
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell />
            Benachrichtigungen
          </TabsTrigger>
          <TabsTrigger value="matching">
            <Sliders />
            Matching
          </TabsTrigger>
          <TabsTrigger value="cache">
            <Database />
            Cache
          </TabsTrigger>
          <TabsTrigger value="system">
            <Info />
            System
          </TabsTrigger>
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
