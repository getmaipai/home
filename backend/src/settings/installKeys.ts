// LICENCE-ACK-01: the one install policy flag. Declared in Home until a commons spec tag carries it (scripts/settings-ahead-of-spec.json).
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const INSTALL_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "install.recommended_auto_on_upgrade",
    scope: "household",
    selector: "boolean",
    default: false,
    label: "Install the recommended extras by themselves after an update",
    help: "Off by default. When on, the extras Home recommends for this computer (the Detailed video model among them, about 74 GB) download as soon as an admin accepts the licences, with no extra click. Off means an admin presses one button.",
    level: "expert",
    copy: { does: "Downloads the recommended extras right after the licences are accepted on an existing Home." },
    lives_in: "household.pictures",
    honoured_by: ["home"],
  }),
];
