import { isActiveNavPath } from "@maipai/ui/src/nav";
import { greetingFor } from "@/apps/home/greeting";
import { APP_CATALOG } from "@/shell/appCatalog";
import type { Roster } from "@/lib/api";

interface RouteHeaderOverride {
  to: string;
  title: string;
  subtitle: string | ((person: Roster) => string);
}

// Routes with no app-catalog entry (Home itself, Apps, and the two
// header-reachable-only destinations, Search and Notifications) - every
// other destination's title and subtitle come straight from
// APP_CATALOG (shell/appCatalog.ts, itself built from NAV_ENTRIES'
// labels) below, not retyped here: a second copy of the same sentence
// is exactly how "Memory" becoming "Memories" broke this file's own
// search keywords elsewhere in this diff.
const ROUTE_HEADER_OVERRIDES: RouteHeaderOverride[] = [
  { to: "/", title: "Home", subtitle: (person) => `${greetingFor(new Date(), person.display_name)}. Here is your household today.` },
  { to: "/apps", title: "Apps", subtitle: "Everything installed on this hub." },
  { to: "/search", title: "Search", subtitle: "Find anything across your household." },
  { to: "/notifications", title: "Notifications", subtitle: "What MaiPai has told you." },
];

export interface RouteHeader {
  title: string;
  subtitle: string;
}

export function routeHeader(pathname: string, person: Roster): RouteHeader {
  // Longest `to` first, so "/settings/models" matches "/settings"
  // rather than accidentally the root "/" entry (isActiveNavPath's own
  // segment-boundary rule keeps "/media" from matching "/media-library",
  // but every non-root entry is itself under "/").
  const override = [...ROUTE_HEADER_OVERRIDES].sort((a, b) => b.to.length - a.to.length).find((candidate) => isActiveNavPath(pathname, candidate.to));
  if (override) return { title: override.title, subtitle: typeof override.subtitle === "function" ? override.subtitle(person) : override.subtitle };
  const catalogEntry = [...APP_CATALOG].sort((a, b) => b.to.length - a.to.length).find((entry) => isActiveNavPath(pathname, entry.to));
  if (catalogEntry) return { title: catalogEntry.label, subtitle: catalogEntry.description };
  return { title: "MaiPai Home", subtitle: "" };
}
