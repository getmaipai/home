import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@maipai/ui/src/dashboard/components/ui/tabs";
import { CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { NextSettingsRenderer } from "@/next/pages/settings/NextSettingsRenderer";
import { NextManageSection } from "@/next/pages/settings/NextManageSection";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/** /next/settings: SHELL-05's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - docs/SETTINGS.md's generic renderer
 * (`NextSettingsRenderer`) under the template's own `Tabs`/`TabsList`/
 * `TabsTrigger`/`TabsContent`, split Household vs Me exactly as
 * `SettingsPage.tsx`'s own tab switcher does (same two labels, same
 * owner/admin-only gate on the Household tab - a non-admin has nothing
 * to switch to, per that page's own comment, since household-scope
 * writes 403 for anyone else).
 *
 * Out of scope, named here rather than silently dropped: the retired
 * "one section tree" redesign (docs/dev/session-a-settings-rulings-
 * 2026-09-21.md) - link-out cards to Users/Models/Voices/Commands/
 * Devices, the Privacy things-table, Voice's top-choices row,
 * `@modified`/search filtering. This row is the registry-driven keys
 * only, the same ones `SettingsRenderer.tsx` already draws inline on
 * the old page; every dedicated management page (VOICE-BROWSER-01
 * among them) stays reachable only from the old shell until its own
 * row moves it - Backups/Repairs/Updates/Engines are the one exception
 * (`NextManageSection`, below): ui-v0.5.23's rail restructuring dropped
 * their permanent nav entry, so the Household tab's own bottom section
 * is now their real way back, not a settings key at all. */
export function NextSettingsPage({ person }: { person: Roster }) {
  useDocumentTitle("Settings");
  const canManageHousehold = isOwnerOrAdminRole(person.role);
  const [tab, setTab] = useState<"household" | "me">(canManageHousehold ? "household" : "me");
  const SettingsIcon = getIcon("settings");

  return (
    <div className="flex flex-col gap-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon size={16} className="text-muted-foreground" />
          Settings
        </CardTitle>
      </CardHeader>
      {canManageHousehold ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "household" | "me")}>
          <TabsList>
            <TabsTrigger value="household">Household</TabsTrigger>
            <TabsTrigger value="me">Me</TabsTrigger>
          </TabsList>
          <TabsContent value="household" className="flex flex-col gap-4">
            <NextSettingsRenderer scope="household" scopeValue="household" />
            <NextManageSection />
          </TabsContent>
          <TabsContent value="me" className="flex flex-col gap-4">
            <NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} />
          </TabsContent>
        </Tabs>
      ) : (
        // No tab bar to render for one destination (SettingsPage.tsx's
        // own comment): a non-admin has only their own settings to see,
        // household-scope writes 403 for anyone else.
        <NextSettingsRenderer scope="person" scopeValue={`person:${person.id}`} />
      )}
    </div>
  );
}
