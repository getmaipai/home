import { Navigate, useLocation, useParams } from "react-router-dom";

/** `/memory`, `/memories`, and old profile memory tabs redirect to the
 * signed-in person's Account settings - a
 * component, not a bare `<Navigate to="...">`, so the old location's
 * own `?ids=<memory ids>` (chatMemoryChip.tsx's deep link, search's
 * memory results) carries over to the new URL instead of being
 * silently dropped. Its own file, not defined inline in App.tsx: that
 * module imports `@/i18n`, which `bun test` cannot load (no `.po`-file
 * loader) - kept out of the way so this component stays testable on
 * its own. */
export function MemoriesRedirect({ selfId }: { selfId: string }) {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const ids = query.get("ids");
  return <Navigate to={`/settings/account/data${ids ? `?ids=${encodeURIComponent(ids)}` : ""}`} replace state={{ selfId }} />;
}

export function LegacyProfileMemoriesRedirect({ selfId }: { selfId: string }) {
  const { id = "" } = useParams<{ id: string }>();
  const query = new URLSearchParams(useLocation().search);
  return <Navigate to={id === selfId ? `/settings/account/data${query.has("ids") ? `?ids=${encodeURIComponent(query.get("ids")!)}` : ""}` : "/settings/home/users"} replace />;
}
