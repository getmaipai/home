// APP-SET-02: where every old settings URL goes now (design section 5).
// Pure, so each row of the table is a test. The old page was one URL,
// `/settings?tab=<me|household|device>&section=<id or lives_in>`; the areas
// are `/settings/<area>/<section>`.
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { placeForGroup, settingsPath } from "@/shell/pages/settings/settingsAreas";

/** Old Me-tab section ids, and where each lives now. */
const ME_SECTIONS: Record<string, readonly [string, string]> = {
  profile: ["account", "profile"],
  appearance: ["account", "appearance"],
  chat: ["chat", "general"],
  skills: ["chat", "skills"],
  "voice-ai": ["account", "voice"],
  notifications: ["account", "notifications"],
  "privacy-data": ["account", "data"],
};

/** Old Household-tab section ids; each kept its id under Home settings. */
const HOME_SECTIONS = new Set(["general", "people", "ai", "integrations", "storage", "maintenance"]);

const ACCOUNT = settingsPath("account");

export function legacySettingsTarget(search: string, hash: string, viewer: { canManageHousehold: boolean }, registry: readonly SettingsKey[] | undefined): string {
  const params = new URLSearchParams(search);
  const section = params.get("section");
  if (!params.has("tab") && !section) return ACCOUNT;
  const tab = params.get("tab") ?? (section && ME_SECTIONS[section] ? "me" : viewer.canManageHousehold ? "household" : "me");
  const keyFromHash = hash.startsWith("#") && hash.length > 1 ? hash.slice(1) : undefined;

  if (tab === "device") return settingsPath("account", "device", keyFromHash);
  if (tab === "household" && !viewer.canManageHousehold) return ACCOUNT;
  const scope = tab === "household" ? "household" : "person";

  // An old search link: `section` is a registry group (`lives_in`), so it
  // lands on the card that draws it, at that group's first key.
  if (section?.includes(".")) {
    const place = placeForGroup(section, scope);
    if (!place) return tab === "household" ? settingsPath("home", "general") : ACCOUNT;
    const first = keyFromHash ?? registry?.find((k) => k.lives_in === section && k.scope === scope && k.level !== "expert")?.key;
    return settingsPath(place.area, place.section, first);
  }

  if (tab === "household") return settingsPath("home", section && HOME_SECTIONS.has(section) ? section : "general", keyFromHash);
  const place = section ? ME_SECTIONS[section] : undefined;
  return place ? settingsPath(place[0], place[1], keyFromHash) : ACCOUNT;
}

/** ENGINES-AI-01: the Manage pages that moved into Home settings. Each old route lands on the section that holds its
 * content now; a viewer who may not manage the household lands on Account, as every Home settings link does for them.
 * `/engines` and `/models` are both the Engines and AI section (its trail view draws the engines console and the model
 * list); `/voices` is the Voices section for an admin and the person's own Voice section for anyone else. `/users` stays
 * a page until the spec's People section draws the user list (see the report's commons order), so it is not here. */
export function retiredManagePageTarget(pathname: string, viewer: { canManageHousehold: boolean }): string | undefined {
  const path = pathname.replace(/\/$/, "");
  if (path === "/voices") return viewer.canManageHousehold ? settingsPath("home", "voices") : settingsPath("account", "voice");
  if (path === "/engines" || path === "/models") return viewer.canManageHousehold ? settingsPath("home", "ai") : ACCOUNT;
  return undefined;
}

/** `/customize` is gone; Skills moved under Chat settings. A child has no
 * Skills, so they land on Chat settings. */
export function customizeTarget(band: "child" | "teen" | "adult"): string {
  return band === "child" ? settingsPath("chat") : settingsPath("chat", "skills");
}
