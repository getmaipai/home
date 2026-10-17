// Loads the committed spec/settings/keys.json (generated from
// declarations, see scripts/gen-settings-registry.ts) and validates every
// entry through the generated Zod schema, so a hand-edit or a generator
// bug is caught at boot, not at some later read. Reads through the
// installed @maipai/spec package (spec-v0.1.0 moved the registry out of
// this repo), the same self-contained-copy convention every other
// spec import here already uses - never a relative path escaping to the
// sibling checkout, which a deployed build won't have.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { AI_SETTINGS_KEYS } from "@/settings/aiKeys";
import { HOSTED_SEARCH_SETTINGS_KEYS } from "@/settings/hostedSearchKeys";
import { MINOR_DDGS_SETTINGS_KEYS, MINOR_DDGS_KEY } from "@/settings/minorDdgsKeys";
import { ddgsConfigured } from "@/lib/retrieval/ddgsConfig";
import { SPEC_DIR } from "./specDir.js";
import { PACKAGES_DIR } from "./paths";
import { areWakewordAssetsInstalled } from "@/lib/wakewordAssets";
import { WAKEWORD_SETTING_KEY } from "@/settings/wakewordKeys";
import { NOTIFICATION_SETTINGS_KEYS } from "@/settings/notificationKeys";
import { PERSON_STORAGE_CAP_KEY } from "@/settings/storageKeys";
import { REFERENCE_SETTINGS_KEYS } from "@/settings/referenceKeys";
import { PICTURE_SETTINGS_KEYS } from "@/settings/pictureKeys";
import { VOICE_SETTINGS_KEYS } from "@/settings/voiceKeys";

const RETIRED_WIKIPEDIA_FALLBACK_KEY = "search.wikipedia_fallback";
const REGISTRY_PATH = join(SPEC_DIR, "settings", "keys.json");

// Maps still has no bundled package, so its two location keys ride here
// until PLACE-MAPS-01 ships the package that declares them.
export const PLACE_SETTINGS_KEYS = [
  SettingsKey.parse({ key: "maps.places", scope: "person", selector: "location", range: { multiple: true, allow_current: false }, default: [], label: "Maps places", help: "Places saved for this surface.", level: "basic", lives_in: "maps", honoured_by: ["home"] }),
  SettingsKey.parse({ key: "maps.default_place", scope: "person", selector: "location", range: { multiple: false, allow_current: true }, default: "current", label: "Maps default place", help: "The place used by default on this surface.", level: "basic", lives_in: "maps", honoured_by: ["home"] }),
];

/** Settings a bundled package declares in its manifest `config[]`. They load
 * through the same SettingsKey schema as the spec registry, so a malformed
 * declaration fails at boot instead of at the first read. */
function bundledPackageKeys(): SettingsKey[] {
  if (!existsSync(PACKAGES_DIR)) return [];
  const seen = new Set<string>();
  return readdirSync(PACKAGES_DIR).sort().flatMap((id) => {
    const path = join(PACKAGES_DIR, id, "manifest.json");
    if (!existsSync(path)) return [];
    const config = (JSON.parse(readFileSync(path, "utf-8")) as { config?: unknown[] }).config;
    return (Array.isArray(config) ? config.map((entry) => SettingsKey.parse(entry)) : []).filter((entry) => !seen.has(entry.key) && !!seen.add(entry.key));
  });
}

// Transition alias: the current Home settings field still writes a name.
// It is kept outside the committed Commons registry and resolves through
// household.home in settings.ts until the shipped location selector lands.

