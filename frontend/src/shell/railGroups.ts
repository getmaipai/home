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
  if (/^\/apps\/(music|videos)(\/|$)/.test(to)) return "create";
  if (to.startsWith("/apps/")) return "create";
  return "tools";
}

export function railItemsForCatalog(apps: readonly AppEntry[]) {
  const core = new Set(["/", "/chat", "/media", "/files", "/people"]);
  return apps.map((app) => ({ id: app.to, label: app.label, icon: app.icon, href: app.to, group: railGroupForApp(app.to) })).filter((item) => !core.has(item.href));
}

export const AUTO_COLLAPSE_PREFIXES = ["/chat", "/settings", "/files", "/apps/music", "/apps/videos"] as const;

export function routeAutoCollapses(pathname: string): boolean {
  return AUTO_COLLAPSE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
