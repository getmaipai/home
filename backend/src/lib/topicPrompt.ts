// MINOR-TOPICS-01c: the one prompt block that says how to handle sensitive
// subjects for a child or teen. Built from the band's record and the parent's
// topic keys; empty for an adult, so an adult's prompt is byte-identical.
// A child's own keys apply only when the speaker really is that child: a
// robot turn that heard a child on a parent's session gets the band defaults.
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { getCeilingForBand } from "@/lib/contentCeiling";
import { resolveTopicStances, topicStancesForPerson } from "@/lib/topicStances";
import { renderTopicBlock, type TopicFamily, type TopicStance } from "@maipai/spec/interpreters/ts/topicBlock.js";
import type { PersonRow } from "@/lib/memoryIngestion";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import type { LlmMessage } from "@/lib/llm";

/** The band record's own default stances: what a minor gets when nothing can be read. */
function defaultStances(band: "child" | "teen"): { stances: Record<TopicFamily, TopicStance>; familyStoryNames: string[] } {
  const record = getCeilingForBand(band);
  const stances = {} as Record<TopicFamily, TopicStance>;
  for (const [family, entry] of Object.entries(record.topics ?? {}) as [TopicFamily, { stance: string }][]) stances[family] = entry.stance as TopicStance;
  return { stances, familyStoryNames: band === "child" ? [...(record.family_stories?.names ?? [])] : [] };
}

/** The block for a turn in `band`; "" only for an adult. A child or teen always gets a block: if the stored keys
 * cannot be read, the band's defaults are used, never an empty prompt. */
export function topicBlockFor(band: AgeBand, personId?: string): string {
  if (band !== "child" && band !== "teen") return "";
  let resolved: { stances: Record<TopicFamily, TopicStance>; familyStoryNames: string[] };
  try {
    resolved = (personId ? topicStancesForPerson(personId, band) : resolveTopicStances(band)) ?? defaultStances(band);
  } catch (error) {
    console.warn(`[topics] could not read the topic settings (${error instanceof Error ? error.message : String(error)}); using the ${band} defaults`);
    resolved = defaultStances(band);
  }
  return renderTopicBlock({ band, record: getCeilingForBand(band), stances: resolved.stances, familyStoryNames: resolved.familyStoryNames });
}

/** The turn's block: the person's own keys when they are the band's person, the band defaults otherwise. */
export function topicBlockForTurn(actor: PersonRow, band: AgeBand): string {
  const own = speakerAgeBand(actor, new Date()) === band;
  return topicBlockFor(band, own ? actor.id : undefined);
}

/** For a model call that is not a chat turn (a package's llm step, the llm route, a project text step): the
 * messages with the topic block in front when the person is a child or teen. The block joins a leading system
 * message instead of adding a second one, because some chat templates accept only one, first. Adults: unchanged. */
export function withTopicBlock(block: string, messages: readonly LlmMessage[]): LlmMessage[] {
  if (block.length === 0) return [...messages];
  const [first, ...rest] = messages;
  if (first && first.role === "system" && typeof first.content === "string") return [{ ...first, content: `${first.content}\n\n${block}` }, ...rest];
  return [{ role: "system", content: block }, ...messages];
}

export function topicMessages(actor: PersonRow, messages: readonly LlmMessage[]): LlmMessage[] {
  return withTopicBlock(topicBlockFor(speakerAgeBand(actor, new Date()), actor.id), messages);
}

/** The same, from a person id. A missing person reads as a child, the strictest band (as projects/gate.ts does). */
export function topicMessagesForId(personId: string, messages: readonly LlmMessage[]): LlmMessage[] {
  const row = db.select().from(people).where(eq(people.id, personId)).get();
  return row ? topicMessages(row as PersonRow, messages) : withTopicBlock(topicBlockFor("child"), messages);
}
