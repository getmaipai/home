import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import legacyMap from "@maipai/spec/settings/legacy-sections.json";
import { placeForGroup, settingsPath } from "@/shell/pages/settings/settingsAreas";

const HOME_DEFAULT = settingsPath("household", "general");
const PERSONAL_DEFAULT = settingsPath("profile", "profile");
const mappings = legacyMap.mappings;
// STACK-MENU-SYNC-01: places that moved inside Settings (`moved` in legacy-sections.json): the old section or tab and the Stack tab that took it over.
const moved = (legacyMap as { moved?: Array<{ old: { section: string; tab?: string }; new: { section: string; tab?: string } }> }).moved ?? [];

/** Where an old Settings address (`/settings/ai?tab=engines`, `/settings/media?tab=styles`) lives now, or undefined when it did not move. A tab with no row of its own follows its section's row. */
export function movedSettingsTarget(section: string | undefined, tab: string | undefined, key?: string): string | undefined {
  if (!section) return undefined;
  const row = moved.find((candidate) => candidate.old.section === section && candidate.old.tab === tab && tab !== undefined) ?? moved.find((candidate) => candidate.old.section === section && candidate.old.tab === undefined);
  return row ? settingsPath(row.new.section, row.new.tab, key) : undefined;
}
const LEGACY_GROUPS: Record<string, readonly string[]> = {
  "household.ai": ["household.ai_advanced", "household.ai_models", "household.chat_pause", "household.ai_runtime", "household.ai_developer"],
  "household.network": ["household.network_port"],
};

export function legacySettingsSectionTarget(area: string, section: string, viewer: { canManageHousehold: boolean }, hash = ""): string {
  const mapping = mappings.find((row) => row.old.area === area && row.old.section === section);
  if (!mapping) return area === "home" ? HOME_DEFAULT : area === "chat" ? settingsPath("chat") : PERSONAL_DEFAULT;
  if (mapping.replacement) return settingsPath(mapping.replacement.section, undefined, hash.slice(1));
  if (mapping.new.section === "household" || ["privacy", "stack", "media", "home-voice", "search", "apps", "backups", "advanced"].includes(mapping.new.section)) {
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
  if (path === "/engines" || path === "/models") return viewer.canManageHousehold ? settingsPath("stack", "models") : PERSONAL_DEFAULT;
  if (path === "/devices") return settingsPath("profile", "profile");
  return undefined;
}

export function customizeTarget(band: "child" | "teen" | "adult"): string {
  return band === "child" ? settingsPath("chat") : settingsPath("chat", "skills");
}

/** The live alias map behind `App.tsx`'s `AliasRedirect`: an old path and where it lands. A path with no entry lands on itself. */
export function aliasTarget(path: string, viewer: { canManageHousehold: boolean }): string {
  const fixed: Record<string, string> = {
    "/settings/offline-data": settingsPath("search", "books"),
    "/conversations": "/chat",
    "/settings/users": settingsPath("household", "people"),
    // Keep the area in Settings; its Manage links lead to the standalone pages.
    "/settings/commands": settingsPath("home-voice", "commands"),
    "/settings/devices": settingsPath("profile", "profile"),
    "/settings/repairs": settingsPath("advanced"),
    "/settings/updates": "/updates",
    // AUDIT-UI-01: radio is a page of the Audio app (its Radio tab), not an app of its own.
    "/apps/radio": "/apps/audio/radio",
  };
  return fixed[path]
    ?? (path === "/settings/models" ? retiredManagePageTarget("/models", viewer) : undefined)
    ?? (path === "/settings/voices" ? retiredManagePageTarget("/voices", viewer) : undefined)
    ?? path;
}
