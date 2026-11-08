// MUSIC-GEN-03: one age and surface gate, inherited from pictures. No setting lifts the minor line.
import { getHouseholdSettingValue } from "@/lib/settings";
import { pictureDenial, promptViolatesMinorLine, type PictureAudience } from "@/lib/pictures/policy";
import { laneOf, TEEN_CONTENT_LINE, CHILD_CONTENT_LINE } from "@/lib/pictures/lane";
import { refusePrompt } from "@/lib/pictures/policy";
import { contentPolicyFor } from "@/lib/contentPolicy";
import { musicTranscriptionAvailable } from "./ready";
import { CHILD_SONG_TEMPLATE } from "@/lib/contentPolicy/rewrite";

export const MUSIC_ENABLED_KEY = "generation.music.enabled";
export type MusicAudience = PictureAudience;
export type MusicDenial = "guest" | "minor" | "spoken" | "shared_screen" | "household_off";
export const MUSIC_DENIAL_LINE: Record<MusicDenial, string> = {
  guest: "Guests can't make songs. Ask someone in the household to sign you in.",
  minor: "Songs are not ready for children and teens on this computer yet.",
  spoken: "Songs can only be made in a written chat on your own screen.",
  shared_screen: "Songs can only be made on your own screen, not a shared one.",
  household_off: "Making songs is switched off for adults in this home. An admin can switch it on in Settings, Pictures, videos and music.",
};
export const MUSIC_NOT_HERE_LINE = "I can't make a song here right now. It takes an adult on their own screen and a music model on this computer.";
export const MUSIC_LENGTH_KEY = "generation.music.length";
/** `generation.music.length`: what chat makes when nobody asks for a kind (full, the default, or quick). */
export function householdSongLength(read: (key: string) => unknown = getHouseholdSettingValue): "quick" | "full" {
  try { return read(MUSIC_LENGTH_KEY) === "quick" ? "quick" : "full"; } catch { return "full"; }
}
export function householdAllowsMusic(read: (key: string) => unknown = getHouseholdSettingValue): boolean {
  try { return read(MUSIC_ENABLED_KEY) !== false; } catch { return true; }
}
/** Who may open songs that already exist (stop, card, play, download): the age and surface lines, never the household switch. */
export function musicViewDenial(audience: MusicAudience): Exclude<MusicDenial, "household_off"> | null {
  if (audience.actor.role === "guest") return "guest";
  const lane = laneOf(audience);
  if (lane !== "adult" && !musicTranscriptionAvailable()) return "minor";
  const base = pictureDenial(audience);
  return base === "guest" || base === "minor" || base === "spoken" || base === "shared_screen" ? base : null;
}
/** Who may make or change a song: the view lines plus the household switch. */
export function musicDenial(audience: MusicAudience): MusicDenial | null {
  return musicViewDenial(audience) ?? (householdAllowsMusic() ? null : "household_off");
}
export function musicsAllowed(audience: MusicAudience): boolean { return musicDenial(audience) === null; }
export type MusicRefusal = "minor_sexual";
export const MUSIC_REFUSAL_LINE: Record<MusicRefusal, string> = {
  minor_sexual: "I can't make that. Songs with sexual content about children are never allowed.",
};
export function refuseMusicPrompt(text: string): MusicRefusal | null {
  return musicProtections({ actor: { id: "adult-policy", role: "adult" } as MusicAudience["actor"], band: "adult", surface: "chat", surfaceClass: "written", spoken: false }).checkWords(text, "prompt") ? "minor_sexual" : null;
}
export function musicProtections(audience: MusicAudience): { lane: ReturnType<typeof laneOf>; checkWords(text: string, field: "prompt" | "lyrics" | "title" | "transcript"): string | null } {
  let lane: ReturnType<typeof laneOf>;
  try { lane = laneOf(audience); } catch { lane = audience.actor.role === "adult" || audience.actor.role === "owner" || audience.actor.role === "admin" ? "adult" : "child"; }
  let policy: ReturnType<typeof contentPolicyFor> | null = null;
  if (lane !== "adult") { try { policy = contentPolicyFor(audience); } catch { /* closed below */ } }
  return { lane, checkWords(text, field) {
    try {
      if (promptViolatesMinorLine(text, lane)) return MUSIC_REFUSAL_LINE.minor_sexual;
      if (lane !== "adult") {
        const floor = lane === "child" && text === CHILD_SONG_TEMPLATE ? null : refusePrompt(text, { lane });
        if (floor) return floor === "teen_content" ? TEEN_CONTENT_LINE : floor === "child_content" ? CHILD_CONTENT_LINE : MUSIC_REFUSAL_LINE.minor_sexual;
        if (!policy) return lane === "teen" ? TEEN_CONTENT_LINE : CHILD_CONTENT_LINE;
        const result = policy.check(text, field);
        if (result) return result.line;
      }
      return null;
    } catch { return lane === "adult" ? MUSIC_REFUSAL_LINE.minor_sexual : lane === "teen" ? TEEN_CONTENT_LINE : CHILD_CONTENT_LINE; }
  } };
}
