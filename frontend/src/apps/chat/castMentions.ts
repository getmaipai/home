// CREATOR-05: the cast items of the one `@` list (docs/design/creatoros-port-2026-11-13.md section 6.4). A cast item is its own item type beside the companion
// items: a companion chip (type "person") still means a one-turn guest, a cast chip (type "cast") only names someone for a picture, a video or a film.
// The id carries a prefix so a synth that is both a companion and cast member never collides in the list, and the directive says which kind it is.
import type { CastListEntry } from "@/lib/api";

export const CAST_MENTION_PREFIX = "cast:";

export interface CastMentionItem { id: string; type: "cast"; label: string; description: string }

const KIND_WORD: Record<CastListEntry["subject_kind"], string> = { character: "Cast", place: "Place", prop: "Prop" };

/** The list as the server filtered it for this viewer (a child or teen is never sent what the band hides); nothing is added or widened here. */
export function castMentionItems(cast: readonly CastListEntry[] | undefined): CastMentionItem[] {
  return (cast ?? []).map((entry) => ({ id: `${CAST_MENTION_PREFIX}${entry.id}`, type: "cast" as const, label: entry.name, description: entry.kind === "member" ? "Household" : entry.kind === "synth" ? "Synth" : KIND_WORD[entry.subject_kind] }));
}
