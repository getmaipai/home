import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import legacyMap from "@maipai/spec/settings/legacy-sections.json";
import { placeForGroup, settingsPath } from "@/shell/pages/settings/settingsAreas";

const HOME_DEFAULT = settingsPath("household", "general");
const PERSONAL_DEFAULT = settingsPath("profile", "profile");
const mappings = legacyMap.mappings;
const LEGACY_GROUPS: Record<string, readonly string[]> = {
  "household.ai": ["household.ai_advanced", "household.ai_models", "household.chat_pause", "household.ai_runtime", "household.ai_developer"],
  "household.network": ["household.network_port"],
};

export function legacySettingsSectionTarget(area: string, section: string, viewer: { canManageHousehold: boolean }, hash = ""): string {
  const mapping = mappings.find((row) => row.old.area === area && row.old.section === section);
  if (!mapping) return area === "home" ? HOME_DEFAULT : area === "chat" ? settingsPath("chat") : PERSONAL_DEFAULT;
  if (mapping.replacement) return settingsPath(mapping.replacement.section, undefined, hash.slice(1));
  if (mapping.new.section === "household" || ["privacy", "ai", "media", "home-voice", "search", "apps", "backups", "advanced"].includes(mapping.new.section)) {
    if (!viewer.canManageHousehold) return settingsPath(mapping.new.section, mapping.new.tab, hash.slice(1));
  }
  return settingsPath(mapping.new.section, mapping.new.tab, hash.slice(1));
}

export function legacySettingsTarget(search: string, hash: string, viewer: { canManageHousehold: boolean }, registry: readonly SettingsKey[] | undefined): string {
  const params = new URLSearchParams(search);
  const section = params.get("section");
  const oldTab = params.get("tab");
  const key = hash.startsWith("#") ? hash.slice(1) : undefined;
  if (section && !section.includes(".")) {
    if (oldTab === "me" && section === "chat") return settingsPath("chat", undefined, key);
    const oldArea = oldTab === "household" ? "home" : oldTab === "me" ? "account" : oldTab === "device" ? "account" : "chat";
    const target = legacySettingsSectionTarget(oldArea, section, viewer, hash);
    if (oldTab === "device") return settingsPath("voice", "device", key);
    return target;
  }
  if (section?.includes(".")) {
    const scope = oldTab === "household" ? "household" : "person";
    const candidates = placeForGroup(section, scope) ? [section] : LEGACY_GROUPS[section] ?? [section];
    for (const group of candidates) {
      const place = placeForGroup(group, scope);
      if (!place) continue;
      const first = key ?? registry?.find((entry) => entry.lives_in === group && entry.scope === scope && entry.level !== "expert")?.key;
      return settingsPath(place.section, place.tab, first);
    }
    return scope === "household" ? HOME_DEFAULT : PERSONAL_DEFAULT;
  }
  if (oldTab === "household") return viewer.canManageHousehold ? HOME_DEFAULT : PERSONAL_DEFAULT;
  if (oldTab === "device") return settingsPath("voice", "device", key);
  return PERSONAL_DEFAULT;
}

export function retiredManagePageTarget(pathname: string, viewer: { canManageHousehold: boolean }): string | undefined {
  const path = pathname.replace(/\/$/, "");
  if (path === "/voices") return viewer.canManageHousehold ? settingsPath("home-voice", "voices") : settingsPath("voice", "voice");
  if (path === "/engines" || path === "/models") return viewer.canManageHousehold ? settingsPath("ai", "overview") : PERSONAL_DEFAULT;
  if (path === "/devices") return settingsPath("profile", "profile");
  return undefined;
}

export function customizeTarget(band: "child" | "teen" | "adult"): string {
  return band === "child" ? settingsPath("chat") : settingsPath("chat", "skills");
}
