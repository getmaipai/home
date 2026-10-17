// MEDIA-KID-01: one daily limit, allowance.media.daily_minutes (allowanceKeys.ts).
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
export const MEDIA_ALLOWLIST_KEY = "media.allowlist_only";
export const MEDIA_AUDIO_EXEMPT_KEY = "media.budget.exempt_bedtime_audio";
export const MEDIA_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: MEDIA_ALLOWLIST_KEY, scope: "person", selector: "boolean", default: false,
    label: "Approved media only", help: "Shows the home library and sources picked for you.",
    copy: { does: "Shows the home library and sources picked for you.", does_child: "Shows the home library and channels a grown-up picked for you." },
    control: { child: "guardian", teen: "guardian", adult: "self" },
    band_default: { child: true, teen: false, adult: false },
    merge: "override", layers: ["band", "person"],
    level: "basic", lives_in: "person.allowance", honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: MEDIA_AUDIO_EXEMPT_KEY, scope: "household", selector: "boolean", default: false,
    label: "Audio outside screen time",
    help: "Music and audiobooks do not use the daily media minutes when this is on.",
    copy: { does: "Leaves music and audiobooks out of the daily media minutes." },
    // Expert until a spec areas tag carries a media group: no settings card places it yet (settingsAreasRegistry.test.ts).
    level: "expert", lives_in: "media.budget", honoured_by: ["home"],
  }),
];
