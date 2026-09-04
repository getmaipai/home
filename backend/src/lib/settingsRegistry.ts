// Loads the committed spec/settings/keys.json (generated from
// declarations, see scripts/gen-settings-registry.ts) and validates every
// entry through the generated Zod schema, so a hand-edit or a generator
// bug is caught at boot, not at some later read.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

const REGISTRY_PATH = join(import.meta.dir, "..", "..", "..", "spec", "settings", "keys.json");

function loadRegistry(): SettingsKey[] {
  const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as unknown[];
  return raw.map((entry) => SettingsKey.parse(entry));
}

let cached: SettingsKey[] | null = null;

export function getRegistry(): SettingsKey[] {
  if (!cached) cached = loadRegistry();
  return cached;
}

export function getRegistryKey(key: string): SettingsKey | undefined {
  return getRegistry().find((k) => k.key === key);
}

/** Test-only: the registry is cached module state. */
export function __reloadRegistryForTests(): void {
  cached = null;
}
