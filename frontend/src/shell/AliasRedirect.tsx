import { Navigate, useLocation } from "react-router-dom";

const ALIASES: Record<string, string> = {
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

/** Keeps the Conversations bookmark and the old nested /settings/* paths
 * working: sends each to its current route, preserving query and hash. */
export function AliasRedirect() {
  const location = useLocation();
  const { search, hash } = location;
  // The router matches "/conversations/" too; without trimming, the lookup
  // misses and the redirect points at its own URL forever.
  const pathname = location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : location.pathname;
  const destination = ALIASES[pathname] ?? pathname;
  const params = new URLSearchParams(search);
  if (pathname === "/conversations" && !params.has("list")) params.set("list", "1");
  const query = params.size > 0 ? `?${params}` : "";
  return <Navigate to={`${destination}${query}${hash}`} replace />;
}
