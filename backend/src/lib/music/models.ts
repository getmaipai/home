// MUSIC-GEN-03: what Home knows about the music models the Stack can name. One table, so provenance is never hardcoded:
// a model the Stack names that is not here is stamped unknown and is never cleared for commercial export.
import type { GenerationProvenance, MusicTask } from "./types";

export const MUSIC_ENGINE = { id: "music-gen", version: "ca1e85f" } as const;
const ACE_STEP_BASIS = "MIT weights; the model card states it was trained on licensed, royalty-free and synthetic audio and that output may be used commercially (read 2026-10-17)";
interface KnownMusicModel { revision: string; licence: string; commercial_use: "cleared"; commercial_basis: string }
/** Keyed by the Stack's pin id (the `model` of a job result). Revisions are the Stack's pins (design note section 3). */
export const KNOWN_MUSIC_MODELS: Record<string, KnownMusicModel> = {
  "ace-step-1-5-turbo": { revision: "19671f406d603126926c1b7e2adc169acbcade22", licence: "MIT", commercial_use: "cleared", commercial_basis: ACE_STEP_BASIS },
  "ace-step-1-5-lm-0-6b": { revision: "148d8ea0225bdab342ee1ae3a354275ccd60ca80", licence: "MIT", commercial_use: "cleared", commercial_basis: ACE_STEP_BASIS },
};
/** Tasks that run no model: the result inherits its parent's model fields and clearance. */
const NO_MODEL_TASKS: readonly MusicTask[] = ["trim", "fade", "loudness"];
type Stamp = Pick<GenerationProvenance, "model" | "engine" | "commercial_use" | "commercial_basis">;
const UNKNOWN_BASIS = "The music model that made this was not recognised, so its licence and training data are unknown and commercial use is not cleared.";

export function modelStampFor(task: MusicTask, modelId: unknown, parent: GenerationProvenance | null): Stamp {
  if (NO_MODEL_TASKS.includes(task)) {
    if (parent) return { model: { ...parent.model }, engine: { ...parent.engine }, commercial_use: parent.commercial_use, commercial_basis: parent.commercial_basis };
    return { model: { id: "unknown", revision: "unknown", licence: "unknown" }, engine: { ...MUSIC_ENGINE }, commercial_use: "unknown", commercial_basis: UNKNOWN_BASIS };
  }
  const known = typeof modelId === "string" && Object.hasOwn(KNOWN_MUSIC_MODELS, modelId) ? KNOWN_MUSIC_MODELS[modelId]! : null;
  if (known) return { model: { id: modelId as string, revision: known.revision, licence: known.licence }, engine: { ...MUSIC_ENGINE }, commercial_use: known.commercial_use, commercial_basis: known.commercial_basis };
  return { model: { id: typeof modelId === "string" && modelId.trim() ? modelId.trim().slice(0, 120) : "unknown", revision: "unknown", licence: "unknown" }, engine: { ...MUSIC_ENGINE }, commercial_use: "unknown", commercial_basis: UNKNOWN_BASIS };
}
