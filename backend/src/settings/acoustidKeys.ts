// MUSIC-ID-01: the AcoustID application key for song identification, a household credential read through the settings layer like the
// Brave Search key (hostedSearchKeys.ts): a write-only secret stored encrypted, never logged, never returned. Declared here until a
// commons spec tag carries it.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const ACOUSTID_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "acoustid.client",
    scope: "household",
    selector: "text",
    default: "",
    label: "AcoustID key (for naming songs online)",
    help: "Optional. AcoustID runs beside Shazam and names whole recordings from their start. An application key from acoustid.org lets Home use it as another song guess. Only a short audio fingerprint and the clip length are sent, never the recording. The key is stored encrypted and can't be read back.",
    level: "advanced",
    secret: true,
    lives_in: "household.media_lookups",
    honoured_by: ["home"],
  }),
];
