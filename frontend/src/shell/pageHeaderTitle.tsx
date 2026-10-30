"use client";

// CHAT-HEADER-02: the header's left slot (CHAT-HEADER-01's
// `HeaderExtraLeft`) shows the current app's icon before its title on
// every shell page, drawn from the one definition the sidebar already
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
import { useContext } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { settingsPath } from "@/shell/pages/settings/settingsAreas";
import { getIcon } from "@maipai/ui/src/icons";
import { isActiveNavPath } from "@maipai/ui/src/nav";
import { APP_CATALOG, type AppEntry } from "@/shell/appCatalog";
import { useAppCatalog } from "@/shell/useAppCatalog";
import type { Icon } from "@maipai/ui/src/icons";
import SidebarContent from "@maipai/ui/src/dashboard/layouts/full/vertical/sidebar/sidebaritems";
import { PerformanceIcon } from "@/shell/pages/PerformancePage";
import { UpdatesIcon } from "@/shell/pages/UpdatesPage";
import { RepairsIcon } from "@/shell/pages/RepairsPage";
import { BackupsIcon } from "@/shell/pages/BackupsPage";
import { StorageIcon } from "@/shell/pages/StoragePage";
import { VoicesIcon } from "@/shell/pages/VoicesPage";
import { CommandsIcon } from "@/shell/pages/CommandsPage";
import { PrivacyIcon } from "@/shell/pages/PrivacyPage";
import { UsersIcon } from "@/shell/pages/UsersPage";
import { NotificationsIcon } from "@/apps/notifications/NotificationsPage";
import { RemindersIcon } from "@/apps/reminders/remindersIcon";
import { StatusIcon } from "@/shell/pages/StatusPage";
import { ClockHeaderTitle } from "@/apps/clock/ClockHeaderTitle";

interface PageHeaderEntry {
  icon: Icon;
  label: string;
}

const sidebarEntries = new Map<string, PageHeaderEntry>();
for (const group of SidebarContent) {
  for (const item of group.items ?? []) {
    if (item.url && item.icon && item.name) {
      const path = item.url;
      sidebarEntries.set(path, { icon: item.icon, label: item.name });
    }
  }
}

const MANAGE_PAGE_ENTRIES: Record<string, PageHeaderEntry> = {
  "/storage": { icon: StorageIcon, label: "Storage" },
  "/status": { icon: StatusIcon, label: "Status" },
  "/performance": { icon: PerformanceIcon, label: "Performance" },
  "/updates": { icon: UpdatesIcon, label: "Updates" },
  "/repairs": { icon: RepairsIcon, label: "Repairs" },
  "/backups": { icon: BackupsIcon, label: "Backups" },
  "/voices": { icon: VoicesIcon, label: "Voices" },
  "/commands": { icon: CommandsIcon, label: "Commands" },
  "/privacy": { icon: PrivacyIcon, label: "Privacy" },
  "/users": { icon: UsersIcon, label: "Users" },
  "/notifications": { icon: NotificationsIcon, label: "Notifications" },
  "/reminders": { icon: RemindersIcon, label: "Reminders" },
  "/clock": { icon: getIcon("clock"), label: "Clock" },
};

// Core destinations the app catalog and the sidebar do not list (they sit in the rail's own core group): one row each, the same
// icon the rail draws.
const CORE_ENTRIES: Record<string, PageHeaderEntry> = {
  "/media": { icon: getIcon("cast"), label: "Media" },
  "/all-apps": { icon: getIcon("layout-grid"), label: "All apps" },
  "/reference": { icon: getIcon("book"), label: "Reference" },
};

/** The one answer to "which icon and name does this route's header show": the app or page the route belongs to, by the longest
 * matching path, so a page inside an app (News search, a Videos watch page, a person's profile) reads as that app. Every page and
 * app header draws this and nothing else: the title never comes from the page itself, and the page's body never repeats it. */
export function headerEntryFor(pathname: string, apps: readonly AppEntry[] = APP_CATALOG): PageHeaderEntry | undefined {
  const path = pathname.replace(/\/$/, "") || "/";
  const fromCatalog = [...apps].filter((app) => app.to !== "/").sort((a, b) => b.to.length - a.to.length).find((app) => isActiveNavPath(path, app.to));
  if (fromCatalog) return { icon: getIcon(fromCatalog.icon), label: fromCatalog.label };
  const known = [...Object.keys(CORE_ENTRIES), ...Object.keys(MANAGE_PAGE_ENTRIES), ...sidebarEntries.keys()].filter((to) => to !== "/").sort((a, b) => b.length - a.length).find((to) => isActiveNavPath(path, to));
  if (known) return CORE_ENTRIES[known] ?? MANAGE_PAGE_ENTRIES[known] ?? sidebarEntries.get(known);
  return path === "/" ? sidebarEntries.get("/") : undefined;
}

/** The icon and name, drawn once. `hideInTopRow` marks it for the phone layouts where a page places its own top row. */
export function HeaderTitle({ entry, hideInTopRow = false, heading = false }: { entry: PageHeaderEntry; hideInTopRow?: boolean; heading?: boolean }) {
  const EntryIcon = entry.icon;
  const Name = heading ? "h1" : "span";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 px-2" {...(hideInTopRow ? { "data-top-row-hide": "" } : {})}>
      <EntryIcon aria-hidden className="text-muted-foreground size-6 shrink-0" />
      <Name data-slot="header-title" className="min-w-0 flex-1 truncate text-xl font-semibold">{entry.label}</Name>
    </div>
  );
}

/** Mounted through `useHeaderExtra(PageHeaderTitle)` by every page and app: a stable module-level reference (the hook's own
 * requirement) that reads the current route itself. A route no table covers reads as a blank slot, never a crash. */
export function PageHeaderTitle() {
  const { pathname } = useLocation();
  const entry = headerEntryFor(pathname, useAppCatalog());
  // A package app has no other page heading, so its title is the page's h1; shell pages carry their own (sr-only) one.
  const isApp = pathname.startsWith("/apps/");
  if (pathname === "/clock") return <ClockHeaderTitle />;
  return entry ? <HeaderTitle entry={entry} hideInTopRow={isApp} heading={isApp} /> : null;
}

const GearIcon = getIcon("settings");

/** The shell pages' header buttons, by route (a stable module-level reference, as `useHeaderExtra` requires). A section's settings
 * button always sits on the header's right side, just left of the companion avatar: a page never draws its own. */
export function PageHeaderActions() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const person = useContext(WakeWordPersonContext);
  if (pathname !== "/" || !person || person.role === "guest") return null;
  return <><Button type="button" variant="ghost" size="icon" aria-label="Home layout" onClick={() => navigate(settingsPath("appearance", "appearance", "ui.home_layout"))}><GearIcon aria-hidden="true" /></Button></>;
}
