import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const WAKEWORD_SETTING_KEY = "voice.wakeword.enabled";

export const WAKEWORD_SETTINGS_KEYS = [
  SettingsKey.parse({
    key: WAKEWORD_SETTING_KEY,
    scope: "device",
    selector: "boolean",
    default: false,
    label: "Wake word listening",
    help: "Let this device listen locally for its wake word. Listening is always visible and can be stopped from the indicator.",
    level: "basic",
    lives_in: "device.voice",
    honoured_by: ["home"],
  }),
];
