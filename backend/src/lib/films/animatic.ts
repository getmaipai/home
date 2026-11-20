// FILM-ANIMATIC-01: the film as an animatic before any clip is rendered. The silent animatic is the Stack's `media.rough_cut` with no lines voiced,
// and the one request builder for it lives in `./roughCut` (VOICED-ROUGH-CUT-HOME-01); this is the silent call. The finished file goes through
// the same finished-video check as every other film file (fails closed).
import type { PersonRow } from "@/types";
import type { FilmPlan } from "./plan";
import { makeRoughCut, type AnimaticResult } from "./roughCut";

export type { AnimaticResult } from "./roughCut";

export async function makeFilmAnimatic(input: { actor: PersonRow; productionId: string; plan: FilmPlan; signal?: AbortSignal }): Promise<AnimaticResult> {
  const made = await makeRoughCut({ ...input, voiced: false });
  return made.ok ? { ok: true, fileId: made.fileId, seconds: made.seconds, shots: made.shots } : made;
}
