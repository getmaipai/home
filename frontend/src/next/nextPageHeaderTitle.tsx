"use client";

// CHAT-HEADER-02: the header's left slot (CHAT-HEADER-01's
// `HeaderExtraLeft`) shows the current app's icon before its title on
// every /next page, drawn from the one definition the sidebar already
// reads - never a second icon table. `SidebarContent` (commons
// `sidebaritems.ts`) is that definition for the four pages it lists
// (Home, Chat, Tools, People). The five "Manage" pages plus Settings
// (`sidebaritems.ts`'s own comment: ui-v0.5.23's ruling moved them off
// the rail entirely; Settings lives in `NavUser.tsx`'s bottom-of-rail
// slot instead, an inline array with no exported constant) have no
// sidebar entry to mirror at all - a review (2026-09-23) caught the
// first version of this file re-declaring each of those six pages'
// own icon choice a second time here, exactly the second table the
// objective says to avoid, with nothing keeping the two copies in
// sync. Each of those six pages now exports its own icon constant
// instead (`EnginesIcon`, `SettingsIcon`, `PerformanceIcon`,
// `UpdatesIcon`, `RepairsIcon`, `BackupsIcon`), imported here directly -
// one definition, that page's own, not a copy of it.
import { useLocation } from "react-router-dom";
import type { Icon } from "@maipai/ui/src/icons";
import SidebarContent from "@maipai/ui/src/dashboard/layouts/full/vertical/sidebar/sidebaritems";
import { SettingsIcon } from "@/next/pages/NextSettingsPage";
import { EnginesIcon } from "@/next/pages/NextEnginesPage";
import { PerformanceIcon } from "@/next/pages/NextPerformancePage";
import { UpdatesIcon } from "@/next/pages/NextUpdatesPage";
import { RepairsIcon } from "@/next/pages/NextRepairsPage";
import { BackupsIcon } from "@/next/pages/NextBackupsPage";
import { StorageIcon } from "@/next/pages/NextStoragePage";
import { VoicesIcon } from "@/next/pages/NextVoicesPage";
import { CommandsIcon } from "@/next/pages/NextCommandsPage";
import { DevicesIcon } from "@/next/pages/NextDevicesPage";
import { PrivacyIcon } from "@/next/pages/NextPrivacyPage";
import { UsersIcon } from "@/next/pages/NextUsersPage";
import { ModelsIcon } from "@/next/pages/NextModelsPage";

interface PageHeaderEntry {
  icon: Icon;
  label: string;
}

const sidebarEntries = new Map<string, PageHeaderEntry>();
for (const group of SidebarContent) {
  for (const item of group.items ?? []) {
    if (item.url && item.icon && item.name) {
      const path = item.url.replace(/^\/next(?=\/|$)/, "") || "/";
      sidebarEntries.set(path, { icon: item.icon, label: item.name });
    }
  }
}

const MANAGE_PAGE_ENTRIES: Record<string, PageHeaderEntry> = {
  "/settings": { icon: SettingsIcon, label: "Settings" },
  "/storage": { icon: StorageIcon, label: "Storage" },
  "/engines": { icon: EnginesIcon, label: "Engines" },
  "/performance": { icon: PerformanceIcon, label: "Performance" },
  "/updates": { icon: UpdatesIcon, label: "Updates" },
  "/repairs": { icon: RepairsIcon, label: "Repairs" },
  "/backups": { icon: BackupsIcon, label: "Backups" },
  "/voices": { icon: VoicesIcon, label: "Voices" },
  "/commands": { icon: CommandsIcon, label: "Commands" },
  "/devices": { icon: DevicesIcon, label: "Devices" },
  "/privacy": { icon: PrivacyIcon, label: "Privacy" },
  "/users": { icon: UsersIcon, label: "Users" },
  "/models": { icon: ModelsIcon, label: "AI models" },
};

function entryFor(pathname: string): PageHeaderEntry | undefined {
  if (pathname.startsWith("/people/")) return sidebarEntries.get("/people");
  return sidebarEntries.get(pathname) ?? MANAGE_PAGE_ENTRIES[pathname];
}

/** Mounted once per non-chat `/` page (`NextPageHeaderLayout` in
 * `NextRoutes.tsx`) - a stable module-level reference (`useHeaderExtra`'s
 * own requirement), reading the current route itself via `useLocation()`
 * rather than needing a fresh identity per page. Chat has its own icon,
 * prepended directly in `chatHeaderBar.tsx` instead of through this
 * lookup - it never mounts this component at all. */
export function NextPageHeaderTitle() {
  const location = useLocation();
  const entry = entryFor(location.pathname);
  // Unreachable in practice - NextPageHeaderLayout only wraps the exact
  // routes this table covers - but a route added to one and not the
  // other should read as a blank header slot, never a crash.
  if (!entry) return null;
  const PageIcon = entry.icon;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
      <PageIcon className="text-muted-foreground size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-base font-medium">{entry.label}</span>
    </div>
  );
}
