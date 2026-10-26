import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

/** The household switch for pictures, videos and styles of household members. The spec owns its definition (spec 0.1.229). */
export const HOUSEHOLD_LIKENESS_KEY = "generation.household_likeness";
/** Nothing here: the likeness keys are all spec-owned now. Kept so the registry generator's imports stay one list. */
export const LIKENESS_SETTINGS_KEYS: SettingsKey[] = [];
