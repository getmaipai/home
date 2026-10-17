// MUSIC-GEN-03: one age and surface gate, inherited from pictures. No setting lifts either absolute line.
import { getHouseholdSettingValue } from "@/lib/settings";
import { pictureDenial, promptViolatesMinorLine, type PictureAudience } from "@/lib/pictures/policy";
import { laneOf } from "@/lib/pictures/lane";

export const MUSIC_ENABLED_KEY = "generation.music.enabled";
export type MusicAudience = PictureAudience;
export type MusicDenial = "guest" | "minor" | "spoken" | "shared_screen" | "household_off";
export const MUSIC_DENIAL_LINE: Record<MusicDenial, string> = {
  guest: "Guests can't make songs. Ask someone in the household to sign you in.",
  minor: "Making songs is off for children and teens for now.",
  spoken: "Songs can only be made in a written chat on your own screen.",
  shared_screen: "Songs can only be made on your own screen, not a shared one.",
  household_off: "Making songs is switched off for adults in this home. An admin can switch it on in Settings, Pictures, videos and music.",
};
export const MUSIC_NOT_HERE_LINE = "I can't make a song here right now. It takes an adult on their own screen and a music model on this computer.";
export function householdAllowsMusic(read: (key: string) => unknown = getHouseholdSettingValue): boolean {
  try { return read(MUSIC_ENABLED_KEY) !== false; } catch { return true; }
}
/** Who may open songs that already exist (stop, card, play, download): the age and surface lines, never the household switch. */
export function musicViewDenial(audience: MusicAudience): Exclude<MusicDenial, "household_off"> | null {
  if (audience.actor.role === "guest") return "guest";
  // Music is for adults only (design note section 9). Pictures and videos now open a teen lane and a child cartoon lane
  // (owner ruling 2026-10-17); music does not inherit them: the stricter of the turn's band and the person's own must be
  // adult, whatever any picture setting says. A parent's per-child music switch is MUSIC-GEN-13, not built.
  if (laneOf(audience) !== "adult") return "minor";
  const base = pictureDenial(audience);
  return base === "guest" || base === "minor" || base === "spoken" || base === "shared_screen" ? base : null;
}
/** Who may make or change a song: the view lines plus the household switch. */
export function musicDenial(audience: MusicAudience): MusicDenial | null {
  return musicViewDenial(audience) ?? (householdAllowsMusic() ? null : "household_off");
}
export function musicsAllowed(audience: MusicAudience): boolean { return musicDenial(audience) === null; }
export type MusicRefusal = "minor_sexual" | "real_voice";
export const MUSIC_REFUSAL_LINE: Record<MusicRefusal, string> = {
  minor_sexual: "I can't make that. Songs with sexual content about children are never allowed.",
  real_voice: "I can't make a song that copies a real person's voice. I can make one in a similar style with an original voice instead.",
};
export function refuseMusicPrompt(text: string, flags: { imitatesRealVoice?: boolean } = {}): MusicRefusal | null {
  if (promptViolatesMinorLine(text)) return "minor_sexual";
  return flags.imitatesRealVoice === true ? "real_voice" : null;
}
