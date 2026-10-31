import { isActiveNavPath } from "@maipai/ui/src/nav";
import { NAV_ENTRIES } from "@/shell/nav";
import { greetingFor } from "@/apps/home/greeting";
import { APP_CATALOG, type AppEntry } from "@/shell/appCatalog";
import type { Roster } from "@/lib/api";

interface RouteHeaderOverride {
  to: string;
  title: string;
  subtitle: string | ((person: Roster) => string);
}

// Routes with no app-catalog entry (Home itself and the two
// header-reachable-only destinations, Search and Notifications) - every
// other destination's title and subtitle come straight from
// APP_CATALOG (shell/appCatalog.ts, itself built from NAV_ENTRIES'
// labels) below, not retyped here: a second copy of the same sentence
// is exactly how "Memory" becoming "Memories" broke this file's own
// search keywords elsewhere in this diff.
const ROUTE_HEADER_OVERRIDES: RouteHeaderOverride[] = [
  { to: "/", title: "Home", subtitle: (person) => `${greetingFor(new Date(), person.display_name)}. Here is your household today.` },
  { to: "/search", title: "Search", subtitle: "Find anything across your household." },
  { to: "/notifications", title: "Notifications", subtitle: "What MaiPai has told you." },
];

export interface RouteHeader {
  title: string;
  subtitle: string;
}

/** The catalog title for a route (overrides first), or undefined when no catalog entry covers it. */
export function routeTitle(pathname: string, apps: readonly AppEntry[] = APP_CATALOG): string | undefined {
  const override = [...ROUTE_HEADER_OVERRIDES].sort((a, b) => b.to.length - a.to.length).find((candidate) => isActiveNavPath(pathname, candidate.to));
  if (override) return override.title;
  return [...apps, ...NAV_ENTRIES].sort((a, b) => b.to.length - a.to.length).find((entry) => isActiveNavPath(pathname, entry.to) && entry.to !== "/")?.label;
}

export function routeHeader(pathname: string, person: Roster, apps: readonly AppEntry[] = APP_CATALOG): RouteHeader {
  // Longest `to` first, so "/settings/models" matches "/settings"
  // rather than accidentally the root "/" entry (isActiveNavPath's own
  // segment-boundary rule keeps "/media" from matching "/media-library",
  // but every non-root entry is itself under "/").
  const override = [...ROUTE_HEADER_OVERRIDES].sort((a, b) => b.to.length - a.to.length).find((candidate) => isActiveNavPath(pathname, candidate.to));
  if (override) return { title: override.title, subtitle: typeof override.subtitle === "function" ? override.subtitle(person) : override.subtitle };
  const catalogEntry = [...apps].sort((a, b) => b.to.length - a.to.length).find((entry) => isActiveNavPath(pathname, entry.to));
  if (catalogEntry) return { title: catalogEntry.label, subtitle: catalogEntry.description };
  return { title: "MaiPai Home", subtitle: "" };
}
