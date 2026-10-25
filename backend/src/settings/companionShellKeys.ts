import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const COMPANION_SHELL_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "companions.preview_shells",
    scope: "household",
    selector: "boolean",
    default: false,
    level: "basic",
    label: "Preview the coming companion features",
    help: "Off by default. On, everyone in the home sees the coming-soon companion previews: companion tabs, the create wizard, the chat header companion pick and the @ mention. Nothing is saved from them.",
    copy: { does: "Shows you the coming companion previews. Nothing is saved from them." },
    lives_in: "household.system",
    honoured_by: ["home"],
  }),
];
