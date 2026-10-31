// MUSIC-SPEC-01: the record shape is the pinned spec's (file.provenance.generation); no prompt, title or lyrics belong in it.
import type { GenerationProvenance } from "@maipai/spec/gen/ts/generation-provenance.js";
export type { GenerationProvenance };
/** Quick sings the hook. Full sings every part. The length follows the words. */
export type SongLength = "quick" | "full";
export type MusicTask = "text2music" | "cover" | "repaint" | "extend" | "remake" | "variation" | "trim" | "fade" | "loudness" | "stems";
export interface MusicRequest {
  description: string; lyrics?: string; written_lyrics?: string; title?: string; instrumental: boolean; seconds: number;
  cut?: "asked" | "ceiling"; /** On a stem: the id of the split job that made it, so two splits of one song stay two sets. */ stemsOf?: string; max_seconds?: number; retried?: boolean;
  bpm?: number; key?: string; language?: string; quality?: "quick" | "detailed"; /** TIER-HOME-03: read by the household queue. Music has no Max maker yet. */ tier?: "standard" | "boost"; seed?: number; length?: SongLength;
  from_s?: number; to_s?: number; add_s?: number; at?: "start" | "end"; strength?: number;
  edit?: import("./stack").MusicBody["edit"];
}
export interface MusicJob {
  id: string; personId: string; conversationId: string | null; turnId: string | null; companionId?: string | null; task: MusicTask; request: MusicRequest;
  stackJob: string | null; state: import("./stack").MusicState; stage: string | null; progress: number; etaSeconds: number | null;
  position: number | null; errorCode: string | null; errorLine: string | null; fileId: string | null; parentFileId: string | null;
  coverJobId: string | null; coverFileId: string | null;
  seed: number | null; durationS: number | null; lrc: string | null; chosenAt: string | null;
  createdAt: string; updatedAt: string; temporary: boolean;
}
export const MUSIC_NOTE = "music-gen:";
export function generationOf(note: string | null): GenerationProvenance | null {
  if (!note?.startsWith(MUSIC_NOTE)) return null;
  try { const value = JSON.parse(note.slice(MUSIC_NOTE.length)) as GenerationProvenance; return value && value.kind === "music" ? value : null; } catch { return null; }
}
