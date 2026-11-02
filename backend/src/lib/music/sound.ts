// MUSIC-STUDIO-STYLE: the sound a song is made in. A song can be made "in" a saved song style, a made band's sound, or an album's
// sound; this turns those ids into one set of defaults (style words, genres, tempo, key, voice, length) that the song's own
// arguments then override. Access is the person's own: an id they cannot read is refused, never silently ignored.
// Rule 6a: nothing here logs a title, a band name, or the style words.
import type { PersonRow } from "@/types";
import { getMade } from "./madeRecords";

export interface SoundStyle { description: string; genres: string[]; instrumental?: boolean; bpm?: number | null; key?: string | null; length_s?: number | null; language?: string | null }
export interface ResolvedSound { style: SoundStyle | null; band: { id: string; name: string } | null; album: { id: string } | null }
export type SoundResult = { ok: true; value: ResolvedSound } | { ok: false; line: string };

export const SOUND_NOT_FOUND_LINE = "That band, album or song style is not available to this person. Say so, and offer to make the song without it.";

/** The ids a song asks to be made in. Each is optional; an album brings its band and its own sound. */
export function resolveSound(actor: PersonRow, ids: { song_style?: string; band?: string; album?: string }): SoundResult {
  let style: SoundStyle | null = null;
  let band: ResolvedSound["band"] = null;
  let album: ResolvedSound["album"] = null;
  let bandId = ids.band;
  if (ids.album) {
    const found = getMade("made_album", actor, ids.album);
    if (!found.ok) return { ok: false, line: SOUND_NOT_FOUND_LINE };
    const a = found.value as unknown as { id: string; made_artist_id?: string | null; style?: SoundStyle };
    album = { id: a.id };
    style = a.style ?? null;
    bandId ??= a.made_artist_id ?? undefined;
  }
  if (bandId) {
    const found = getMade("made_artist", actor, bandId);
    if (!found.ok) return { ok: false, line: SOUND_NOT_FOUND_LINE };
    const b = found.value as unknown as { id: string; name: string; style?: SoundStyle };
    band = { id: b.id, name: b.name };
    style ??= b.style ?? null;
  }
  if (ids.song_style) {
    const found = getMade("song_style", actor, ids.song_style);
    if (!found.ok) return { ok: false, line: SOUND_NOT_FOUND_LINE };
    style = (found.value as unknown as { style: SoundStyle }).style;
  }
  return { ok: true, value: { style, band, album } };
}
