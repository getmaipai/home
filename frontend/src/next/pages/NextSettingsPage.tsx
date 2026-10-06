import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@maipai/ui/src/dashboard/components/ui/tabs";
import { CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { NextSettingsRenderer } from "@/next/pages/settings/NextSettingsRenderer";
import { NextMeSettings } from "@/next/pages/settings/NextMeSettings";
import { NextHouseholdSettings } from "@/next/pages/settings/NextHouseholdSettings";
import { api, isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { meetsMinRole } from "@/apps/people/roles";
import { getDeviceSettingsScope } from "@/lib/deviceSettingsScope";
import { useTabItem } from "@/shell/tabIdentity";

// Exported: CHAT-HEADER-02's own nextPageHeaderTitle.tsx imports this
// directly for the header's left slot rather than re-declaring the
// icon name a second time - one definition, this page's own. Moved to
// module scope from inside the component (it was being recomputed on
// every render for no reason, the same as this file's sibling pages'
// own icon constants already are).
export const SettingsIcon = getIcon("settings");

/** /next/settings: SHELL-05's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - docs/SETTINGS.md's generic renderer
 * (`NextSettingsRenderer`) under the template's own `Tabs`/`TabsList`/
 * `TabsTrigger`/`TabsContent`, split Household vs Me exactly as
 * `SettingsPage.tsx`'s own tab switcher does (same two labels, same
 * owner/admin-only gate on the Household tab - a non-admin has nothing
 * to switch to, per that page's own comment, since household-scope
 * writes 403 for anyone else).
 *
 * The retired "one section tree" redesign (docs/dev/session-a-settings-
 * rulings-2026-09-21.md) is still out of scope, as are the Privacy
 * things-table, Voice's top-choices row, and `@modified`/search
 * filtering. This row remains the registry-driven keys only, the same
 * ones `SettingsRenderer.tsx` already draws inline on the old page.
 * Voices, Commands, and Devices now have their own routes and link-out
 * cards under Me below. Household's settings and management links are
 * grouped into their own sections. */
export function NextSettingsPage({ person, onPersonChange }: { person: Roster; onPersonChange?: () => void | Promise<void> }) {
  useTabItem("Settings");
  const canManageHousehold = isOwnerOrAdminRole(person.role);
  const canConfigureDevice = meetsMinRole(person.role, "adult");
  const registryQuery = useQuery({ queryKey: ["settings-registry"], queryFn: () => api.settingsRegistry() });
  const wakewordAssetsQuery = useQuery({ queryKey: ["wakeword-assets"], queryFn: () => api.wakewordStatus() });
  const hasDeviceWakeWord = wakewordAssetsQuery.data?.installed === true && Array.isArray(registryQuery.data) && registryQuery.data.some((entry) => entry.key === "voice.wakeword.enabled");
  const showDeviceSettings = canConfigureDevice && hasDeviceWakeWord;
  // SHELL-SEARCH-02: a search result for a setting names which tab it
  // lives on (`?tab=household|me`).
  const [searchParams] = useSearchParams();
  const tabFromParams = useCallback((): "household" | "me" | "device" => {
    const requested = searchParams.get("tab");
    if (requested === "me") return "me";
    if (requested === "device" && showDeviceSettings) return "device";
    if (requested === "household" && canManageHousehold) return "household";
    return canManageHousehold ? "household" : "me";
  }, [searchParams, showDeviceSettings, canManageHousehold]);
  const [tab, setTab] = useState<"household" | "me" | "device">(tabFromParams);
  // A review caught this: a lazy useState initializer runs once, at
  // mount - a person already on Settings (this component stays mounted
  // across a same-route navigation, react-router never remounts it for
  // a search-params-only change) who then clicks a SECOND search result
  // naming the other tab never saw it switch; the URL changed, the tab
  // didn't. Effect only ever moves `tab` toward what the URL now says,
  // never fights a person's own later click on a `TabsTrigger` - it
  // re-runs on every `searchParams` change, including the one `setTab`
  // itself never causes (choosing a tab by hand doesn't touch the URL).
  useEffect(() => {
    if (searchParams.get("tab") !== null) setTab(tabFromParams());
  }, [searchParams, tabFromParams]);

  return (
    <div className="flex flex-col gap-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon size={16} className="text-muted-foreground" />
          Settings
        </CardTitle>
      </CardHeader>
      {canManageHousehold || showDeviceSettings ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "household" | "me" | "device")}>
          <TabsList className="h-auto min-h-12 w-auto self-start">
            {canManageHousehold ? <TabsTrigger className="min-h-12 min-w-fit flex-none px-4" value="household">Household</TabsTrigger> : null}
            <TabsTrigger className="min-h-12 min-w-fit flex-none px-4" value="me">Me</TabsTrigger>
            {showDeviceSettings ? <TabsTrigger className="min-h-12 min-w-fit flex-none px-4" value="device">This device</TabsTrigger> : null}
          </TabsList>
          {canManageHousehold ? (
            <TabsContent value="household" className="flex flex-col gap-4">
              <NextHouseholdSettings />
            </TabsContent>
          ) : null}
          <TabsContent value="me" className="flex flex-col gap-4">
            <NextMeSettings person={person} onPersonChange={onPersonChange} />
          </TabsContent>
          {showDeviceSettings ? (
            <TabsContent value="device" className="flex flex-col gap-4">
              <NextSettingsRenderer scope="device" scopeValue={getDeviceSettingsScope()} />
            </TabsContent>
          ) : null}
        </Tabs>
      ) : (
        // No tab bar to render for one destination (SettingsPage.tsx's
        // own comment): a non-admin has only their own settings to see,
        // household-scope writes 403 for anyone else.
        <div className="flex flex-col gap-4">
          <NextMeSettings person={person} onPersonChange={onPersonChange} />
        </div>
      )}

    </div>
  );
}
