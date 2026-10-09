// Loads the committed spec/settings/keys.json (generated from
// declarations, see scripts/gen-settings-registry.ts) and validates every
// entry through the generated Zod schema, so a hand-edit or a generator
// bug is caught at boot, not at some later read. Reads through the
// installed @maipai/spec package (spec-v0.1.0 moved the registry out of
// this repo), the same self-contained-copy convention every other
// spec import here already uses - never a relative path escaping to the
// sibling checkout, which a deployed build won't have.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { AI_SETTINGS_KEYS } from "@/settings/aiKeys";
import { HOSTED_SEARCH_SETTINGS_KEYS } from "@/settings/hostedSearchKeys";
import { SPEC_DIR } from "./specDir.js";
import { areWakewordAssetsInstalled } from "@/lib/wakewordAssets";
import { WAKEWORD_SETTING_KEY } from "@/settings/wakewordKeys";
import { NOTIFICATION_SETTINGS_KEYS } from "@/settings/notificationKeys";
import { PERSON_STORAGE_CAP_KEY } from "@/settings/storageKeys";

const REGISTRY_PATH = join(SPEC_DIR, "settings", "keys.json");

// Package-owned location settings do not enter the core spec registry.
// They are supplied here until the weather and maps packages declare them.
export const PLACE_SETTINGS_KEYS = [
  ...(["weather", "maps"] as const).flatMap((surface) => [
    SettingsKey.parse({ key: `${surface}.places`, scope: "person", selector: "location", range: { multiple: true, allow_current: false }, default: [], label: `${surface === "weather" ? "Weather" : "Maps"} places`, help: "Places saved for this surface.", level: "basic", lives_in: surface, honoured_by: ["home"] }),
    SettingsKey.parse({ key: `${surface}.default_place`, scope: "person", selector: "location", range: { multiple: false, allow_current: true }, default: "current", label: `${surface === "weather" ? "Weather" : "Maps"} default place`, help: "The place used by default on this surface.", level: "basic", lives_in: surface, honoured_by: ["home"] }),
  ]),
];

// Transition alias: the current Home settings field still writes a name.
// It is kept outside the committed Commons registry and resolves through
// household.home in settings.ts until the shipped location selector lands.
const LEGACY_HOME_PLACE_KEY = SettingsKey.parse({ key: "household.home_place", scope: "household", selector: "text", default: "", label: "Household location", help: "The place MaiPai uses as the household fallback.", level: "basic", lives_in: "household.system", honoured_by: ["home", "bot"] });

function loadRegistry(): SettingsKey[] {
  const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as unknown[];
  const parsed = raw.map((entry) => SettingsKey.parse(entry));
  // AI declarations ship with Home's backend, while the shared settings
  // snapshot is pinned independently. Include newly added Home AI keys
  // until the shared snapshot is advanced.
  const keys = new Set(parsed.map((entry) => entry.key));
  // THIN-4H: search.brave_api_key likewise rides here until a commons spec tag carries it.
  const combined = [...parsed, ...[...AI_SETTINGS_KEYS, ...HOSTED_SEARCH_SETTINGS_KEYS, ...NOTIFICATION_SETTINGS_KEYS, ...PLACE_SETTINGS_KEYS, LEGACY_HOME_PLACE_KEY].filter((entry) => !keys.has(entry.key))];
  return combined.map(withPersonGuardFacts);
}

const CHILD_GUARDIAN_KEYS = new Set(["chat.photo_uploads", "reference.images"]);
const ADMIN_ONLY_KEYS = new Set([
  "security.session_lock_required",
  "security.session_lock_timeout_minutes",
  PERSON_STORAGE_CAP_KEY,
]);

/** C1 describes the existing guard and per-band defaults in the Home
 * registry. The current write checks remain in settings.ts and
 * chatPictures.ts; COPY-GUARD-READS-SPEC-01 will make them read these
 * fields later. */
function withPersonGuardFacts(key: SettingsKey): SettingsKey {
  if (key.scope !== "person") return key;
  const bandDefault = {
    child: key.key === "search.safe_search" ? "strict" : CHILD_GUARDIAN_KEYS.has(key.key) ? false : key.default,
    teen: key.key === "search.safe_search" ? "moderate" : key.default,
    adult: key.key === "search.safe_search" ? "off" : key.default,
  };
  const control = {
    child: CHILD_GUARDIAN_KEYS.has(key.key) || ADMIN_ONLY_KEYS.has(key.key) ? "guardian" : "self",
    teen: ADMIN_ONLY_KEYS.has(key.key) ? "guardian" : "self",
    adult: ADMIN_ONLY_KEYS.has(key.key) ? "guardian" : "self",
  };
  return SettingsKey.parse({ ...key, control: key.control ?? control, band_default: key.band_default ?? bandDefault });
}

let cached: SettingsKey[] | null = null;

export function getRegistry(): SettingsKey[] {
  if (!cached) cached = loadRegistry();
  // Wake-word controls are absent until the stock detector and its local
  // inference assets are actually on disk. The catalog package system does
  // not yet own wakeword installation; keep this gate tied to the real
  // downloadable asset state.
  return areWakewordAssetsInstalled() ? cached : cached.filter((key) => key.key !== WAKEWORD_SETTING_KEY);
}

export function getRegistryKey(key: string): SettingsKey | undefined {
  return getRegistry().find((k) => k.key === key);
}

/** Test-only: the registry is cached module state. */
export function __reloadRegistryForTests(): void {
  cached = null;
}
