// ELEMENTS-HOME-03: "Make an element, from words". The words become four comparable pictures through the existing picture job (`makePictureFor`),
// which the Library then offers to save as an element ("Save as an element"). A minor's character art stays a cartoon of their own character
// (`characterFacesForBand`, CREATOR-19). Nothing here names a model.
import { characterFacesForBand } from "@/lib/pictures/characterFaces";
import { makePictureFor } from "@/lib/pictures/make";
import { audienceBand } from "@/lib/audience";
import type { SubjectKind } from "@/lib/mediaSubjects";
import type { PersonRow } from "@/types";

export const ELEMENT_WORDS_MAX = 600;

/** The picture prompt for the words, by kind: a face for a character, an establishing view for a place, the object alone for a prop. */
export function elementPrompt(kind: SubjectKind, words: string, band: "adult" | "teen" | "child"): string {
  const text = words.trim();
  if (kind === "character") return characterFacesForBand(text, band);
  if (kind === "place") return `An establishing view of ${text}, no people in the picture, the same place across four takes.`;
  return `${text}, shown alone and centered on a plain simple background, the same object across four takes.`;
}

export type MakeElementResult = { ok: true; ids: string[]; notice: string | null } | { ok: false; status: number; error: string; code?: string };

export async function makeElementFromWords(person: PersonRow, input: { kind?: unknown; prompt?: unknown }): Promise<MakeElementResult> {
  const kind: SubjectKind = input.kind === "place" || input.kind === "prop" ? input.kind : "character";
  const words = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (words.length < 3 || words.length > ELEMENT_WORDS_MAX) return { ok: false, status: 422, error: `Describe it in 3 to ${ELEMENT_WORDS_MAX} characters, then try again.`, code: "bad_arguments" };
  const made = await makePictureFor(person, { prompt: elementPrompt(kind, words, audienceBand(person)), count: 4 });
  return made.ok ? { ok: true, ids: made.ids, notice: made.notice ?? null } : { ok: false, status: made.status, error: made.error, code: made.code };
}
