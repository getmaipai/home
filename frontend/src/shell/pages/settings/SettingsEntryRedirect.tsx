import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { customizeTarget, legacySettingsTarget } from "@/shell/pages/settings/settingsRedirects";
import { viewerBand } from "@/shell/pages/settings/settingsViewer";

/** `/settings` and every old `/settings?tab=...&section=...` link (and the
 * `/settings` ones LegacyShellRedirect forwards here): replaces to the
 * page that holds it now. Only an old search link, which names a registry
 * group instead of a section, needs the registry to find its first key. */
export function SettingsEntryRedirect({ person }: { person: Roster }) {
  const { search, hash } = useLocation();
  const needsRegistry = new URLSearchParams(search).get("section")?.includes(".") === true;
  const registry = useQuery({ queryKey: ["settings-registry"], queryFn: () => api.settingsRegistry(), staleTime: Infinity, enabled: needsRegistry });
  if (needsRegistry && registry.isLoading) return null;
  return <Navigate to={legacySettingsTarget(search, hash, { canManageHousehold: isOwnerOrAdminRole(person.role) }, registry.data)} replace />;
}

/** `/customize` is gone: Skills live under Chat settings. */
export function CustomizeRedirect({ person }: { person: Roster }) {
  return <Navigate to={customizeTarget(viewerBand(person))} replace />;
}
