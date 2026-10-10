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
  const { pathname, search, hash } = useLocation();
  const destination = ALIASES[pathname] ?? pathname;
  const params = new URLSearchParams(search);
  if (pathname === "/conversations" && !params.has("list")) params.set("list", "1");
  const query = params.size > 0 ? `?${params}` : "";
  return <Navigate to={`${destination}${query}${hash}`} replace />;
}
