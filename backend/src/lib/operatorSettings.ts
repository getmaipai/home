// OPS-KEY-01: the household settings an assistant session may change with a `settings` API key. A short, named list: a key
// names what it may touch, never a prefix or a pattern. A setting that guards people (identity, passwords, age gates, safety,
// credentials, retention, what children may see or make) never belongs here, and a test fails the build if one is added.
import { getRegistryKey } from "@/lib/settingsRegistry";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";

/** To add a setting: a key that needs work after it is saved (routes/settings.ts runs follow-ups for the engine location, robots, the search address and a few more) must not be added until this route runs the same follow-up. To add one: add its key here, state why an assistant needs it in the backlog row, and run tests/operatorSettings.test.ts. */
export const OPERATOR_SETTING_KEYS = ["chat.search_assist"] as const;
export type OperatorSettingKey = (typeof OPERATOR_SETTING_KEYS)[number];

/** Key families that are never changeable by an assistant key, whatever someone adds above. */
export const OPERATOR_DENIED_PREFIXES = ["people.", "auth.", "safety.", "age.", "credentials.", "privacy.", "retention.", "generation.", "kids.", "child.", "teen.", "minor.", "backups.", "network.", "engines.stack.", "home.robots."] as const;

export function isOperatorSettingKey(key: string): key is OperatorSettingKey {
  return (OPERATOR_SETTING_KEYS as readonly string[]).includes(key) && !OPERATOR_DENIED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export interface OperatorSettingView { key: string; label: string; help: string | undefined; options: string[] | null; value: unknown }

/** The allowlisted settings with their current values, for an assistant that reads before it writes. */
export function operatorSettingsView(): OperatorSettingView[] {
  return OPERATOR_SETTING_KEYS.flatMap((key) => {
    const def = getRegistryKey(key);
    if (!def) return [];
    const options = def.range && "options" in def.range && Array.isArray(def.range.options) ? def.range.options.map(String) : null;
    return [{ key, label: def.label, help: def.help, options, value: getHouseholdSettingValue(key) }];
  });
}

/** Sets one allowlisted household setting through the same writer the Settings page uses. Never logs or returns a secret. */
export function setOperatorSetting(keyId: string, key: string, value: unknown): { ok: true; key: string; previous: unknown; value: unknown } | { ok: false; status: 400 | 403; error: string } {
  if (!isOperatorSettingKey(key)) return { ok: false, status: 403, error: "This key cannot change that setting. Change it in Settings in the browser, or ask an owner to allow it for assistants." };
  // A setting marked secret is never on this list, and is never printed if one is added by mistake.
  const def = getRegistryKey(key);
  if (def && (def as { secret?: boolean }).secret === true) return { ok: false, status: 403, error: "This key cannot change that setting." };
  const previous = getHouseholdSettingValue(key);
  const written = setHouseholdSettingValue(key, value);
  if (!written.ok) return { ok: false, status: 400, error: written.error };
  // The key's id, the setting and the two values: enough to see who changed what, never the secret.
  console.log(`[operator] settings key ${keyId} set ${key} from ${JSON.stringify(previous)} to ${JSON.stringify(value)}`);
  return { ok: true, key, previous, value };
}
