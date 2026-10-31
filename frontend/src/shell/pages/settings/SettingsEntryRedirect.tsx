import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { customizeTarget, legacySettingsSectionTarget, legacySettingsTarget } from "@/shell/pages/settings/settingsRedirects";
import { viewerBand } from "@/shell/pages/settings/settingsViewer";
import { settingsPath } from "@/shell/pages/settings/settingsAreas";

/** `/settings` and every old `/settings?tab=...&section=...` link (and the
 * `/settings` ones SettingsEntryRedirect forwards here): replaces to the
 * page that holds it now. Only an old search link, which names a registry
 * group instead of a section, needs the registry to find its first key. */
export function SettingsEntryRedirect({ person }: { person: Roster }) {
  const { search, hash } = useLocation();
  const needsRegistry = new URLSearchParams(search).get("section")?.includes(".") === true;
  const registry = useQuery({ queryKey: ["settings-registry"], queryFn: () => api.settingsRegistry(), staleTime: Infinity, enabled: needsRegistry });
  if (needsRegistry && registry.isLoading) return null;
  return <Navigate to={legacySettingsTarget(search, hash, { canManageHousehold: isOwnerOrAdminRole(person.role) }, registry.data)} replace />;
}

/** Replaces the retired `/settings/home|account|chat/...` route family. */
export function LegacySettingsRedirect({ person }: { person: Roster }) {
  const { pathname, search, hash } = useLocation();
  const parts = pathname.split("/").filter(Boolean);
  const area = parts[1] ?? "";
  const section = parts[2] ?? "";
  const admin = isOwnerOrAdminRole(person.role);
  if (area === "home" && section === "robot") {
    const params = new URLSearchParams(search);
    const id = parts[3] ?? params.get("device");
    if (id) return <Navigate to={`${settingsPath("apps", params.get("tab") ?? "overview", undefined, id)}${hash}`} replace />;
    return <Navigate to={`/settings/apps?tab=robot${params.has("addRobot") ? "&addRobot=1" : ""}`} replace />;
  }
  if (!section) return <Navigate to={area === "home" ? "/settings/household" : area === "account" ? "/settings/profile" : "/settings/chat"} replace />;
  return <Navigate to={legacySettingsSectionTarget(area, section, { canManageHousehold: admin }, hash)} replace />;
}

/** `/customize` is gone: Skills live under Chat settings. */
export function CustomizeRedirect({ person }: { person: Roster }) {
  return <Navigate to={customizeTarget(viewerBand(person))} replace />;
}
