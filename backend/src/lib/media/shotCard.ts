// CREATOR-20a: shot-card vocabulary is read from the same validated media-template catalog as picture fragments.
import type { PersonRow } from "@/types";
import { getFragment, listFragments } from "@/lib/media/templates";
import type { FragmentRecord } from "@/lib/media/templates";

export type ShotCard = {
  subject?: string; action?: string; camera?: string; lens?: string; focal?: string; aperture?: string;
  framing?: string; light?: string; film_stock?: string; look?: string; grade?: string; palette?: string[];
};

const GROUP_OF = { camera: "camera", lens: "lens", focal: "focal", aperture: "aperture", framing: "framing", light: "light", film_stock: "film_stock", look: "look", grade: "grade" } as const;
type VocabularyKey = keyof typeof GROUP_OF;
const VOCABULARY_ORDER: VocabularyKey[] = ["framing", "camera", "lens", "focal", "aperture", "light", "film_stock", "look", "grade"];
const DATA_ACTOR = { id: "person-shot-card", role: "adult" } as PersonRow;

/** Return a fresh palette only when every entry is a six-digit hex colour and there are at most eight. */
export function validatePalette(palette: unknown): string[] {
  if (!Array.isArray(palette) || palette.length > 8 || !palette.every((colour) => typeof colour === "string" && /^#[0-9a-fA-F]{6}$/.test(colour))) return [];
  return [...palette];
}

/** Compose the person's words and selected shot-card records in a stable order. Invalid ids are reported and skipped. */
export function composeShotPrompt(card: ShotCard): { prompt: string; used: string[]; unknown: string[] } {
  const parts: string[] = [];
  const own = [card.subject, card.action].map((word) => word?.trim()).filter((word): word is string => Boolean(word));
  parts.push(...own);
  const used: string[] = [];
  const unknown: string[] = [];
  const rows: Partial<Record<VocabularyKey, FragmentRecord>> = {};
  for (const key of VOCABULARY_ORDER) {
    const id = card[key];
    if (!id) continue;
    const row = getFragment(id);
    if (!row || row.group !== GROUP_OF[key]) { unknown.push(id); continue; }
    rows[key] = row;
    used.push(row.id);
  }
  if (rows.framing) parts.push(rows.framing.prompt);
  if (rows.camera) parts.push(rows.camera.prompt);
  const lensClause = [rows.lens?.prompt, rows.focal?.prompt, rows.aperture?.prompt].filter(Boolean).join(", ");
  if (lensClause) parts.push(lensClause);
  for (const key of ["light", "film_stock", "look", "grade"] as const) if (rows[key]) parts.push(rows[key]!.prompt);
  const palette = validatePalette(card.palette);
  if (palette.length) parts.push(`colour palette: ${palette.join(", ")}`);
  return { prompt: parts.join(", "), used, unknown };
}

/** Four versions of the card, using the first four light records in catalog file order. */
export function sameShotFourLights(card: ShotCard): ShotCard[] {
  return listFragments({ actor: DATA_ACTOR, group: "light" }).slice(0, 4).map((row) => ({ ...card, light: row.id }));
}
