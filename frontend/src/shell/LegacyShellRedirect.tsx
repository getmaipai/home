import { Navigate, useLocation } from "react-router-dom";

/** Keep preview-era bookmarks and in-app links working after
 * the migrated shell moves to the root route. */
export function LegacyShellRedirect() {
  const { pathname, search, hash } = useLocation();
  const rootPath = pathname.replace(/^\/next(?=\/|$)/, "") || "/";
  const aliases: Record<string, string> = {
    "/conversations": "/chat",
    "/settings/users": "/users",
    "/settings/models": "/models",
    "/settings/backups": "/backups",
    "/settings/voices": "/voices",
    "/settings/commands": "/commands",
    "/settings/devices": "/devices",
    "/settings/repairs": "/repairs",
    "/settings/updates": "/updates",
  };
  const destination = aliases[rootPath] ?? rootPath;
  const nextSearch = new URLSearchParams(search);
  if (rootPath === "/conversations" && !nextSearch.has("list")) nextSearch.set("list", "1");
  const query = nextSearch.size > 0 ? `?${nextSearch}` : "";
  return <Navigate to={`${destination}${query}${hash}`} replace />;
}
