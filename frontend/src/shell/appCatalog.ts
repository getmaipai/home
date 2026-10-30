import { NAV_ENTRIES, type NavEntry } from "./nav";
import type { AppRow } from "@/lib/api";

export interface AppEntry extends NavEntry {
  description: string;
  category: string;
  keywords: string[];
}

// Only registered, launchable routes belong here. Package apps can join
// this catalog when their frontend routes are registered.
export const APP_CATALOG: readonly AppEntry[] = [
  // Conversations is not a destination of its own (owner ruling,
  // "Navigation, corrected," 2026-09-20) - it's Chat's own thread list,
  // so it has no separate catalog entry to pin or search for anymore.
  { to: "/chat", icon: "message-circle", label: "Chat", description: "Ask, think, and talk things through.", category: "Everyday", keywords: ["assistant", "ai", "talk", "conversations", "history"] },
  // No NAV_ENTRIES counterpart anymore (owner ruling, "Navigation,
  // corrected," 2026-09-20 - Memories moved to a person's own profile,
  // off the rail): `/memory` still works, `MemoriesRedirect` sends it
  // to the signed-in person's own Memories tab, so this stays a real,
  // working catalog entry, just a standalone one now - the trailing
  // `.map(...NAV_ENTRIES.find(...))` below finds nothing for it and
  // leaves these fields exactly as written here, a code review's own
  // finding worth a comment so a future rename of "Memories" in
  // nav.ts doesn't wonder why this entry never follows it.
  { to: "/memory", icon: "brain", label: "Memories", description: "The details you want MaiPai to remember.", category: "Personal", keywords: ["remember", "saved", "memory"] },
  { to: "/companions", icon: "bot", label: "Companions", description: "Meet the companions and pick how your assistant sounds.", category: "Personal", keywords: ["personality", "persona", "voice", "character", "sprout", "nova", "riff"] },
  { to: "/people", icon: "users", label: "Family", description: "Everyone who shares your home.", category: "Personal", keywords: ["family", "household"] },
  { to: "/wikipedia", icon: "book-open", label: "Wikipedia", description: "Read Wikipedia from your own library, no internet needed.", category: "Everyday", keywords: ["encyclopedia", "articles", "reference", "look up", "learn", "kiwix"] },
  { to: "/privacy", icon: "shield-check", label: "Privacy", description: "Understand and control what you share.", category: "System", keywords: ["data", "security"] },
  { to: "/settings", icon: "settings", label: "Settings", description: "Make MaiPai feel like yours.", category: "System", keywords: ["preferences", "voice", "models"] },
].map((app) => ({ ...app, ...NAV_ENTRIES.find((entry) => entry.to === app.to) }));

export function filterApps(apps: readonly AppEntry[], query: string, category = "All apps", favorites?: readonly string[]): AppEntry[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return apps.filter((app) => (category === "All apps" || (category === "Favorites" ? favorites?.includes(app.to) : app.category === category)) &&
    words.every((word) => `${app.label} ${app.description} ${app.keywords.join(" ")}`.toLocaleLowerCase().includes(word)));
}

/** `apps` defaults to the static core list; the shell passes the merged list from `useAppCatalog`. A pinned
 * route with no entry (an uninstalled, disabled or role-hidden package app) is skipped here and stays in the
 * stored list, so a reinstall brings the pin back. */
export function favoriteApps(pinned: readonly string[], apps: readonly AppEntry[] = APP_CATALOG): AppEntry[] {
  return [...new Set(pinned)].flatMap((to) => { const app = apps.find((entry) => entry.to === to); return app ? [app] : []; });
}

/** One `GET /api/apps` row as a catalog entry. */
export function appEntryFromRow(row: AppRow): AppEntry {
  return { to: row.to, icon: row.icon, label: row.label, description: row.description, category: row.category, keywords: row.keywords };
}

/** The core apps plus the package apps the hub lists for this person. While Incognito is on, an app whose
 * manifest says `incognito: "blocked"` is left out (the hub cannot see the browser's Incognito state). */
export function mergeAppCatalog(rows: readonly AppRow[] | undefined, incognito: boolean): AppEntry[] {
  const packageApps = (rows ?? []).filter((row) => !(incognito && row.incognito === "blocked")).map(appEntryFromRow);
  const known = new Set(APP_CATALOG.map((app) => app.to));
  return [...APP_CATALOG, ...packageApps.filter((app) => !known.has(app.to))];
}

/** LEFTNAV-APPS-01: the routes a person who has never chosen their own pins starts with: every app whose manifest
 * says `pinned_by_default`, lowest `pin_order` first, then by name. The hub already left out the apps this person may
 * not open; the Incognito filter is `mergeAppCatalog`'s. */
export function defaultPinnedRoutes(rows: readonly AppRow[] | undefined): string[] {
  return (rows ?? [])
    .filter((row) => row.pinned_by_default)
    .sort((a, b) => (a.pin_order ?? 100) - (b.pin_order ?? 100) || a.label.localeCompare(b.label))
    .map((row) => row.to);
}

/** The package apps for the left rail and its launcher: pinned ones first in pin order, then the rest by name. The core
 * destinations (Home, Chat, Library, People) are the rail's own, so a pinned core route is not repeated here. */
export function railApps(apps: readonly AppEntry[], pinned: readonly string[]): Array<{ name: string; url: string; icon: string; description: string; pinned: boolean }> {
  const packageApps = apps.filter((app) => app.to.startsWith("/apps/"));
  const order = [...new Set(pinned)];
  const pinnedApps = order.flatMap((to) => packageApps.filter((app) => app.to === to));
  const rest = packageApps.filter((app) => !order.includes(app.to)).sort((a, b) => a.label.localeCompare(b.label));
  return [...pinnedApps.map((app) => ({ app, pinned: true })), ...rest.map((app) => ({ app, pinned: false }))]
    .map(({ app, pinned: isPinned }) => ({ name: app.label, url: app.to, icon: app.icon, description: app.description, pinned: isPinned }));
}
