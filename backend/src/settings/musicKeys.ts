// MUSIC-GEN-03: the household's music control (docs/design/music-generation-2026-10-17.md, section 9).
// Declared here like the video keys (videoKeys.ts) and identical to the pinned spec's entry; it shows on the same
// Settings card, Pictures, videos and music. Children and teens never make songs whatever this says
// (lib/music/policy.ts): it is a control for adults only, and the absolute lines have no key.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const MUSIC_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "generation.music.enabled",
    scope: "household",
    selector: "boolean",
    default: true,
    label: "Adults can make music",
    help: "Adults can ask chat to write and make songs, and change them. Children and teens cannot, whatever this says.",
    level: "basic",
    copy: { does: "Turns song making on or off for the grown-ups here." },
    lives_in: "household.pictures",
    honoured_by: ["home"],
  }),
];
