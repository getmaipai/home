import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

/** Family media is enabled household-wide. Adult content remains governed by the fixed likeness policy. */
export const HOUSEHOLD_LIKENESS_KEY = "generation.household_likeness";
export const LIKENESS_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: HOUSEHOLD_LIKENESS_KEY,
    scope: "household",
    selector: "boolean",
    default: true,
    label: "Pictures, videos and styles of your household",
    help: "Let people in this household make pictures and videos of each other, including saved styles. Age and safety limits still apply.",
    level: "basic",
    secret: false,
    lives_in: "generation",
    honoured_by: ["home"],
  }),
];
