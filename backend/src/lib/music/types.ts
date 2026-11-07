// MUSIC-SPEC-01: the record shape is the pinned spec's (file.provenance.generation); no prompt, title or lyrics belong in it.
import type { GenerationProvenance } from "@maipai/spec/gen/ts/generation-provenance.js";
export type { GenerationProvenance };
/** Quick sings the hook. Full sings every part. The length follows the words. */
export type SongLength = "quick" | "full";
export type MusicTask = "text2music" | "cover" | "repaint" | "extend" | "remake" | "variation" | "trim" | "fade" | "loudness" | "stems";
export interface MusicRequest {
  description: string; lyrics?: string; written_lyrics?: string; title?: string; instrumental: boolean; seconds: number;
  cut?: "asked" | "ceiling"; /** On a stem: the id of the split job that made it, so two splits of one song stay two sets. */ stemsOf?: string; /** On a split of an audio file the person owns: the source is theirs, not a made song. */ ownedFile?: boolean; max_seconds?: number; retried?: boolean;
  sound?: { loop: boolean; surprise: boolean };
  bpm?: number; key?: string; language?: string; quality?: "quick" | "detailed" | "max"; /** TIER-HOME-03: read by the household queue. MUSIC-MAX-01: Max is the engine's XL SFT maker. */ tier?: "standard" | "boost" | "max"; seed?: number; length?: SongLength;
  from_s?: number; to_s?: number; add_s?: number; at?: "start" | "end"; strength?: number;
  edit?: import("./stack").MusicBody["edit"];
  /** A kept-part mix made from private intermediate stems. */
  parts?: { keep: Array<"vocals" | "drums" | "bass" | "other">; drop: Array<"vocals" | "drums" | "bass" | "other"> };
  /** A voice swap keeps the target's id only; the private reference clip is read from the voice manager at finish time. */
  voiceSwap?: { voiceId: string };
  /** MUSIC-LIKE-01: a made band's first single. The song saved from this job is filed under the band (artist text and made_artist_id). */
  band?: { id: string; name: string };
  /** MUSIC-STUDIO-ALBUM: a track of a made album. The song saved from this job is listed on the album (lib/music/album.ts syncAlbumTracks). */
  album?: { id: string };
  /** MUSIC-ADDMUSIC-RESTART-01: an Add music mix waiting on this instrumental. Kept in the stored request so a restart can still start the mix. */
  pendingMix?: { args: Record<string, unknown>; conversationId: string; turnId: string };
}
export interface MusicJob {
  id: string; personId: string; conversationId: string | null; turnId: string | null; companionId?: string | null; task: MusicTask; request: MusicRequest;
  stackJob: string | null; state: import("./stack").MusicState; stage: string | null; progress: number; etaSeconds: number | null;
  position: number | null; errorCode: string | null; errorLine: string | null; fileId: string | null; parentFileId: string | null;
  coverJobId: string | null; coverFileId: string | null;
  seed: number | null; durationS: number | null; lrc: string | null; /** MUSIC-GEN-20b: JSON of the aligned lines `[{t, text, words:[{t,end,text}]}]` for this version; null until the aligner has run (or when it cannot). */ timedWords?: string | null; chosenAt: string | null;
  createdAt: string; updatedAt: string; temporary: boolean;
}
export const MUSIC_NOTE = "music-gen:";
export function generationOf(note: string | null): GenerationProvenance | null {
  if (!note?.startsWith(MUSIC_NOTE)) return null;
  try { const value = JSON.parse(note.slice(MUSIC_NOTE.length)) as GenerationProvenance; return value && (value.kind === "music" || value.kind === "sound") ? value : null; } catch { return null; }
}
