// The phone menu drawer draws no All apps button and no Companions entry: the kit's rail shows the All apps button from
// wide screens up, and Companions is a core page, not a package app. The shell adds both here, through the drawer's own
// `mobileSections` slot, so a phone reaches every app the desktop rail's grid button opens.
import { Link } from "react-router-dom";
import { getIcon } from "@maipai/ui/src/icons";
import { ALL_APPS_PATH } from "@/shell/allAppsPath";
import { filterApps, type AppEntry } from "@/shell/appCatalog";
import type { SearchGroup } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderSearch";
import { api } from "@/lib/api";

const ENTRIES = [
  { to: ALL_APPS_PATH, label: "All apps", icon: "layout-grid" },
  { to: "/companions", label: "Companions", icon: "bot" },
] as const;

export function PhoneMenuLinks() {
  return <nav aria-label="More" className="flex flex-col gap-1">
    {ENTRIES.map((entry) => {
      const Icon = getIcon(entry.icon);
      return <Link key={entry.to} to={entry.to} className="relative flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-foreground hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"><Icon aria-hidden className="size-5" /><span>{entry.label}</span></Link>;
    })}
  </nav>;
}

/** The header search's Apps group for the core pages (Companions, Memories, Settings, ...). The hub's own search answers
 * for installed package apps, whose routes start /apps/, so those are left out here to avoid listing them twice. */
export function coreAppsGroup(query: string, apps: readonly AppEntry[]): SearchGroup | null {
  const results = filterApps(apps.filter((app) => !app.to.startsWith("/apps/")), query)
    .map((app) => ({ kind: "app", id: `core-app:${app.to}`, title: app.label, subtitle: app.description, href: app.to }));
  return results.length ? { kind: "app", heading: "Apps", results } : null;
}

/** One search for the header: the core apps first, then whatever the hub finds. A hub that cannot answer still leaves the apps. */
export async function searchWithCoreApps(query: string, apps: readonly AppEntry[]): Promise<SearchGroup[]> {
  const core = coreAppsGroup(query, apps);
  const hub = await api.search(query).catch(() => [] as SearchGroup[]);
  return core ? [core, ...hub.filter((group) => group.kind !== "app" || group.results.some((r) => r.href.startsWith("/apps/")))] : hub;
}
