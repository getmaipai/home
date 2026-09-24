// STATUS-PHRASES-01: the written chat's waiting line ("Thinking…" before
// the first token, "On it." while a lookup or tool runs) was one fixed
// string per moment; this makes it data, picked per turn, per companion.
// `vocab/status-phrases.json` (spec-v0.1.36) is the default set, one
// array per moment; a companion's own manifest (`persona.ts`'s
// `Persona.status_phrases`) may replace the default for a moment it
// declares, falling back to the default for one it leaves out.
import statusPhrasesVocab from "@maipai/spec/vocab/status-phrases.json" with { type: "json" };
import { pickVariant } from "@/lib/replyVariation";
import type { Persona } from "@/lib/persona";

export type StatusMoment = "thinking" | "searching" | "checking";

/** `pickVariant()`'s own guarantee ("never repeating the immediately
 * previous pick as long as variants.length >= 2, each call advances the
 * index by exactly one") already gives "never the same phrase twice in a
 * row in one conversation" for free, keyed by conversationId - no second
 * last-used tracker needed the way `pickThinkingCue()`'s own banned-list
 * filtering needs one (that one can shrink the pool between calls; this
 * one's pool is fixed for the whole conversation). */
export function pickStatusPhrase(conversationId: string, moment: StatusMoment, persona: Persona): string {
  const pool = persona.status_phrases?.[moment] ?? statusPhrasesVocab[moment];
  return pickVariant(conversationId, `status_phrase:${moment}`, pool);
}
