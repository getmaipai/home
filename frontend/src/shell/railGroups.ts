import type { AppEntry } from "@/shell/appCatalog";

export const RAIL_GROUP_BY_APP_ID: Readonly<Record<string, string>> = {
  "/": "main",
  "/chat": "main",
  "/media": "main",
  "/files": "main",
  "/people": "main",
  "/companions": "household",
  "/house": "household",
  "/memory": "personal",
  "/settings": "tools",
  "/reminders": "tools",
  "/clock": "tools",
  "/activity": "tools",
};

export const RAIL_GROUPS: ReadonlyArray<{ id: string; label?: string }> = [
  { id: "main" },
  { id: "create", label: "Media" },
  { id: "personal", label: "Personal" },
  { id: "household", label: "Household" },
  { id: "tools", label: "Tools" },
] as const;

// Path matching is centralized so newly available package apps are grouped
// without a second copy of their catalog entries.
export function railGroupForApp(to: string): string {
  if (RAIL_GROUP_BY_APP_ID[to]) return RAIL_GROUP_BY_APP_ID[to]!;
  if (["/", "/chat", "/media", "/files", "/people"].includes(to)) return "main";
  if (/^\/apps\/(audio|video|image|pictures|voice|songs)(\/|$)/.test(to)) return "create";
  return "tools";
}

/** Audio, Video and Image are always in the menu: nobody has to pin them, and unpinning them changes nothing. */
export const ALWAYS_IN_RAIL: ReadonlySet<string> = new Set(["/apps/audio", "/apps/video", "/apps/image"]);

export function railItemsForCatalog(apps: readonly AppEntry[], pinned: readonly string[] = []) {
  const core = [
    { id: "/chat", label: "Chat", icon: "message-circle", href: "/chat", group: "main" },
    { id: "/media", label: "Media", icon: "cast", href: "/media", group: "main" },
    { id: "/files", label: "Library", icon: "folder", href: "/files", group: "main" },
    { id: "/people", label: "Family", icon: "users", href: "/people", group: "main" },
  ];
  const coreRoutes = new Set(["/chat", "/media", "/files", "/people"]);
  const pinnedSet = new Set(pinned);
  // Fixed shell destinations stay in the grouped list. Pinnable apps only
  // appear there when selected; defaults are supplied by usePinnedApps and
  // an explicitly saved empty list therefore remains empty. Audio, Video and Image
  // (ALWAYS_IN_RAIL) appear whatever the person pinned.
  return [...core, ...apps.filter((app) => !coreRoutes.has(app.to) && (ALWAYS_IN_RAIL.has(app.to) || pinnedSet.has(app.to))).map((app) => ({ id: app.to, label: app.label, icon: app.icon, href: app.to, group: railGroupForApp(app.to) }))];
}

export const AUTO_COLLAPSE_PREFIXES = ["/chat", "/settings", "/files", "/apps/audio", "/apps/video", "/apps/podcasts", "/apps/image"] as const;

export function routeAutoCollapses(pathname: string): boolean {
  return AUTO_COLLAPSE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Pages that fold the menu by themselves keep it folded unless the person opened it there (their click wins until they leave such pages). */
export function railAutoCollapseActive(pathname: string, userExpanded: boolean): boolean {
  return routeAutoCollapses(pathname) && !userExpanded;
}
