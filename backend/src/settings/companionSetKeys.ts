import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

/** Person-owned set of companions shown in Yours. Written only by the companion add/remove routes. */
export const COMPANION_SET_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "companions.enabled",
    scope: "person",
    selector: "text",
    default: null,
    label: "Your companions",
    help: "The companions you keep in Yours.",
    level: "basic",
    lives_in: "person.companions",
    honoured_by: ["home"],
  }),
];
