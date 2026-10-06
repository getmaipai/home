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

const REGISTRY_PATH = join(SPEC_DIR, "settings", "keys.json");

function loadRegistry(): SettingsKey[] {
  const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as unknown[];
  const parsed = raw.map((entry) => SettingsKey.parse(entry));
  // AI declarations ship with Home's backend, while the shared settings
  // snapshot is pinned independently. Include newly added Home AI keys
  // until the shared snapshot is advanced.
  const keys = new Set(parsed.map((entry) => entry.key));
  // THIN-4H: search.brave_api_key likewise rides here until a commons spec tag carries it.
  return [...parsed, ...[...AI_SETTINGS_KEYS, ...HOSTED_SEARCH_SETTINGS_KEYS, ...NOTIFICATION_SETTINGS_KEYS].filter((entry) => !keys.has(entry.key))];
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
