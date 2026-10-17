// AUDIO-SESSION-01: how fast each kind of audio plays for a person. One person setting per kind, read by the shell's
// audio session (frontend/src/shell/audioSession.ts), which applies it when a player registers and writes it back when
// the person changes the rate in a player. They live in the person's Voice card for now: the spec's areas.json has no
// Playback section yet (spec first, owed in commons), and the keys ride in `aheadOfSpec` in scripts/check.sh until a
// spec tag carries them.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const AUDIO_SPEED_KINDS = ["podcast", "audiobook", "video", "spoken_reply"] as const;
export type AudioSpeedKind = (typeof AUDIO_SPEED_KINDS)[number];

const RANGE = { min: 0.5, max: 3 };

function speedKey(kind: AudioSpeedKind, label: string, does: string, help: string): SettingsKey {
  return SettingsKey.parse({
    key: `audio.speed.${kind}`,
    scope: "person",
    selector: "number",
    range: RANGE,
    default: 1,
    label,
    copy: { does },
    help,
    level: "basic",
    lives_in: "person.voice",
    honoured_by: ["home"],
  });
}

export const AUDIO_SETTINGS_KEYS: SettingsKey[] = [
  speedKey("podcast", "Podcast speed", "Plays episodes faster or slower than normal.", "How fast podcast episodes play for you. 1 is normal speed and 1.5 is one and a half times as fast. A player's speed menu changes this too."),
  speedKey("audiobook", "Audiobook speed", "Plays audiobooks faster or slower than normal.", "How fast audiobooks play for you. 1 is normal speed and 0.75 is slower. A player's speed menu changes this too."),
  speedKey("video", "Video speed", "Plays videos faster or slower than normal.", "How fast videos play for you. 1 is normal speed. A player's speed menu changes this too."),
  speedKey("spoken_reply", "Spoken reply speed", "Speeds up or slows down spoken replies.", "How fast MaiPai talks when it reads a reply aloud to you. 1 is normal speed. Faster speeds also sound a little higher."),
];