function loadRegistry(): SettingsKey[] {
  const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as unknown[];
  // KS-MODE-01: spec-v0.1.116 still declares the retired search.wikipedia_fallback.
  // Nothing reads it any more, so it must not show or be settable until a commons tag drops it.
  const parsed = raw.map((entry) => SettingsKey.parse(entry)).filter((entry) => entry.key !== RETIRED_WIKIPEDIA_FALLBACK_KEY);
  // AI declarations ship with Home's backend, while the shared settings
  // snapshot is pinned independently. Include newly added Home AI keys
  // until the shared snapshot is advanced.
  const keys = new Set(parsed.map((entry) => entry.key));
  // THIN-4H: search.brave_api_key likewise rides here until a commons spec tag carries it.
  const combined = [...parsed, ...[...AI_SETTINGS_KEYS, ...HOSTED_SEARCH_SETTINGS_KEYS, ...MINOR_DDGS_SETTINGS_KEYS, ...NOTIFICATION_SETTINGS_KEYS, ...REFERENCE_SETTINGS_KEYS, ...PICTURE_SETTINGS_KEYS, ...VOICE_SETTINGS_KEYS, ...PLACE_SETTINGS_KEYS, ...bundledPackageKeys()].filter((entry) => !keys.has(entry.key))];
  return combined.map(withPersonGuardFacts);
}

// INITIATIVE-01: person.robot.may_address is guardian-set for a child too (assertCanSetRobotMayAddress in settings.ts).
// FOLLOWUP-01 makes person.robot.follow_up the same (off for a child until a parent saves it).
const CHILD_GUARDIAN_KEYS = new Set(["chat.photo_uploads", "reference.images", "person.robot.may_address", "person.robot.follow_up"]);
// FACE-WATCH-01: a child's own watch level is the parent's to choose; the default stays `presence` (a select, not a boolean).
const CHILD_GUARDIAN_CONTROL_ONLY_KEYS = new Set(["person.vision.watch"]);
// MINOR-TOPICS-01e: a child's sensitive-subject levels are guardian-set (assertCanSetChildTopic in settings.ts).
const isChildTopicKey = (key: string) => key.startsWith("topics.");
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
    child: CHILD_GUARDIAN_KEYS.has(key.key) || CHILD_GUARDIAN_CONTROL_ONLY_KEYS.has(key.key) || ADMIN_ONLY_KEYS.has(key.key) || isChildTopicKey(key.key) ? "guardian" : "self",
    teen: ADMIN_ONLY_KEYS.has(key.key) || isChildTopicKey(key.key) ? "guardian" : "self",
    adult: ADMIN_ONLY_KEYS.has(key.key) || isChildTopicKey(key.key) ? "guardian" : "self",
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
  const visible = areWakewordAssetsInstalled() ? cached : cached.filter((key) => key.key !== WAKEWORD_SETTING_KEY);
  // SEARCH-DDGS-TEEN-01: the DuckDuckGo-for-minors control exists while DuckDuckGo search is set up on this computer, and
  // also whenever its stored value is not "off" (so an admin can always see and turn off a choice made earlier, even after
  // the sidecar went away). Hidden only when it is off AND the sidecar is unset; hidden, it reads as off.
  if (ddgsConfigured()) return visible;
  return storedMinorDdgs() !== "off" ? visible.map(noteMinorDdgsWhenUnconfigured) : visible.filter((key) => key.key !== MINOR_DDGS_KEY);
}

/** The raw stored value of one household key, supplied by settings.ts at load (it owns the database and the cache).
 * Registered, not imported, because settings.ts imports this file. `fallback` is what a key with no row reads as. */
let storedHouseholdReader: ((key: string, fallback: unknown) => unknown) | null = null;
export function registerStoredHouseholdReader(read: (key: string, fallback: unknown) => unknown): void {
  storedHouseholdReader = read;
}
function storedMinorDdgs(): unknown {
  try {
    return storedHouseholdReader?.(MINOR_DDGS_KEY, "off") ?? "off";
  } catch {
    return "off";
  }
}
const MINOR_DDGS_UNSET_NOTE = "DuckDuckGo search is not set up on this computer, so this has no effect until it is.";
function noteMinorDdgsWhenUnconfigured(key: SettingsKey): SettingsKey {
  if (key.key !== MINOR_DDGS_KEY) return key;
  return { ...key, help: `${MINOR_DDGS_UNSET_NOTE} ${key.help}`, copy: key.copy ? { ...key.copy, does: `${MINOR_DDGS_UNSET_NOTE} ${key.copy.does}` } : key.copy };
}

export function getRegistryKey(key: string): SettingsKey | undefined {
  return getRegistry().find((k) => k.key === key);
}

/** Test-only: the registry is cached module state. */
export function __reloadRegistryForTests(): void {
  cached = null;
}
