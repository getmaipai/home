import { useQuery } from "@tanstack/react-query";
import { favoriteApps } from "@/shell/appCatalog";
import { useAppCatalog } from "@/shell/useAppCatalog";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { runSearchProviders, type SearchGroup, type SearchResultItem } from "@/shell/search/providers";

/** The one query behind every search-or-chat box (docs/BACKLOG.md: "This
 * is the same prompt box the home-screen item above describes; build it
 * once") - `SearchPage` (Cmd/Ctrl+K on the far surface) and `HomePage.tsx`'s
 * own prompt box (lane 9 item 1) both call this, so a query has to only
 * ever be answered one way. `personId` is what a launcher needs for its
 * own Favorites row (`usePinnedApps`, the sidebar's own `pinnedIds`); a
 * surface with no notion of "this person" (none exists yet) would just
 * pass one anyway - every signed-in surface already has a real person. */
export function useSearchCommand(personId: string, query: string, enabled = true) {
  const { pinned } = usePinnedApps(personId);
  const apps = useAppCatalog();
  const trimmed = query.trim();

  // Gated on a real query, not just `enabled`: the empty-query state
  // (Favorites/Apps below, both local, no fetch) is what every surface
  // shows before anyone types a thing - `HomePage.tsx`'s own prompt box
  // mounts on every Home load, and firing five provider fetches
  // (people, memories, conversations, settings, commands) before a
  // household member has asked for anything would be exactly the
  // unprompted background traffic CLAUDE.md's "only what the user asked
  // for" rules out, even for same-origin calls.
  const { data: groups } = useQuery({
    queryKey: ["search", query, apps.length],
    queryFn: () => runSearchProviders(query, apps),
    enabled: enabled && trimmed !== "",
    placeholderData: (previous) => previous,
  });

  const localFavorites = trimmed ? [] : favoriteApps(pinned, apps).slice(0, 6);
  const toItem = (app: (typeof apps)[number]): SearchResultItem => ({
    id: `app:${app.to}`,
    label: app.label,
    sublabel: app.description,
    icon: app.icon,
    to: app.to,
  });
  const visibleGroups: SearchGroup[] = [
    { heading: "Favorites", items: localFavorites.map(toItem) },
    // `groups` can still hold the previous query's data here: `placeholderData`
    // keeps showing it even once the query is disabled again (cleared back to
    // ""), since TanStack Query computes it from `status`, not `fetchStatus`.
    // Guard on `trimmed` directly rather than trusting the query's own data.
    ...(trimmed === "" ? [] : (groups ?? []).filter((group) => group.heading !== "Apps")),
  ].filter((group) => group.items.length > 0);

  return { visibleGroups, trimmed, hasResults: visibleGroups.length > 0 };
}
