import { NAV_ENTRIES, type NavEntry } from "./nav";

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
  { to: "/people", icon: "users", label: "People", description: "Everyone who shares your home.", category: "Personal", keywords: ["family", "household"] },
  { to: "/privacy", icon: "shield-check", label: "Privacy", description: "Understand and control what you share.", category: "System", keywords: ["data", "security"] },
  { to: "/settings", icon: "settings", label: "Settings", description: "Make MaiPai feel like yours.", category: "System", keywords: ["preferences", "voice", "models"] },
].map((app) => ({ ...app, ...NAV_ENTRIES.find((entry) => entry.to === app.to) }));

export function filterApps(apps: readonly AppEntry[], query: string, category = "All apps", favorites?: readonly string[]): AppEntry[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return apps.filter((app) => (category === "All apps" || (category === "Favorites" ? favorites?.includes(app.to) : app.category === category)) &&
    words.every((word) => `${app.label} ${app.description} ${app.keywords.join(" ")}`.toLocaleLowerCase().includes(word)));
}

export function favoriteApps(pinned: readonly string[]): AppEntry[] {
  return [...new Set(pinned)].flatMap((to) => { const app = APP_CATALOG.find((entry) => entry.to === to); return app ? [app] : []; });
}
