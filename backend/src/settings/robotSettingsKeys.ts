import { SettingsKey, type SettingsKey as SettingsKeyType } from "@maipai/spec/gen/ts/settings-key.js";
import declarations from "./robotSettingsKeys.json";

// The pinned robot settings metadata is now part of Home's generated
// settings registry. Behavioral consumers land with their own backlog
// items; this file only keeps Home's declared registry in sync with spec.
export const ROBOT_SETTINGS_KEYS: SettingsKeyType[] = declarations.map((entry) => SettingsKey.parse(entry));
