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
  { id: "create", label: "Create" },
  { id: "personal", label: "Personal" },
  { id: "household", label: "Household" },
  { id: "tools", label: "Tools" },
] as const;

// Path matching is centralized so newly available package apps are grouped
// without a second copy of their catalog entries.
export function railGroupForApp(to: string): string {
  if (RAIL_GROUP_BY_APP_ID[to]) return RAIL_GROUP_BY_APP_ID[to]!;
  if (["/", "/chat", "/media", "/files", "/people"].includes(to)) return "main";
  if (/^\/apps\/(music|videos|pictures|voice|songs)(\/|$)/.test(to)) return "create";
  return "tools";
}

export function railItemsForCatalog(apps: readonly AppEntry[], pinned: readonly string[] = []) {
  const core = [
    { id: "/chat", label: "Chat", icon: "message-circle", href: "/chat", group: "main" },
    { id: "/media", label: "Media", icon: "cast", href: "/media", group: "main" },
    { id: "/files", label: "Library", icon: "folder", href: "/files", group: "main" },
    { id: "/people", label: "Family", icon: "users", href: "/people", group: "main" },
  ];
  const coreRoutes = new Set(["/chat", "/media", "/files", "/people"]);
  const pinnedSet = new Set(pinned);
  const pinnable = new Set(["/reminders", "/clock", "/wikipedia", "/activity"]);
  return [...core, ...apps.filter((app) => !coreRoutes.has(app.to) && (!(app.to.startsWith("/apps/") || pinnable.has(app.to)) || pinnedSet.has(app.to))).map((app) => ({ id: app.to, label: app.label, icon: app.icon, href: app.to, group: railGroupForApp(app.to) }))];
}

export const AUTO_COLLAPSE_PREFIXES = ["/chat", "/settings", "/files", "/apps/music", "/apps/videos"] as const;

export function routeAutoCollapses(pathname: string): boolean {
  return AUTO_COLLAPSE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
