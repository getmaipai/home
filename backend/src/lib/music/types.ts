// MUSIC-SPEC-01: the record shape is the pinned spec's (file.provenance.generation); no prompt, title or lyrics belong in it.
import type { GenerationProvenance } from "@maipai/spec/gen/ts/generation-provenance.js";
export type { GenerationProvenance };
/** Quick: a short song (about 45 s) for a jingle, a hook or trying words. Full: a whole song (about 3 minutes) with its structure. */
export type SongLength = "quick" | "full";
export type MusicTask = "text2music" | "cover" | "repaint" | "extend" | "remake" | "variation" | "trim" | "fade" | "loudness";
export interface MusicRequest {
  description: string; lyrics?: string; title?: string; instrumental: boolean; seconds: number;
  bpm?: number; key?: string; language?: string; quality?: "quick" | "detailed"; seed?: number; length?: SongLength;
  from_s?: number; to_s?: number; add_s?: number; at?: "start" | "end"; strength?: number;
  edit?: import("./stack").MusicBody["edit"];
}
export interface MusicJob {
  id: string; personId: string; conversationId: string | null; turnId: string | null; task: MusicTask; request: MusicRequest;
  stackJob: string | null; state: import("./stack").MusicState; stage: string | null; progress: number; etaSeconds: number | null;
  position: number | null; errorCode: string | null; errorLine: string | null; fileId: string | null; parentFileId: string | null;
  seed: number | null; durationS: number | null; lrc: string | null; chosenAt: string | null;
  createdAt: string; updatedAt: string; temporary: boolean;
}
export const MUSIC_NOTE = "music-gen:";
export function generationOf(note: string | null): GenerationProvenance | null {
  if (!note?.startsWith(MUSIC_NOTE)) return null;
  try { const value = JSON.parse(note.slice(MUSIC_NOTE.length)) as GenerationProvenance; return value && value.kind === "music" ? value : null; } catch { return null; }
}
