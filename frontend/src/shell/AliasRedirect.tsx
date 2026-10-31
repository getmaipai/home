import { Navigate, useLocation } from "react-router-dom";

/** Keeps legacy aliases working, preserving the original query and hash. */
export function AliasRedirect() {
  const location = useLocation();
  const { search, hash } = location;
  const pathname = location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : location.pathname;
  const destination = pathname === "/settings/models" ? "/settings/ai?tab=overview"
    : pathname === "/settings/users" ? "/settings/household?tab=people"
      : pathname === "/settings/voices" ? "/settings/home-voice?tab=voices"
          : pathname === "/settings/backups" ? "/backups"
          : pathname === "/settings/commands" ? "/settings/home-voice?tab=commands"
            : pathname === "/settings/devices" ? "/settings/profile?tab=profile"
              : pathname === "/settings/repairs" ? "/settings/advanced"
                : pathname === "/settings/updates" ? "/settings/backups?tab=updates"
                  : pathname === "/conversations" ? "/chat" : pathname;
  const params = new URLSearchParams(search);
  if (pathname === "/settings/devices" && !params.has("tab")) params.set("tab", "profile");
  if (pathname === "/conversations" && !params.has("list")) params.set("list", "1");
  const query = params.size > 0 ? `?${params}` : "";
  return <Navigate to={`${destination}${query}${hash}`} replace />;
}
