import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const COMPANION_SHELL_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "companions.preview_shells",
    scope: "person",
    selector: "boolean",
    default: false,
    level: "expert",
    label: "Preview the coming companion features",
    help: "Off by default. On, your own Companions pages and chat show the coming-soon previews: companion tabs, the create wizard, the chat header companion pick and the @ mention. Only you see them.",
    copy: { does: "Shows you the coming companion previews. Nothing is saved from them." },
    lives_in: "person.companions",
    honoured_by: ["home"],
    control: { child: "guardian", teen: "guardian", adult: "guardian" },
  }),
];
