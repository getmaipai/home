import { Navigate, useLocation } from "react-router-dom";

/** `/memory` and `/memories` redirect to the signed-in person's own
 * profile (owner ruling, "Navigation, corrected," 2026-09-20) - a
 * component, not a bare `<Navigate to="...">`, so the old location's
 * own `?ids=<memory ids>` (chatMemoryChip.tsx's deep link, search's
 * memory results) carries over to the new URL instead of being
 * silently dropped. Its own file, not defined inline in App.tsx: that
 * module imports `@/i18n`, which `bun test` cannot load (no `.po`-file
 * loader) - kept out of the way so this component stays testable on
 * its own. */
export function MemoriesRedirect({ selfId }: { selfId: string }) {
  const location = useLocation();
  return <Navigate to={`/people/${selfId}?tab=memories${location.search ? `&${location.search.slice(1)}` : ""}`} replace />;
}
