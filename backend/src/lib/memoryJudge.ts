// The memory judge (platform plan 4.4's "judge" half, session-a-
// intelligence.md step 6): a post-turn core job that reads a completed
// turn whose frozen signal carries an eligible clause (ACT-01; before
// the signal, a `source: "model"` turn) and decides what, if anything,
// is worth remembering from it - the "sleep-time" pattern (Letta), adapted from
// the legacy hub's memory/judge.ts but re-scoped to this platform's real
// differences from it:
//
// - Legacy ran on an IDLE SWEEP over a whole unprocessed conversation
//   span (it could see many turns at once, distinguishing a one-off
//   curiosity from a real preference across the session). This job runs
//   PER TURN instead, per the plan's own words ("a post-turn core job...
//   for every source: model turn") - a real, deliberate simplification:
//   this platform's turn/conversation architecture (conversationHistory.ts)
//   didn't exist yet when legacy's design was written, and per-turn
//   keeps each extraction call small and the poison guard meaningful
//   (one turn either judges cleanly or it doesn't - a whole session
//   can't get stuck because one message in the middle was malformed).
// - Legacy assumed ONE user per account ("the user"), so its extraction
//   prompt could resolve every possessive to a generic "user" and read
//   fine to that one person later. This platform has multiple NAMED
//   people per household reading the same household-scope facts, so
//   possessives resolve to the SPEAKER'S REAL NAME instead ("Willow is
//   Marlow's wife", never "Willow is the user's wife") - a real
//   adaptation, not a porting detail, because "the user's wife" is
//   ambiguous the moment a second named person can read the fact.
// - Legacy also extracted a separate `entities` list (upserted into its
//   own table by name/alias). This store has no entities table - an
//   entity is just a memory_record with record_kind "entity" (see
//   entityNameWords() in lib/memory.ts) - and the plan's own step 6
//   schema has no entities field either. Entity-record creation from the
//   judge is a real, deferred gap, not silently dropped: a fact's TEXT
//   still names people/things explicitly (the specificity rule below),
//   so entity-match boosting in recall() still works for any entity
//   record that exists some other way; the judge just doesn't create
//   those records itself yet.
// - Legacy's dedupe round had four actions (ADD/UPDATE/DELETE/NO_CHANGE).
//   This store's lifecycle only exposes two write shapes - remember()
//   (brand new) and supersede() (retire one, create its replacement) -
//   so UPDATE and DELETE both collapse onto SUPERSEDE here; `contradiction`
//   is the one bit legacy's separate DELETE case carried (closes
//   valid_to on the old record - see memory.ts's SupersedeOptions) that a
//   plain merge/refinement doesn't.
// - Legacy's "kind: procedural" facts routed to a Notes app. This
//   platform has no Notes app yet - procedural knowledge just isn't
//   extracted this pass, a real, deferred gap, not a silent omission.
//
// Poison guard (the plan's own words: "at most 3 attempts per turn, then
// mark the turn judge_failed"): tracked PERSISTENTLY across core-job
// ticks via conversation_turns.judge_attempts/judge_status, not retried
// in a tight loop within one call - a transient outage (embed backend
// down, llama-server mid-restart) gets up to 3 separate one-minute-apart
// tries before the turn is given up on, the same "queue and retry on the
// job's own cadence" shape lib/memory.ts's pending_embeddings already
// uses. Only an EXTRACTION failure counts against this budget; a dedupe-
// round failure never does (it just defaults to ADD, matching legacy's
// own catch block) - dedupe deciding "keep both" safely is never wrong
// enough to burn a turn's whole budget over.
import { eq, and, or, isNull, isNotNull, notInArray, ne, asc, lt, desc } from "drizzle-orm";
import { hasEligibleClause, isEligibleClause } from "@/lib/turnSignal";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import type { SignalClause } from "@/lib/turnSignal";
import { turnSignalOf } from "@/lib/conversationHistory";
import { detectCredential } from "@/lib/memoryContentPolicy";
import { tokenize } from "@/lib/text";
import { relationshipTypes } from "@maipai/spec/records/ts/validate.js";
import { ensureSubjectEntity, findEntityNamedIn, findSubjectByName, kindForRelation, retireOrphanSubjects, saidAs, speakerNamed, speakerNamedAny, speakerStated, writeRelation } from "@/lib/subjects";
import { candidateQuestion, relationPhraseFor, speakerStatedKind, statedPronounFor, twoTurnStatedKind } from "@/lib/unknownNames";
import { updateEntity } from "@/lib/entities";
import { listOpenQuestions, openQuestionDeclined, queueOpenQuestion, turnSubjectsOf } from "@/lib/conversationHistory";
import type { ToolExecutionOutcome } from "@/lib/turnContext";
import type { Entity } from "@maipai/spec/gen/ts/entity.js";
import { db, sqlite } from "@/db";
import { conversationTurns, people, memoryRecords } from "@/db/schema";
import { complete, embed, type LlmMessage } from "@/lib/llm";
import { completeBackground, getBackgroundBackendKind } from "@/lib/backgroundSupervisor";
import {
  remember,
  supersede,
  similarByVector,
  vectorsFor,
  cosineSimilarity,
  demoteNeverRecalledDurables,
  supersedeInFavorOfExisting,
  list,
  PROFILE_SOURCE,
  isPrivilegedRecordKind,
  type SimilarMatch,
} from "@/lib/memory";
import { isOwnerOrAdmin } from "@/lib/access";
import { trigger } from "@/lib/notifications";
import { sanitizeForPrompt } from "@/lib/promptSanitize";
import { defaultChildDisclosure } from "@/lib/childDisclosure";
import { nextHlc } from "@/lib/hlc";
import { turnActiveWithin, DEFAULT_IDLE_WINDOW_MS } from "@/lib/turnActivity";
import type { ConversationTurnRow } from "@/wire";
import type { PersonRow, MemoryRecordRow } from "@/types";

const MAX_JUDGE_ATTEMPTS = 3;
const MAX_FACTS_PER_TURN = 12;
// One core-job tick processes a bounded batch, not the whole backlog at
// once - the same "amortize over ticks, never monopolize the model"
// discipline legacy's own consolidate.ts used (MAX_MERGES_PER_RUN).
// Drain logic (MEM-02, 2026-09-12): the judge now processes pending turns
// until none remain, turnActiveWithin() becomes true, 50 turns are
// processed, or 5 minutes elapse - whichever comes first. This replaces
// the old MAX_TURNS_PER_RUN = 1 gate that processed one turn per minute
// and left large backlogs. The per-turn mid-turn idle check (see
// judgeTurn() below) still limits individual extraction calls.

const CATEGORY_VALUES = [
  "person",
  "place",
  "thing",
  "preference",
  "identity",
  "event",
  "project",
  "goal",
  "relationship",
  "fact",
  "state",
] as const;
// Exported alongside categoryToRecordKind (step 10) for the same reason:
// lib/legacyImport.ts validates a legacy `memories.category` value
// against this exact list rather than re-declaring it, since the legacy
// enum and this one are the identical 11 values (confirmed against
// home-legacy.git's own schema.ts).
export type Category = (typeof CATEGORY_VALUES)[number];

// Durable vs episodic is derived from category here, not asked of the
// model (the plan's own schema for step 6 has no `tier` field at all -
// "the schema is tiny on purpose"): one fewer thing a small model has to
// get right, and legacy's own categoryToTier() already proved this
// mapping works. "observation" (this spec's third tier, no legacy
// counterpart) is never picked by the judge, matching the same call
// recall()'s own tier-floor code already made for it.
function categoryToTier(category: Category): "durable" | "episodic" {
  const durable: Category[] = ["identity", "relationship", "person", "preference"];
  return durable.includes(category) ? "durable" : "episodic";
}

// Session C step 9 (session-c-brain-and-voice.md): "the judge writes
// Entity records... until [F's real entities table] lands, the judge
// writes record_kind: entity memory records... and the switch is a
// one-line change" - this is that one line, mapping the extractor's own
// "person"/"place"/"thing" categories (the entity-shaped ones,
// unchanged since this step's extraction schema already had them) onto
// record_kind "entity" instead of the plain "memory" every other
// category still gets. A real, if narrower, gap not closed here: an
// entity record's own recall boost (memory.ts's entityNameWords()) reads
// the record's `text` as "Name: description," but this extraction
// schema has no separate name field to build that shape from - a
// judge-written entity record here is real and correctly KINDED, just
// not yet formatted for that specific boost to fire on it. Widening the
// schema to ask for a name too is real, deferred work (the plan's own
// "the schema is tiny on purpose" instinct from step 6 argues against
// growing it without a concrete need proven first), not silently
// dropped.
// Exported (step 10, session-c-brain-and-voice.md) so lib/legacyImport.ts
// can kind a legacy `memories` row the identical way a judge-extracted
// fact of the same category already is - one definition, reused by both
// writers of a memory_records row, rather than a second copy of this
// three-line map living in the importer.
export function categoryToRecordKind(category: Category): "memory" | "entity" {
  const entityShaped: Category[] = ["person", "place", "thing"];
  return entityShaped.includes(category) ? "entity" : "memory";
}

// CUR-01, the memory curator's first rule: before the embed/dedupe
// pipeline runs on a fact, look for an active record that is this exact
// same statement - same scope, same person (when person-scoped), same
// record kind, same verbatim text. The vector pass below is semantic
// (near-duplicate); this one is the EXACT duplicate the curator merges
// with provenance kept, so the store never holds two identical active
// rows for the same statement. remember() stores fact.text verbatim,
// so the comparison is verbatim too. Returns the matching row or null.
function exactActiveMatch(speaker: PersonRow, fact: ExtractedFact): MemoryRecordRow | null {
  const conditions = [
    eq(memoryRecords.status, "active"),
    eq(memoryRecords.scope, fact.scope),
    eq(memoryRecords.recordKind, categoryToRecordKind(fact.category)),
    eq(memoryRecords.text, fact.text),
  ];
  if (fact.scope === "person") conditions.push(eq(memoryRecords.person, speaker.id));
  return db.select().from(memoryRecords).where(and(...conditions)).get() ?? null;
}

/** The vocabulary's relationship types the model may name in a fact's
 * `relation` slot (spec/vocab/relationship-types.json, the same list
 * relationships.ts validates against). */
const RELATION_TYPE_IDS: string[] = relationshipTypes().map((t: { id: string }) => t.id);
/** The prompt's own guide to the types, from the same `said_as` lists
 * the stated gate reads (one definition): the first phrase of each
 * type a person states from their side. */
const RELATION_PHRASE_GUIDE: string = RELATION_TYPE_IDS.filter((id) => saidAs(id).length > 0)
  .map((id) => `"${saidAs(id)[0]}" is ${id}`)
  .join(", ");

const EXTRACTION_SCHEMA = {
  name: "memory_extraction",
  schema: {
    type: "object",
    properties: {
      facts: {
        type: "array",
        maxItems: MAX_FACTS_PER_TURN,
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            category: { type: "string", enum: CATEGORY_VALUES as unknown as string[] },
            scope: { type: "string", enum: ["person", "household"] },
            importance: { type: "number" },
            valid_from: { type: ["string", "null"] },
            valid_to: { type: ["string", "null"] },
            // Step 3a: who or what the fact is about, and a relation the
            // speaker stated in the sentence, each in its own slot so the
            // judge writes the entity and the relationship from a name
            // and a vocabulary id rather than guessing them from the text.
            subject: {
              type: ["object", "null"],
              properties: {
                name: { type: "string" },
                kind: { type: "string", enum: ["person", "pet", "place", "organization", "thing"] },
              },
              required: ["name", "kind"],
            },
            relation: {
              type: ["object", "null"],
              properties: {
                type: { type: "string", enum: RELATION_TYPE_IDS },
                name: { type: "string" },
                stated: { type: "boolean" },
              },
              required: ["type", "name", "stated"],
            },
          },
          required: ["text", "category", "scope", "importance"],
        },
      },
    },
    required: ["facts"],
  },
} as const;

/** "2026-09-19T12:00:00-04:00" for a turn on 2026-09-13 local: the day
 * plus six, at noon, with the local offset. Exported for the test. */
export function exampleDateFor(turnDate: Date): string {
  const day = new Date(turnDate);
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() + 6);
  const two = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const offsetMinutes = -day.getTimezoneOffset();
  const offset = `${offsetMinutes >= 0 ? "+" : "-"}${two(Math.trunc(offsetMinutes / 60))}:${two(offsetMinutes % 60)}`;
  return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}T12:00:00${offset}`;
}

/** The prompt's own example and template texts, one source for the
 * prompt below and for the echo filter (`rejectPromptEchoes`): a
 * small model re-emits these as memories on turns that have nothing
 * to do with them (2026-09-13, live), so any extracted record that
 * matches one, with the speaker's name substituted, is not a fact. */
export function promptExampleTexts(speakerName: string, turnDate: string): string[] {
  return [
    `${speakerName} is getting married in <the actual month/year>`,
    `<name> is ${speakerName}'s wife`,
    `${speakerName} was in Brazil, ${turnDate}`,
    `${speakerName} said hi`,
    `Rover loves horror movies, ${speakerName}'s brother`,
    `${speakerName} dislikes cilantro`,
    `the wifi password is written on the fridge`,
    `The wifi password is Juniper2026`,
    `${speakerName} was in Brazil visiting his wife's family, ${turnDate}`,
  ];
}

/** The turn's day as the prompt spells it (and the echo filter reads). */
export function turnDateFor(turnTimestamp: string): string {
  return new Date(turnTimestamp).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function buildExtractionPrompt(speakerName: string, turnTimestamp: string): string {
  const turnDateObj = new Date(turnTimestamp);
  const turnDate = turnDateFor(turnTimestamp);
  // A real, computed ISO-8601-with-offset example date (not a bare
  // "<the 20th>" placeholder) - a code review (2026-09-05) found the
  // prompt gave the model no format guidance for valid_from/valid_to at
  // all, and remember()'s own Zod gate rejects anything but
  // z.string().datetime({offset:true}); a plausible model output like
  // "2026-09-20" (no time, no offset) would fail validation and silently
  // drop the whole fact with no trace.
  //
  // Six days after the turn's own day at noon, second precision, the
  // local offset kept (BENCH-01's finding): the first cut took the
  // turn's timestamp plus six days at millisecond precision, so no two
  // judge prompts were ever the same bytes. That defeated the judge
  // engine's prompt cache on every turn (the whole system prompt
  // re-evaluated on the 1.7B, all day) and, under the seeded bench,
  // made the written memory text differ between runs. Two turns on the
  // same day now build the identical prompt.
  const exampleFutureDate = exampleDateFor(turnDateObj);
  return `You are a long-term memory manager for a family's private AI. Review the exchange below and extract durable facts worth remembering.

SOURCE RULE - extract ONLY facts ${speakerName} asserted or explicitly confirmed. The Assistant's own statements are context, never a source: if the Assistant guessed something and ${speakerName} didn't confirm it, do NOT store it.

TIME RULE - this exchange happened on ${turnDate}. Resolve relative time into absolute terms in the fact text: "I'm getting married next month" said on ${turnDate} becomes "${speakerName} is getting married in <the actual month/year>". Never store a bare "next week" or "yesterday" - those rot.

POSSESSIVE RULE - every "my"/"her"/"his" in what ${speakerName} says refers to ${speakerName}. Resolve it to ${speakerName}'s own name in the fact text, from ${speakerName}'s point of view: "my wife" becomes "<name> is ${speakerName}'s wife", never a guess about whose relative someone is. Keep every other name exactly as stated - never blur a named person into "someone".

STATE AND TRIP RULE - an ongoing situation ("stressed about a deadline", "recovering from surgery") is category "state". Where ${speakerName} IS during a trip ("I'm in Brazil for two weeks") is also category "state", written in the PAST tense with the actual dates: "${speakerName} was in Brazil, ${turnDate}" with valid_to set to when it ends if stated. Never write a trip as still-current: an undated present-tense whereabouts would have this AI treating someone as abroad long after they came home.

DATE FORMAT RULE - valid_from and valid_to (when you set them) MUST be a full timestamp with a timezone, exactly like "${exampleFutureDate}" - never a bare date like "2026-09-20" and never a relative phrase. Omit the field (or use null) rather than guess a malformed one.

CRITICAL - do NOT extract:
- Questions asked or information looked up (one-off curiosity, not an assertion)
- One-moment moods and feelings ("I'm tired today")
- Trivia or facts about the world that reveal nothing about ${speakerName}
- Trivially-true or contentless observations ("${speakerName} said hi")

SUBJECT AND RELATION - when a fact is about a named person, pet, place, organization or thing, set "subject" to that name and kind (the person the fact is about, never ${speakerName} for ${speakerName}'s own preferences; null when the fact is about ${speakerName} alone or about the world). When ${speakerName}'s own sentence states how a named person or thing relates to ${speakerName} ("my coworker ...", "my sister ...", "our dog ..." followed by the name), set "relation" with the vocabulary type read from ${speakerName}'s side (${speakerName} is the "from" end: ${RELATION_PHRASE_GUIDE}), the name, and "stated": true; "stated": false only when you worked the relation out from context rather than ${speakerName} saying it. Null when there is none.

SCOPE - "person": a fact about ${speakerName} specifically. "household": a fact the whole family should know (the wifi password, the dog's name, the trash pickup day) - use household only when a new family member would need to be told it too.

Category options: ${CATEGORY_VALUES.join(", ")}.
Importance 0 to 1: identity/relationship = 0.9-1.0, strong preference = 0.7-0.8, project/goal = 0.5-0.6, minor fact = 0.3-0.4.

Examples (these exact names never recur in a real household - never copy them into a real fact):
- "How long until bacteria grows on meat left out?" -> nothing (a one-off question)
- "My brother Rover loves horror movies" -> {"text": "Rover loves horror movies, ${speakerName}'s brother", "category": "relationship", "scope": "person", "importance": 0.7}
- "I hate cilantro" -> {"text": "${speakerName} dislikes cilantro", "category": "preference", "scope": "person", "importance": 0.7}
- "The wifi password is written on the fridge" -> {"text": "the wifi password is written on the fridge", "category": "fact", "scope": "household", "importance": 0.6}
- "The wifi password is Juniper2026" -> nothing (a password, a key or a token is never a memory; the household keeps those in Credentials)
- "We're in Brazil until next week visiting my wife's family" -> {"text": "${speakerName} was in Brazil visiting his wife's family, ${turnDate}", "category": "state", "scope": "person", "importance": 0.5, "valid_to": "${exampleFutureDate}"}

Return ONLY a JSON object: {"facts": [...]} (an empty array if nothing qualifies). At most ${MAX_FACTS_PER_TURN} facts.`;
}

export type EntityKind = "person" | "pet" | "place" | "organization" | "thing";
export interface ExtractedFact {
  text: string;
  category: Category;
  scope: "person" | "household";
  importance: number;
  valid_from: string | null;
  valid_to: string | null;
  /** Step 3a: who or what the fact is about, when the model could name
   * one (a person, pet, place, organization or thing by name). */
  subject: { name: string; kind: EntityKind } | null;
  /** Step 3a: a relation the sentence carries between the speaker and
   * the named person or thing; `stated` when the speaker said it in so
   * many words ("my coworker Quill"), false when the model worked it out
   * (a co-occurrence, a context). */
  relation: { type: string; name: string; stated: boolean } | null;
}

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORY_VALUES as readonly string[]).includes(value);
}

/** Normalizes one raw parsed fact, or returns null to drop it - a small
 * model under grammar constraints still occasionally gets a field wrong
 * in ways the grammar itself can't prevent (an out-of-range number, an
 * empty string); dropping the one bad fact is the right failure mode,
 * not failing the whole turn over it (the same "best effort per row"
 * discipline drainPendingEmbeddings() already applies to its own batch). */
// remember()'s own Zod gate requires exactly this shape
// (z.string().datetime({ offset: true }), spec/gen/ts/memory-record.ts) -
// checked here too, defensively, so a plausible-but-malformed model date
// (a bare "2026-09-20", no time or offset) degrades to "no date" on
// just that one field rather than failing remember()'s validation and
// silently dropping the WHOLE fact (a code review, 2026-09-05, found the
// prompt alone wasn't a strong enough guarantee to skip this).
const ISO_DATETIME_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function normalizeDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATETIME_WITH_OFFSET.test(value) ? value : null;
}

function normalizeFact(raw: unknown): ExtractedFact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== "string" || !r.text.trim()) return null;
  if (!isCategory(r.category)) return null;
  const scope = r.scope === "household" ? "household" : "person";
  const importance = typeof r.importance === "number" && Number.isFinite(r.importance) ? Math.min(1, Math.max(0, r.importance)) : 0.5;
  const subject = normalizeSubject(r.subject);
  const relation = normalizeRelation(r.relation);
  return {
    text: r.text.trim().slice(0, 500),
    category: r.category,
    scope,
    importance,
    valid_from: normalizeDate(r.valid_from),
    valid_to: normalizeDate(r.valid_to),
    subject,
    relation,
  };
}

const ENTITY_KINDS: EntityKind[] = ["person", "pet", "place", "organization", "thing"];
function normalizeSubject(raw: unknown): ExtractedFact["subject"] {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const name = typeof s.name === "string" ? s.name.trim().slice(0, 120) : "";
  if (!name || !ENTITY_KINDS.includes(s.kind as EntityKind)) return null;
  return { name, kind: s.kind as EntityKind };
}
function normalizeRelation(raw: unknown): ExtractedFact["relation"] {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const name = typeof s.name === "string" ? s.name.trim().slice(0, 120) : "";
  if (!name || typeof s.type !== "string" || !RELATION_TYPE_IDS.includes(s.type)) return null;
  return { type: s.type, name, stated: s.stated === true };
}

/** Content words with possessives folded ("Sage's" is "sage"), so the
 * speaker's name is skipped in every form it takes. */
function contentWords(text: string): Set<string> {
  return new Set([...tokenize(text.replace(/[<>]/g, " "))].map((w) => w.replace(/'s$|'$/, "")));
}

/** Capitalized words that are not sentence-initial (case-insensitive). */
function properNounsIn(text: string): string[] {
  return [...text.matchAll(/\b[A-Z][a-z]+\b/g)]
    .filter((match) => match.index !== 0 && !/[.!?] $/.test(text.slice(0, match.index)))
    .map((match) => match[0]!.toLowerCase());
}

// Words the prompt's rules put into any fact of the shape, never a sign
// of the example itself: the POSSESSIVE RULE turns the person's "my"
// into "his"/"her", so a pronoun is in every resolved fact.
const PRONOUNS = new Set(["his", "her", "hers", "their", "theirs", "him", "them", "its", "my", "our", "your"]);
// Calendar words are never anchors either: a month name (the echoed
// date with its month changed), or the wedding template's own
// "month"/"year", which a real recurring-event fact ("every year in the
// month of July") uses about nothing wedding-related.
const CALENDAR = new Set("january february march april may june july august september october november december month months year years day days week weeks today".split(" "));

/** The words that make an example the example: its content words minus
 * the speaker's name in any form, the date, pronouns and stopwords
 * ({brazil, visiting, wife, family} for the trip; {dislikes, cilantro};
 * {wifi, password, written, fridge}; {rover, loves, horror, movies,
 * brother}). A template with a placeholder is known by the placeholder's
 * own words ({actual, month, year}; {name}), never by the phrase the
 * prompt tells the model to produce for every wedding ("getting
 * married"), so a real wedding is a fact and the template echoed with
 * or without its brackets is not. */
function anchorWords(example: string, speakerName: string, turnDate: string): Set<string> {
  const placeholders = [...example.matchAll(/<([^<>]*)>/g)].map((m) => m[1]!);
  const source = placeholders.length > 0 ? placeholders.join(" ") : example;
  const skip = new Set([...contentWords(speakerName), ...contentWords(turnDate), ...PRONOUNS, ...CALENDAR]);
  return new Set([...contentWords(source)].filter((w) => !skip.has(w) && !/^\d+$/.test(w)));
}

/** Unfilled template text: "<name>", "<the actual month/year>"; a
 * bracketed phrase that opens with a letter and is not an address. */
const TEMPLATE_PLACEHOLDER_RE = /<[a-z][^<>@]{1,79}>/i;

export type EchoDropReason = "example_echo" | "placeholder" | "credential";

/** The judge's output-side rejection (2026-09-13, live): a small model
 * writes the extraction prompt's own few-shot examples as memories
 * (the trip, the wedding placeholder, the cilantro preference, the
 * relationship example, the prompt's own negative password line),
 * sometimes with the template placeholder verbatim. A candidate is an
 * echo when it carries two of an example's anchor words (an example
 * with one anchor, the short trip's {brazil}, needs the candidate to
 * be that example word for word) and the turn, the person's words and
 * the assistant's line they may have confirmed, contains none of the
 * anchors it carries: "Sage dislikes cilantro" is an echo after
 * "hello" and a fact after "I hate cilantro" or after "yep" to "still
 * can't stand cilantro?"; "Sage was in Ohio visiting his parents" carries
 * one anchor and stands; the wedding template echoed without its
 * brackets carries {actual, month, year} and goes. An unfilled
 * placeholder goes whatever the turn said, and so does a candidate
 * that reads like a credential (the memory content policy's detector,
 * the door remember() already has). Each drop is counted on one log
 * line so the bench can see it. The one soft spot, accepted: a model
 * that normalizes a paraphrase into an example's own words ("scary
 * films" into "loves horror movies") on a turn that said none of them
 * loses that record. */
export function rejectPromptEchoes(
  facts: ExtractedFact[],
  speakerName: string,
  turnDate: string,
  turnText: string,
): { kept: ExtractedFact[]; dropped: { fact: ExtractedFact; reason: EchoDropReason }[] } {
  const skip = new Set([...contentWords(speakerName), ...contentWords(turnDate), ...PRONOUNS, ...CALENDAR]);
  const examples = promptExampleTexts(speakerName, turnDate).map((e) => ({
    anchors: anchorWords(e, speakerName, turnDate),
    shape: [...contentWords(e)].filter((w) => !skip.has(w) && !/^\d+$/.test(w)).join(" "),
  }));
  const said = contentWords(turnText);
  const kept: ExtractedFact[] = [];
  const dropped: { fact: ExtractedFact; reason: EchoDropReason }[] = [];
  for (const fact of facts) {
    if (TEMPLATE_PLACEHOLDER_RE.test(fact.text)) {
      dropped.push({ fact, reason: "placeholder" });
      continue;
    }
    if (detectCredential(fact.text).detected) {
      dropped.push({ fact, reason: "credential" });
      continue;
    }
    const words = contentWords(fact.text);
    const shape = [...words].filter((w) => !skip.has(w) && !/^\d+$/.test(w)).join(" ");
    const echoes = examples.some(({ anchors, shape: exampleShape }) => {
      if (anchors.size === 0) return false;
      const carried = [...anchors].filter((a) => words.has(a));
      const matches = anchors.size >= 2 ? carried.length >= 2 : carried.length === 1 && shape === exampleShape;
      return matches && carried.every((a) => !said.has(a));
    });
    if (echoes) {
      dropped.push({ fact, reason: "example_echo" });
      continue;
    }
    kept.push(fact);
  }
  return { kept, dropped };
}

/** MEM-06 (a): the judge grounds every fact in the speaker's words - a
 * fact the model built from the hub's reply, a lookup result or a guess
 * is dropped as ungrounded. Against the speaker's words (the user's
 * text, plus the assistant's line when they confirmed it), a fact stands
 * when at least half of its content words (after the same skip set as
 * the echo filter: the speaker's name, the date words, pronouns,
 * calendar words) appear in them, and every proper noun (a capitalized
 * word not at a sentence start and not the speaker's name) and every
 * number in it appears too. A fact with no content words at all is
 * ungrounded. Each drop is counted on the same log line as the echo
 * drops. */
export function rejectUngrounded(
  facts: ExtractedFact[],
  speakerName: string,
  turnDate: string,
  userText: string,
  confirmedAssistantText?: string | null,
): { kept: ExtractedFact[]; dropped: { fact: ExtractedFact; reason: "ungrounded" }[] } {
  const skip = new Set([...contentWords(speakerName), ...contentWords(turnDate), ...PRONOUNS, ...CALENDAR]);
  const said = contentWords(confirmedAssistantText ? `${userText}\n${confirmedAssistantText}` : userText);
  const kept: ExtractedFact[] = [];
  const dropped: { fact: ExtractedFact; reason: "ungrounded" }[] = [];
  for (const fact of facts) {
    const words = contentWords(fact.text);
    const content = [...words].filter((w) => !skip.has(w));
    const shared = content.filter((w) => said.has(w)).length;
    const grounded =
      content.length > 0 &&
      shared >= Math.ceil(content.length / 2) &&
      properNounsIn(fact.text).every((noun) => skip.has(noun) || said.has(noun)) &&
      [...fact.text.matchAll(/\d+/g)].every((m) => skip.has(m[0]!) || said.has(m[0]!));
    if (!grounded) {
      dropped.push({ fact, reason: "ungrounded" });
      continue;
    }
    kept.push(fact);
  }
  return { kept, dropped };
}

// MEM-06 (b): a state whose main verb is conversational - "was wondering
// about", "planning to", "asking" - is a passing thing the person is
// doing right now, not a durable state of them. The stem is matched so
// the -ing, -s and -ed forms all fold to it ("wondering"/"wonders"/
// "wondered"); "was stressed about" keeps its stem and stands.
const CONVERSATIONAL_VERBS = [
  "asking",
  "saying",
  "wondering",
  "looking for",
  "planning",
  "telling",
  "chatting",
  "talking",
  "thinking about",
  "hoping",
  "guessing",
  "joking",
];

/** MEM-06 (b): drop a `state` fact whose main verb is one of the
 * conversational stems - the person is doing a passing thing, not in a
 * durable state. "Sage was stressed about a deadline" (stem "stressed",
 * not in the list) stands; "Sage was wondering about the weather"
 * (stem "wondering") goes. Each drop is counted on the same log line as
 * the other rejections. */
export function rejectPassing(
  facts: ExtractedFact[],
): { kept: ExtractedFact[]; dropped: { fact: ExtractedFact; reason: "passing" }[] } {
  const kept: ExtractedFact[] = [];
  const dropped: { fact: ExtractedFact; reason: "passing" }[] = [];
  for (const fact of facts) {
    if (fact.category !== "state") {
      kept.push(fact);
      continue;
    }
    const text = fact.text.toLowerCase();
    if (CONVERSATIONAL_VERBS.some((verb) => text.includes(verb))) {
      dropped.push({ fact, reason: "passing" });
      continue;
    }
    kept.push(fact);
  }
  return { kept, dropped };
}

/** MEM-06 (c): ground each extracted fact in the eligible clause it came
 * from. For every fact, find the eligible clause (inform/commissive with
 * stance asserted or reported) whose text shares the most content words
 * with the fact (after the skip set: speaker name, pronouns, calendar
 * words, stopwords). Drop `ineligible_act` if no eligible clause or the
 * best clause shares zero content words; `unknown_grounding` if proper
 * nouns or numbers (except the turn date's year) are not all in the cited
 * clause's text; `subject_mismatch` if the fact's subject names a
 * household member or third party but the clause's subject kind is
 * `speaker`, or vice versa (`subject: null` = the speaker). When the
 * signal is missing or has no clauses, keep every fact with `clause: null`. */
export function citeClause(
  facts: ExtractedFact[],
  signal: TurnSignal | null,
  userText: string,
  speakerName: string,
  turnDate: string,
): {
  kept: { fact: ExtractedFact; clause: SignalClause | null }[];
  dropped: { fact: ExtractedFact; reason: "ineligible_act" | "quoted" | "hypothetical" | "joking" | "unknown_grounding" | "subject_mismatch" }[];
} {
  if (!signal || signal.clauses.length === 0) {
    return { kept: facts.map((fact) => ({ fact, clause: null })), dropped: [] };
  }
  const skip = new Set([...contentWords(speakerName), ...contentWords(turnDate), ...PRONOUNS, ...CALENDAR]);
  const year = turnDate.match(/(\d{4})/)?.[1] ?? null;
  const eligible = signal.clauses.filter(isEligibleClause);
  const kept: { fact: ExtractedFact; clause: SignalClause | null }[] = [];
  const dropped: { fact: ExtractedFact; reason: "ineligible_act" | "quoted" | "hypothetical" | "joking" | "unknown_grounding" | "subject_mismatch" }[] = [];
  const stanceReason = (stance: SignalClause["stance"]): "quoted" | "hypothetical" | "joking" | null =>
    stance === "quoted" ? "quoted" : stance === "hypothetical" ? "hypothetical" : stance === "joke" ? "joking" : null;
  for (const fact of facts) {
    const words = contentWords(fact.text);
    const content = [...words].filter((w) => !skip.has(w));
    let best: { clause: SignalClause; shared: number } | null = null;
    for (const clause of signal.clauses) {
      const clauseText = userText.slice(clause.range.start, clause.range.end);
      const clauseWords = contentWords(clauseText);
      const shared = content.filter((w) => clauseWords.has(w)).length;
      if (!best || shared > best.shared) best = { clause, shared };
    }
    if (best && best.shared > 0) {
      const reason = stanceReason(best.clause.stance);
      if (reason) {
        dropped.push({ fact, reason });
        continue;
      }
    }
    let bestEligible: { clause: SignalClause; shared: number } | null = null;
    for (const clause of eligible) {
      const clauseText = userText.slice(clause.range.start, clause.range.end);
      const clauseWords = contentWords(clauseText);
      const shared = content.filter((w) => clauseWords.has(w)).length;
      if (!bestEligible || shared > bestEligible.shared) bestEligible = { clause, shared };
    }
    if (!bestEligible || bestEligible.shared === 0) {
      dropped.push({ fact, reason: "ineligible_act" });
      continue;
    }
    const clauseText = userText.slice(bestEligible.clause.range.start, bestEligible.clause.range.end);
    const clauseLower = clauseText.toLowerCase();
    const properNouns = properNounsIn(fact.text).filter((w) => !skip.has(w));
    const numbers = [...fact.text.matchAll(/\d+/g)].map((m) => m[0]!).filter((n) => n !== year);
    const allPresent =
      properNouns.every((w) => clauseLower.includes(w)) &&
      numbers.every((n) => clauseLower.includes(n));
    if (!allPresent) {
      dropped.push({ fact, reason: "unknown_grounding" });
      continue;
    }
    const factIsThirdParty = fact.subject !== null && fact.subject.name.toLowerCase() !== speakerName.toLowerCase();
    const clauseIsSpeaker = bestEligible.clause.subject?.kind === "speaker" || bestEligible.clause.subject === null;
    if (factIsThirdParty !== !clauseIsSpeaker) {
      dropped.push({ fact, reason: "subject_mismatch" });
      continue;
    }
    kept.push({ fact, clause: bestEligible.clause });
  }
  return { kept, dropped };
}

// MEM-06 (b): a fact about the turn's WORLD subject - a lookup's title
// ("the 2026 World Cup"), a world subject on the stack ("Mars") - is the
// world's, not the speaker's: the prompt's own "do not extract: trivia or
// facts about the world that reveal nothing about the speaker" rule,
// enforced on the output side. The speaker's OWN preference or plan about
// it stands: a preference category, or a first-person preference/plan
// marker in the text ("likes", "loves", "favourite", "wants to see",
// "is going to", "plans to").
const WORLD_PREFERENCE_MARKERS = ["likes", "loves", "favourite", "wants to see", "is going to", "plans to"];

// MEM-06 (d): the categories a commissive clause may write - a goal, a
// project or a dated event. Any other category on a commissive clause is
// dropped with reason "commissive_shape".
const COMMISSIVE_SHAPE: readonly Category[] = ["goal", "project", "event"];
const MS_24H = 24 * 60 * 60 * 1000;
const MS_7D = 7 * 24 * 60 * 60 * 1000;

/** MEM-06 (d): the clause contract's second half - what a kept fact
 * becomes once it cites its clause (chunk C's `citeClause()` returns the
 * pairs). A `reported` clause yields a record about the third party only,
 * capped at importance 0.4, with the source named in the text
 * ("according to Pippa, ..." prefix when the text does not already name
 * the speaker's source); a `commissive` clause yields only a `goal`,
 * `project` or dated `event` (any other category is dropped with reason
 * "commissive_shape"); a clause with `emotion_intensity` "moderate"
 * about the speaker or a named subject yields a `state` at importance
 * 0.3 with `valid_to` 24 hours after the turn, a "high" one at 0.5 with
 * seven days, an explicit `valid_to` on the fact always winning, and
 * "none" or "low" yields no state from the emotion (a `state` fact whose
 * only ground is the clause's emotion is dropped with reason
 * "invalid_emotion_category" when the intensity is none or low). One
 * utterance may split into an event and a state, so two facts citing the
 * same clause are both allowed. A pair with `clause: null` passes
 * through unchanged. */
export function shapeByClause(
  pairs: { fact: ExtractedFact; clause: SignalClause | null }[],
  turnCreatedAt: string,
): {
  kept: ExtractedFact[];
  dropped: { fact: ExtractedFact; reason: "commissive_shape" | "invalid_emotion_category" }[];
} {
  const kept: ExtractedFact[] = [];
  const dropped: { fact: ExtractedFact; reason: "commissive_shape" | "invalid_emotion_category" }[] = [];
  for (const { fact: fact0, clause } of pairs) {
    let fact: ExtractedFact = fact0;
    if (clause === null) {
      kept.push(fact);
      continue;
    }
    if (clause.stance === "reported") {
      const speakerName =
        fact.subject === null || fact.subject.name.toLowerCase() === "" ? "" : fact.subject.name;
      const name = speakerName || "the speaker";
      const lower = fact.text.toLowerCase();
      const named =
        (fact.subject !== null && lower.includes(fact.subject.name.toLowerCase())) ||
        lower.includes(`according to ${name.toLowerCase()}`);
      if (!named) {
        fact = { ...fact, text: `According to ${name}, ${fact.text}` };
      }
      if (fact.importance > 0.4) fact = { ...fact, importance: 0.4 };
      kept.push(fact);
      continue;
    }
    if (clause.act === "commissive") {
      if (!COMMISSIVE_SHAPE.includes(fact.category)) {
        dropped.push({ fact, reason: "commissive_shape" });
        continue;
      }
      kept.push(fact);
      continue;
    }
    const intensity = clause.emotion_intensity;
    if (intensity === "moderate" || intensity === "high") {
      if (fact.category === "state" && fact.valid_to === null) {
        const base = new Date(turnCreatedAt).getTime();
        const bound = intensity === "moderate" ? base + MS_24H : base + MS_7D;
        fact = {
          ...fact,
          importance: intensity === "moderate" ? 0.3 : 0.5,
          valid_to: new Date(bound).toISOString(),
        };
      }
      kept.push(fact);
      continue;
    }
    if (fact.category === "state") {
      dropped.push({ fact, reason: "invalid_emotion_category" });
      continue;
    }
    kept.push(fact);
  }
  return { kept, dropped };
}

/** MEM-06 (b): the turn's world titles - each retained outcome's
 * `source.title` and each world subject on the stack's `display_name` -
 * in the lowercase, case-insensitive form `rejectWorld()` matches
 * against. Never throws on a malformed value: a hand-edited row is not a
 * reason to lose a turn, the same discipline `outcomesForConversation()`
 * already takes. */
export function worldTitlesFor(turn: Pick<ConversationTurnRow, "outcomes" | "subjects">): string[] {
  const titles: string[] = [];
  let outcomes: ToolExecutionOutcome[] = [];
  if (turn.outcomes) {
    try {
      const parsed = JSON.parse(turn.outcomes) as unknown;
      if (Array.isArray(parsed)) outcomes = parsed as ToolExecutionOutcome[];
    } catch {
      outcomes = [];
    }
  }
  for (const o of outcomes) {
    const title = o.source?.title;
    if (typeof title === "string" && title.trim()) titles.push(title.trim().toLowerCase());
  }
  for (const s of turnSubjectsOf(turn)) {
    if (s.type === "world" && s.display_name && s.display_name.trim()) titles.push(s.display_name.trim().toLowerCase());
  }
  return titles;
}

/** MEM-06 (b): drop a fact about the turn's world subject unless it is the
 * speaker's own preference or plan about it - a `preference` category, or
 * a first-person preference/plan marker in the text. A bare "Mars has a
 * volcano" (subject "Mars", no preference) goes; "Marlow wants to see
 * Dune" (the film's title on the stack, a plan marker) stands. Each drop
 * is counted on the same log line as the other rejections. */
export function rejectWorld(
  facts: ExtractedFact[],
  worldTitles: string[],
): { kept: ExtractedFact[]; dropped: { fact: ExtractedFact; reason: "world" }[] } {
  const kept: ExtractedFact[] = [];
  const dropped: { fact: ExtractedFact; reason: "world" }[] = [];
  for (const fact of facts) {
    const text = fact.text.toLowerCase();
    const subject = fact.subject?.name?.toLowerCase() ?? "";
    const aboutWorld =
      worldTitles.some((t) => (subject && subject.includes(t)) || text.includes(t));
    if (!aboutWorld) {
      kept.push(fact);
      continue;
    }
    const speakerOwn =
      fact.category === "preference" ||
      WORLD_PREFERENCE_MARKERS.some((m) => text.includes(m));
    if (speakerOwn) {
      kept.push(fact);
      continue;
    }
    dropped.push({ fact, reason: "world" });
  }
  return { kept, dropped };
}

/** Phase 1: one grammar-constrained chat call, or null on any failure
 * (network, malformed JSON, an empty/non-object response) - null is what
 * counts against the poison guard; an empty array is a real, valid
 * "nothing worth remembering here" answer and does NOT. */
async function extractFacts(speakerName: string, turn: ConversationTurnRow): Promise<ExtractedFact[] | null> {
  const messages: LlmMessage[] = [
    { role: "system", content: buildExtractionPrompt(speakerName, turn.createdAt) },
    { role: "user", content: `${speakerName}: ${turn.userText}\nAssistant: ${turn.replyText}` },
  ];
  const result = await completeBackground(messages, {
    temperature: 0.1,
    response_format: { type: "json_schema", json_schema: EXTRACTION_SCHEMA },
  });
  if (!result.ok) return null;
  try {
    const parsed = JSON.parse(result.text) as { facts?: unknown };
    if (!Array.isArray(parsed.facts)) return null;
    const facts: ExtractedFact[] = [];
    for (const raw of parsed.facts.slice(0, MAX_FACTS_PER_TURN)) {
      const fact = normalizeFact(raw);
      if (fact) facts.push(fact);
    }
    return facts;
  } catch {
    return null;
  }
}

const DEDUPE_SCHEMA = {
  name: "memory_dedupe",
  schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["ADD", "SUPERSEDE"] },
      id: { type: ["string", "null"] },
      merged_text: { type: ["string", "null"] },
      contradiction: { type: "boolean" },
    },
    required: ["action"],
  },
} as const;

const DEDUPE_SYSTEM =
  'You manage a memory store. Given a new fact and similar existing memories, decide what to do. Respond with EXACTLY one JSON object: {"action":"ADD"|"SUPERSEDE","id":"<existing id or null>","merged_text":"<merged statement if SUPERSEDE, else null>","contradiction":true|false}.\n\n- ADD: genuinely new information not captured in any existing memory.\n- SUPERSEDE: the new fact refines, extends, or replaces an existing one - provide merged_text with the single best statement to keep. Set contradiction:true only when the new fact makes the old one flatly false (moved, no longer true), false when it merely adds detail to something still true.\n\nPrefer SUPERSEDE with contradiction:false when the two can be merged into one accurate statement.';

interface DedupeDecision {
  action: "ADD" | "SUPERSEDE";
  id?: string;
  mergedText?: string;
  contradiction?: boolean;
}

const DEDUPE_COSINE_BAND_LOW = 0.60;
const DEDUPE_COSINE_BAND_HIGH = 0.92;

/** Phase 2: never counts against the poison guard (see this file's own
 * header) - any failure here just defaults to ADD, the exact fallback
 * legacy's own catch block used. Dedupe asks the model only for cosine
 * similarity in the ambiguous band (0.60 to 0.92); outside that band,
 * the decision is deterministic: near-identical is SUPERSEDE, clearly
 * new is ADD. */
async function decideDedupe(newText: string, candidates: SimilarMatch[]): Promise<DedupeDecision> {
  if (candidates.length === 0) return { action: "ADD" };
  const topCandidate = candidates[0]!;
  if (topCandidate.cosine >= DEDUPE_COSINE_BAND_HIGH) {
    return { action: "SUPERSEDE", id: topCandidate.record.id, mergedText: newText, contradiction: false };
  }
  if (topCandidate.cosine < DEDUPE_COSINE_BAND_LOW) {
    return { action: "ADD" };
  }
  const existingList = candidates.map((c) => `[${c.record.id}] ${c.record.text} (similarity ${c.cosine.toFixed(2)})`).join("\n");
  const prompt = `New fact: "${newText}"\n\nExisting similar memories:\n${existingList}`;
  try {
    const result = await completeBackground(
      [
        { role: "system", content: DEDUPE_SYSTEM },
        { role: "user", content: prompt },
      ],
      { temperature: 0.1, response_format: { type: "json_schema", json_schema: DEDUPE_SCHEMA } },
    );
    if (!result.ok) return { action: "ADD" };
    const parsed = JSON.parse(result.text) as { action?: unknown; id?: unknown; merged_text?: unknown; contradiction?: unknown };
    if (
      parsed.action === "SUPERSEDE" &&
      typeof parsed.id === "string" &&
      candidates.some((c) => c.record.id === parsed.id)
    ) {
      const mergedText = typeof parsed.merged_text === "string" && parsed.merged_text.trim() ? parsed.merged_text.trim() : newText;
      return { action: "SUPERSEDE", id: parsed.id, mergedText, contradiction: parsed.contradiction === true };
    }
    return { action: "ADD" };
  } catch {
    return { action: "ADD" };
  }
}

// Item 4b: both writers below touch only a still-unjudged turn. "Forget
// that" can mark the turn skipped while extraction runs (seconds); a
// failed attempt then must not put it back in the queue, and a finished
// one must not stamp it done (the second review's findings 3 and 4).
// Returns whether this attempt both is the terminal one (the poison
// guard giving up for good) AND actually landed - judgeTurn() uses this
// to fire memory.judge_failed exactly once, right at a REAL transition,
// never on an earlier retry and never when the guarded UPDATE below hit
// zero rows (a review finding: computing `failed` from `attempts` alone,
// independent of whether the write matched anything, could fire the
// notification for a turn a concurrent "forget that" had already marked
// `skipped` in the same race this function's own header comment already
// describes - the WHERE clause correctly left the row alone, but the
// return value didn't know that). Raw sqlite for `.changes`
// (personLifecycle.ts's own `.run().changes` escape hatch: Drizzle's
// bun-sqlite `.run()` types its result void), not Drizzle, since this is
// the one caller that needs to know whether the write actually matched.
function markAttempt(turnId: string, attempts: number): boolean {
  const failed = attempts >= MAX_JUDGE_ATTEMPTS;
  const changes = sqlite
    .query("UPDATE conversation_turns SET judge_attempts = ?, judge_status = ?, hlc = ? WHERE id = ? AND judge_status IS NULL")
    .run(attempts, failed ? "failed" : null, nextHlc(), turnId).changes;
  return failed && changes > 0;
}
function markDone(turnId: string): void {
  db.update(conversationTurns)
    .set({ judgeStatus: "done", hlc: nextHlc() })
    .where(and(eq(conversationTurns.id, turnId), isNull(conversationTurns.judgeStatus)))
    .run();
}

export interface JudgeTurnResult {
  ok: boolean;
  factsWritten: number;
}

/** Judges one turn: extract, dedupe each candidate against the speaker's
 * own readable records, write (remember or supersede), notify once if
 * anything was written, then mark the turn done. Never throws - every
 * failure mode either retries on a later tick (extraction) or safely
 * defaults to ADD (dedupe), per this file's own header. */
/** Step 3a: the registry entity a fact is about, or null. A fact with a
 * subject slot finds or creates it in the speaker's scope: `local` when
 * the speaker's own words name it, `inferred` when only the model did.
 * A plain fact naming an entity the speaker already has gets that one
 * (no creation from a plain mention: a name the model never tagged as
 * a subject is not evidence of a new person). A relation slot with no
 * subject names its entity the same way, with the kind the type's
 * other end admits. */
// REG-01's set: the 4B on "she's my sister" (an answer whose antecedent
// was in the previous turn) named the subject "she" and the registry
// gained a person called she. A pronoun or a bare relation word is never
// a name; the fact is dropped and the row says why.
const PRONOUN_NAME = /^\s*(?:she|he|they|it|her|him|them|we|us|you|i|me|my|mine|his|hers|theirs|this|that|someone|somebody|anyone|everyone|nobody)\s*$/i;
const RELATION_WORD_NAME = /^\s*(?:sister|brother|mom|dad|mother|father|parent|friend|coworker|colleague|neighbou?r|boss|partner|the (?:dog|cat|kids?|baby))\s*$/i;

/** The subject or relation name the fact carries when it is not a name
 * at all: a pronoun always; a bare relation word unless the household
 * knows someone by it ("Mom" as a nickname is a name). The fact is
 * dropped whole, never written with a pronoun as its subject. */
function subjectNotAName(speaker: PersonRow, fact: ExtractedFact): string | null {
  const name = fact.subject?.name ?? fact.relation?.name ?? null;
  if (name === null) return null;
  if (PRONOUN_NAME.test(name)) return name.trim();
  if (RELATION_WORD_NAME.test(name) && !findSubjectByName(speaker, name)) return name.trim();
  return null;
}

function resolveSubject(speaker: PersonRow, fact: ExtractedFact, turn: ConversationTurnRow): Entity | null {
  const named = fact.subject ?? (fact.relation ? { name: fact.relation.name, kind: kindForRelation(fact.relation.type, fact.category) } : null);
  if (named) {
    // ASK-01 (step 3a's amendment): `local` needs the speaker's words
    // to carry the name AND its kind (a kind noun beside it, "my
    // coworker Quill"); a name alone ("juniper chewed the hose") is
    // the model's kind guess, an inferred candidate with the open
    // question below, never rendered as knowledge until the person
    // answers.
    // The two-turn household-frame rule: the name may sit in the
    // previous user turn and the kind noun with a pronoun in this one.
    const previous = previousUserText(turn) ?? undefined;
    const twoTurn = twoTurnStatedKind(turn.userText, named.name, named.kind, previous);
    const stated = (speakerNamed(turn.userText, named.name) && speakerStatedKind(turn.userText, named.name, named.kind)) || twoTurn;
    const result = ensureSubjectEntity(speaker, named, stated);
    if (result.ok && result.value) {
      if (result.status === 201 && twoTurn) {
        const pronouns = statedPronounFor(turn.userText, named.name, named.kind, previous);
        if (pronouns) updateEntity(speaker, result.value.id, { pronouns });
      }
      // A name the person already declined to explain ("never mind" to
      // the engine's own ask) is not asked about again by the judge.
      if (result.status === 201 && result.value.source === "inferred" && !openQuestionDeclined(speaker.id, candidateQuestion("entity", result.value.name))) {
        queueOpenQuestion({ person: speaker.id, conversationId: turn.conversationId, kind: "who", text: candidateQuestion("entity", result.value.name), subjectId: result.value.id, source: turn.id });
        console.log(`[memoryJudge] an inferred entity is a candidate with an open question (turn ${turn.id})`);
      }
      return result.value;
    }
    console.error(`[memoryJudge] subject failed for turn ${turn.id}: ${result.error}`);
    return null;
  }
  return findEntityNamedIn(speaker, fact.text);
}

/** The relation a fact carries, written after its record. The other
 * end is the record's own subject, or an entity the speaker already
 * has: a relation slot never creates an entity of its own beside the
 * subject ("my sister Nadia's dog Rover is sick" is about Rover; a
 * Nadia the hub has never heard of is not made from a subordinate
 * clause), so every entity the judge makes is the subject of a record
 * and goes with it. `stated` is the model's flag only when the speaker's
 * own words name the entity, the same rule the subject path applies. */
function writeFactRelation(speaker: PersonRow, fact: ExtractedFact, subject: Entity | null, turn: ConversationTurnRow): void {
  const slot = fact.relation!;
  // The subject when the fact has no subject of its own (it was made
  // from this name) or the names agree; else what the name already
  // refers to (a household member by nickname included), never a new
  // entity. A relation the model pointed at the speaker themselves
  // ("Quill is Sage's coworker" read with Sage as the name) is the
  // subject's: the speaker is always one end, never the other.
  let other = subject && (!fact.subject || subject.name.trim().toLowerCase() === slot.name.trim().toLowerCase()) ? subject : (findSubjectByName(speaker, slot.name)?.value ?? null);
  const redirected = other !== null && other.account_person_id === speaker.id && subject !== null && subject.account_person_id !== speaker.id;
  if (redirected) other = subject!;
  if (!other) return;
  const names = [...(redirected ? [] : [slot.name]), other.name, ...other.aliases, ...(other.account_person_id ? memberNicknames(other.account_person_id) : [])];
  // A relation written from the subject's side ("Quill is Sage's
  // child" with Sage as the name) is the inverse from the speaker's
  // side, which is the side writeRelation() stores; a symmetric type is
  // its own. When the model named the speaker but kept the speaker's
  // own side ("my son Quill" as parent_of Marlow), the phrase beside
  // the name says which side it meant; the inverse otherwise.
  const inverse = relationshipTypes().find((t: { id: string }) => t.id === slot.type)?.inverse ?? slot.type;
  const type = !redirected ? slot.type : speakerStated(turn.userText, slot.type, names) && !speakerStated(turn.userText, inverse, names) ? slot.type : inverse;
  // Stated only when the speaker's words name the entity (by any name
  // they could use: the slot's, the entity's, an alias, a member's
  // nickname) and carry one of the type's own phrases ("my coworker")
  // beside it: the model's flag alone over-fires on an implied
  // relation.
  const relation = { ...slot, type, stated: slot.stated && speakerNamedAny(turn.userText, names) && speakerStated(turn.userText, type, names) };
  const result = writeRelation(speaker, relation, other, turn.id, fact.importance);
  if (!result.ok) {
    console.error(`[memoryJudge] relation ${relation.type} failed for turn ${turn.id}: ${result.error}`);
    return;
  }
  // ASK-01 part 4: a relation the model worked out is a candidate and
  // an open question ("Is Raven your coworker?"), asked once at the end
  // of the person's next reply; the answer confirms or replaces it.
  // An entity whose own question is already queued ("Who's Raven?")
  // covers the relation: its answer states both.
  if (result.status === 201 && result.value?.source === "inferred") {
    const phrase = relationPhraseFor(type);
    const entityQuestion = listOpenQuestions(speaker.id).find((q) => q.subjectId === other.id && (q.status === "pending" || q.status === "asked"));
    if (phrase && !entityQuestion) {
      queueOpenQuestion({ person: speaker.id, conversationId: turn.conversationId, kind: "who", text: candidateQuestion("relationship", other.name, phrase), subjectId: result.value.id, source: turn.id });
      console.log(`[memoryJudge] an inferred relation is a candidate with an open question (turn ${turn.id})`);
    }
  }
}

/** The person's previous user turn in the same conversation, or null. */
function previousUserText(turn: ConversationTurnRow): string | null {
  if (!turn.conversationId) return null;
  const row = db
    .select({ userText: conversationTurns.userText })
    .from(conversationTurns)
    .where(and(eq(conversationTurns.conversationId, turn.conversationId), eq(conversationTurns.personId, turn.personId), lt(conversationTurns.createdAt, turn.createdAt)))
    .orderBy(desc(conversationTurns.createdAt))
    .limit(1)
    .get();
  return row?.userText ?? null;
}

function memberNicknames(personId: string): string[] {
  const row = db.select({ nickname: people.nickname }).from(people).where(eq(people.id, personId)).get();
  return row?.nickname ? [row.nickname] : [];
}

export async function judgeTurn(turn: ConversationTurnRow): Promise<JudgeTurnResult> {
  // isNull(deletedAt) matters here the same way it does everywhere else
  // a person id becomes a write target (remember()'s own person-exists
  // check, resolveSession()): a soft-deleted person is not a valid
  // target for a NEW memory write, even one attributed to their own
  // past turn.
  const speaker = db.select().from(people).where(and(eq(people.id, turn.personId), isNull(people.deletedAt))).get();
  if (!speaker) {
    // The speaker was deleted since this turn was logged - nothing to
    // attribute a memory write to, and never recoverable by retrying.
    db.update(conversationTurns).set({ judgeStatus: "failed", hlc: nextHlc() }).where(eq(conversationTurns.id, turn.id)).run();
    return { ok: false, factsWritten: 0 };
  }

  // sanitizeForPrompt (SEC-8, code review, 2026-09-06): speaker.displayName
  // is free text the speaker set on their own profile, interpolated
  // straight into buildExtractionPrompt()'s system prompt below - the
  // same class of injection turnEngine.ts's speakerLine()/householdLine()
  // were fixed for.
  // #88: superseded between selection and judging (an edit landed while
  // the batch ran): off the current branch, marked done, nothing written.
  if (isSupersededTurn(turn.id)) {
    markDone(turn.id);
    return { ok: true, factsWritten: 0 };
  }
  if (isSkippedTurn(turn.id)) return { ok: true, factsWritten: 0 };
  // ACT-01 (section 12 part 6): the stored signal decides whether the
  // turn's speech can be evidence at all. logTurn() already skipped a
  // turn with no eligible clause at insert; this is the same test on
  // read, for a row whose status was cleared or written another way.
  const signal = turnSignalOf(turn);
  if (signal && !hasEligibleClause(signal)) {
    markSkipped(turn.id);
    return { ok: true, factsWritten: 0 };
  }
  // CHAT-03: a turn row that carries a credential (written before the
  // policy existed; a new one is logged redacted) is never sent to the
  // model. Marked done with nothing written, so it is not retried.
  if (detectCredential(turn.userText).detected || detectCredential(turn.replyText ?? "").detected) {
    markDone(turn.id);
    return { ok: true, factsWritten: 0 };
  }
  const speakerName = sanitizeForPrompt(speaker.displayName);
  const extracted = await extractFacts(speakerName, turn);
  if (extracted === null) {
    if (markAttempt(turn.id, turn.judgeAttempts + 1)) {
      await trigger("memory.judge_failed", {}, { personId: speaker.id, subjectTurnId: turn.id });
    }
    return { ok: false, factsWritten: 0 };
  }
  // The output-side rejection: the prompt's own examples, an unfilled
  // placeholder, a credential, and anything not grounded in the speaker's
  // words (MEM-06 (a); the confirmed assistant line is passed by a later
  // chunk). Counted per drop, so a run's log says how often the model
  // echoed its instructions or wrote what the person never said.
  const { kept: echoed, dropped: echoDropped } = rejectPromptEchoes(extracted, speakerName, turnDateFor(turn.createdAt), `${turn.userText}\n${turn.replyText}`);
  const { kept: ungroundedKept, dropped: ungroundedDropped } = rejectUngrounded(echoed, speakerName, turnDateFor(turn.createdAt), turn.userText, null);
  // MEM-06 (b): a passing state and a world-subject fact are not written -
  // a state whose verb is conversational is passing, a fact about the
  // turn's world subject (a lookup's title, a world subject on the stack)
  // is the world's unless it is the speaker's own preference or plan.
  const { kept: worldKept, dropped: worldDropped } = rejectWorld(ungroundedKept, worldTitlesFor(turn));
  const { kept: facts, dropped: passingDropped } = rejectPassing(worldKept);
  // MEM-06 (c): ground each surviving fact in the eligible clause it came
  // from; a fact whose best eligible clause shares no content, whose
  // proper nouns or numbers are absent from the cited clause, or whose
  // subject kind disagrees with the clause's subject, is dropped.
  const { kept: cited, dropped: citeDropped } = citeClause(facts, signal, turn.userText, speakerName, turnDateFor(turn.createdAt));
  // MEM-06 (d): the clause shapes the record - a reported clause writes
  // about the third party only, capped at 0.4 with the source named; a
  // commissive clause writes a goal, a project or a dated event and
  // nothing else; a moderate or high emotion writes a bounded state,
  // none or low writes no state; an explicit valid_to always wins.
  const { kept: shaped, dropped: shapeDropped } = shapeByClause(cited, turn.createdAt);
  const dropped = [...echoDropped, ...ungroundedDropped, ...worldDropped, ...passingDropped, ...citeDropped, ...shapeDropped];
  if (dropped.length > 0) {
    const counts: Record<string, number> = {};
    for (const d of dropped) counts[d.reason] = (counts[d.reason] ?? 0) + 1;
    console.log(`[memory.judge] turn ${turn.id}: dropped ${dropped.length} extracted candidate(s) ${JSON.stringify(counts)}`);
  }
  // #88, the race: the edit may have landed while the model extracted
  // (seconds), after archiveByProvenance() found nothing to retire; a
  // second look before any write, so the replaced statement's facts are
  // never written under a turn that is already off the branch.
  if (isSupersededTurn(turn.id)) {
    markDone(turn.id);
    return { ok: true, factsWritten: 0 };
  }
  if (isSkippedTurn(turn.id)) return { ok: true, factsWritten: 0 };

  let written = 0;
  let reassertCount = 0;
  const writtenTexts: string[] = [];
  // getmaipai/home#64: real ids for the memory.updated delivery below, so
  // chatMemoryChip.tsx has something to link to (/memory?ids=...) rather
  // than just a rendered summary.
  const writtenIds: string[] = [];
  for (const fact of shaped) {
    const notAName = subjectNotAName(speaker, fact);
    if (notAName) {
      console.log(`[memoryJudge] turn ${turn.id}: dropped a fact whose subject "${notAName.toLowerCase()}" is a pronoun or a relation word, not a name`);
      continue;
    }
    // getmaipai/home#63: a fact-heavy turn can still hold the chat engine
    // for several embed+dedupe calls even with MAX_TURNS_PER_RUN at 1 -
    // re-checked before EACH fact, not just once at runJudgeBatch()'s own
    // top, exactly like runConsolidation()'s own per-pair check already
    // does. `judgeStatus` is deliberately left unset (not "done") when
    // this trips: the next tick re-extracts and re-judges this same
    // turn from scratch, and any fact already written here is now a
    // candidate `decideDedupe()` will find and SUPERSEDE onto rather
    // than duplicate.
    if (turnActiveWithin(JUDGE_IDLE_WINDOW_MS)) {
      return { ok: true, factsWritten: written };
    }
    // #88: per fact, not once: an edit can land between one fact's
    // write and the next (each embed plus dedupe takes seconds).
    if (isSupersededTurn(turn.id)) {
      markDone(turn.id);
      return { ok: true, factsWritten: written };
    }
    if (isSkippedTurn(turn.id)) return { ok: true, factsWritten: written };
    // CHAT-03: an extracted candidate carrying a credential is dropped
    // before it is embedded, compared or written (remember() would
    // refuse it too; this keeps the value out of the embed request).
    if (detectCredential(fact.text).detected) continue;
    // CUR-01: an exact re-assertion is merged with the existing active
    // record, never written a second time. A state extends its own
    // valid_to to the later boundary; every other category just bumps
    // uses/lastUsedAt on the record it repeats (no fresh hlc - a usage
    // bump is not a content change, the same rule bumpMatchUsage()
    // follows). The re-assertion is counted on the turn's drop line
    // beside MEM-06's own reasons.
    const reassert = exactActiveMatch(speaker, fact);
    if (reassert) {
      if (fact.category === "state") {
        const newValidTo =
          fact.valid_to && (!reassert.validTo || fact.valid_to > reassert.validTo) ? fact.valid_to : reassert.validTo;
        db.update(memoryRecords)
          .set({ validTo: newValidTo, lastUsedAt: new Date().toISOString(), uses: reassert.uses + 1, hlc: nextHlc() })
          .where(eq(memoryRecords.id, reassert.id))
          .run();
        console.log(`[memoryJudge] turn ${turn.id}: re-asserted state ${reassert.id}`);
      } else {
        db.update(memoryRecords)
          .set({ lastUsedAt: new Date().toISOString(), uses: reassert.uses + 1 })
          .where(eq(memoryRecords.id, reassert.id))
          .run();
        console.log(`[memoryJudge] turn ${turn.id}: duplicate of ${reassert.id}`);
      }
      reassertCount++;
      // A re-asserted fact still carries its subject and relation: the
      // record already exists, so it is not written a second time, but
      // the subject and the relation the speaker states with it are
      // written the same way the write path does them, on this record.
      const subject = resolveSubject(speaker, fact, turn);
      if (fact.relation) writeFactRelation(speaker, fact, subject, turn);
      continue;
    }
    const embedded = await embed([fact.text]);
    const vector = embedded.ok
      ? {
          vector: new Float32Array(embedded.value.vectors[0]!),
          space: embedded.value.model,
          dims: embedded.value.vectors[0]!.length,
          preprocess: embedded.value.preprocess,
        }
      : undefined;
    const candidates = vector
      ? similarByVector(
          speaker,
          vector,
          fact.scope === "person" ? { scope: "person", person: speaker.id } : { scope: "household" },
          categoryToRecordKind(fact.category),
        )
      : [];
    const decision = await decideDedupe(fact.text, candidates);
    // Item 4b, once more just before the write: embed() plus
    // decideDedupe() took seconds, and a "forget that" in that window
    // must win (forgetCommand.ts also sweeps a record that slips past).
    if (isSkippedTurn(turn.id)) return { ok: true, factsWritten: written };
    // Step 3a: whose fact this is. Resolved after the last skip check
    // and right before the write, so a forgotten turn leaves no entity
    // behind; the relation follows a record that was written (a
    // relation with no fact behind it is nothing to review), and both
    // go with the record when it is later forgotten or its turn edited
    // (retireOrphanSubjects in subjects.ts).
    const subject = resolveSubject(speaker, fact, turn);
    let recordWritten = false;

    if (decision.action === "SUPERSEDE" && decision.id) {
      // closeValidTo is "when did the OLD fact stop being true," which is
      // this turn's own timestamp (when we learned it changed) - never
      // the NEW fact's own valid_to (a code review, 2026-09-05, found an
      // earlier version conflating the two: a contradicting fact that
      // happened to carry its own valid_to, e.g. a trip's end date, was
      // stamping the OLD record's boundary with the trip's end instead
      // of with when the contradiction was actually learned).
      // enforcePrivilegedRoute (a code review of issue #27's fix,
      // 2026-09-06): speaker is whoever's turn this was - any household
      // role, including a child - and similarByVector()'s own candidate
      // search does not exclude pinned records, so an ordinary chat turn
      // could dedupe onto and silently rewrite one with no check at all
      // otherwise. Distinct from this file's OTHER supersede() call
      // (the profile-paragraph summarizer, SupersedeOptions' own comment
      // has the reasoning): that one only ever writes a person's own
      // pinned summary of themselves, this one can target ANY household
      // or person-scope candidate similarByVector() turned up.
      const result = supersede(
        speaker,
        decision.id,
        {
          text: decision.mergedText ?? fact.text,
          importance: fact.importance,
          source: turn.id,
          valid_from: fact.valid_from,
          valid_to: fact.valid_to,
          subject_id: subject?.id,
        },
        { ...(decision.contradiction ? { closeValidTo: turn.createdAt } : {}), enforcePrivilegedRoute: true },
      );
      if (result.ok) {
        written++;
        recordWritten = true;
        writtenTexts.push(decision.mergedText ?? fact.text);
        writtenIds.push(result.value.created.id);
      } else {
        // Never counts against the poison guard (extraction already
        // succeeded - this is a single fact's own write failing its
        // validation), but a code review (2026-09-05) found this was
        // silently dropped with no trace at all: logged now, the same
        // "best effort per row, but never silent" discipline
        // drainPendingEmbeddings() already applies to its own batch.
        console.error(`[memoryJudge] supersede failed for turn ${turn.id}: ${result.error}`);
      }
    } else {
      // Issue #52 (Jesse's own design call): a person is in control of
      // their OWN memories, but a household-scope entity is shared
      // household knowledge, the same thing routes/memory.ts's
      // sanitizedRecordKind() already restricts to owner/admin on the
      // direct API - this ADD path bypassed that entirely by calling
      // remember() directly. Downgraded to a plain memory rather than
      // blocked outright, the same "privileged field, silently
      // downgraded rather than a 403" shape that route already uses:
      // the FACT itself is still worth remembering (a child mentioning
      // the family dog is real, useful context), it just doesn't get to
      // create a shared entity record in the household's registry.
      // person-scope entities are unaffected - that's the speaker's own
      // memory to keep however they like.
      let recordKind = categoryToRecordKind(fact.category);
      if (fact.scope === "household" && isPrivilegedRecordKind(recordKind) && !isOwnerOrAdmin(speaker)) {
        recordKind = "memory";
      }
      const result = remember(speaker, {
        text: fact.text,
        record_kind: recordKind,
        category: fact.category,
        tier: categoryToTier(fact.category),
        scope: fact.scope,
        person: fact.scope === "person" ? speaker.id : undefined,
        source: turn.id,
        importance: fact.importance,
        child_disclosure: defaultChildDisclosure(fact.text, { sensitive: false, scope: fact.scope }),
        valid_from: fact.valid_from,
        valid_to: fact.valid_to,
        subject_id: subject?.id ?? null,
        // Reuses the vector already computed above for this exact text
        // (safe here specifically: the ADD path always stores fact.text
        // verbatim, unlike SUPERSEDE's own decision.mergedText, which
        // can differ from what was embedded - see RememberInput's own
        // comment on why this field only travels with an exact match).
        precomputed_embedding: embedded.ok
          ? { space: embedded.value.model, vector: embedded.value.vectors[0]!, preprocess: embedded.value.preprocess }
          : undefined,
      });
      if (result.ok) {
        written++;
        recordWritten = true;
        writtenTexts.push(fact.text);
        writtenIds.push(result.value.id);
      } else {
        console.error(`[memoryJudge] remember failed for turn ${turn.id}: ${result.error}`);
      }
    }
    if (fact.relation && recordWritten) writeFactRelation(speaker, fact, subject, turn);
    // A write the store refused (a child's fact deduping onto a pinned
    // record, a validation) leaves no entity behind either: the one
    // just made for it, with nothing citing it, goes by the same rule
    // a forgotten record's does.
    if (!recordWritten && subject) retireOrphanSubjects([{ subjectId: subject.id }]);
  }

  if (reassertCount > 0) {
    console.log(`[memoryJudge] turn ${turn.id}: re-asserted ${reassertCount} existing record(s), nothing written`);
  }
  markDone(turn.id);

  if (written > 0) {
    const summary = writtenTexts.length === 1 ? writtenTexts[0]! : `${writtenTexts.length} things from our conversation`;
    await trigger("memory.updated", { summary }, { personId: speaker.id, subjectTurnId: turn.id, memoryIds: writtenIds });
  }

  return { ok: true, factsWritten: written };
}

export interface JudgeBatchResult {
  processed: number;
  factsWritten: number;
}

// A latency review (2026-09-06) found this tick sharing the household's
// one chat engine slot with live turns with no coordination at all: every
// extraction/dedupe call here evicts the household's own conversation
// prefix from llama-server's cache and queues right in front of whatever
// real turn comes next, "very likely the largest latency variance source
// in family use." Skipping a tick that lands mid-conversation costs
// nothing real - scheduler.ts's own runDueJobs() computes the NEXT fire
// from the job's recurrence interval, not from when this tick actually
// ran, so a skipped batch simply gets picked up a minute later, same as
// The idle window was 20s when the judge and chat engine shared a slot;
// now that background work is on its own engine, a shorter window lets
// the judge drain faster when idle.
const JUDGE_IDLE_WINDOW_MS = 5_000;
const MAX_JUDGE_BATCH_TURNS = 50;
const MAX_JUDGE_BATCH_MS = 5 * 60 * 1000; // 5 minutes

export interface JudgeQueueStats {
  pending: number;
  oldestCreatedAt: string | null;
}

// #88: a turn another turn in its conversation names in `supersedes`
// (edited and resent) is off the current branch: never drained, never
// counted as pending.
function supersededTurnIdsQuery() {
  return db.select({ id: conversationTurns.supersedes }).from(conversationTurns).where(isNotNull(conversationTurns.supersedes));
}
function isSupersededTurn(turnId: string): boolean {
  return db.select({ id: conversationTurns.id }).from(conversationTurns).where(eq(conversationTurns.supersedes, turnId)).get() !== undefined;
}
// Item 4b: "forget that" marks an unjudged turn skipped; like an edit
// (#88) it can land between selection and any write, so it is re-read
// at the same three points. A skipped turn keeps its status (never
// overwritten with "done") and writes nothing.
function isSkippedTurn(turnId: string): boolean {
  const row = db.select({ status: conversationTurns.judgeStatus }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
  return row?.status === "skipped";
}
// ACT-01: the queue is keyed on the stored signal, not on the reply's
// source: any unjudged turn that carries one is the judge's (logTurn()
// marked the ineligible ones skipped at insert), so a disclosure beside
// a package answer is judged (CHAT-07's gap). A row written before the
// signal existed keeps the old rule, model turns only.
// getmaipai/home#131: excludes status="running" - insertProvisionalTurn()
// (conversationHistory.ts) writes a real row with source: "model" (a
// placeholder) and judgeStatus left at its default null the moment a
// turn starts, which is exactly this query's own shape. turnActiveWithin()
// (turnActivity.ts) gates the judge's own scheduler tick against a live
// TurnLease, but that lease releases once the token stream ends, before
// finalize()/logTurn() necessarily runs - a slow or delayed finalize can
// leave a stale "running" row queryable here for longer than the lease
// gate covers. Excluded here directly rather than relying on that timing.
function pendingTurnWhere() {
  // ADMIN-COMPARE-01 (b): a bare turn is a diagnostic, not something the
  // household should remember - `logTurn()` marks it `judgeStatus:
  // "skipped"` at insert (the same "ineligible ones skipped at insert"
  // pattern this comment block already describes), so `isNull(judgeStatus)`
  // alone already excludes it; `eq(bare, false)` here is a second, direct
  // guard that stays correct even if a future write path forgets that.
  return and(or(isNotNull(conversationTurns.signal), eq(conversationTurns.source, "model")), isNull(conversationTurns.judgeStatus), eq(conversationTurns.status, "done"), eq(conversationTurns.bare, false), notInArray(conversationTurns.id, supersededTurnIdsQuery()));
}
function markSkipped(turnId: string): void {
  db.update(conversationTurns).set({ judgeStatus: "skipped", hlc: nextHlc() }).where(and(eq(conversationTurns.id, turnId), isNull(conversationTurns.judgeStatus))).run();
}

export function judgeQueueStats(): JudgeQueueStats {
  const [oldest] = db.select({ createdAt: conversationTurns.createdAt }).from(conversationTurns).where(pendingTurnWhere()).orderBy(asc(conversationTurns.createdAt)).limit(1).all();
  const all = db.select({ id: conversationTurns.id }).from(conversationTurns).where(pendingTurnWhere()).all();
  return { pending: all.length, oldestCreatedAt: oldest?.createdAt ?? null };
}

/** The core job's own entry point (scheduler.ts's "memory.judge",
 * every:1m): drains pending still-unjudged model turns (oldest first),
 * bounded by time and count, until none remain, a person speaks, or
 * limits are hit. */
export async function runJudgeBatch(): Promise<JudgeBatchResult> {
  if (turnActiveWithin(JUDGE_IDLE_WINDOW_MS)) return { processed: 0, factsWritten: 0 };

  let processed = 0;
  let factsWritten = 0;
  const startMs = Date.now();

  while (true) {
    if (processed >= MAX_JUDGE_BATCH_TURNS) break;
    if (Date.now() - startMs >= MAX_JUDGE_BATCH_MS) break;
    if (turnActiveWithin(JUDGE_IDLE_WINDOW_MS)) break;

    const pending = db.select().from(conversationTurns).where(pendingTurnWhere()).orderBy(asc(conversationTurns.createdAt)).limit(1).all();

    if (pending.length === 0) break;

    const turn = pending[0]!;
    const result = await judgeTurn(turn);
    processed++;
    factsWritten += result.factsWritten;
  }

  const stats = judgeQueueStats();
  console.log(`[memory.judge] processed=${processed} pending=${stats.pending} oldest_age_s=${stats.oldestCreatedAt ? Math.round((Date.now() - new Date(stats.oldestCreatedAt).getTime()) / 1000) : null}`);

  return { processed, factsWritten };
}

// ==== memory.consolidate: the idle-time weekly job ====
//
// Scoped down from the plan's own three-part description ("merge point
// facts into durative ones, re-tense expired states, demote durable
// records that have never been recalled") to the two parts cleanly
// buildable on what this store already exposes - real, named gaps, not
// silently dropped:
// - Near-duplicate MERGE (legacy's consolidate.ts MERGE_COSINE=0.86
//   pass, folding two overlapping facts into one) needs a "retire two
//   old records into one brand-new merged one" primitive this store
//   doesn't have (supersede() replaces exactly one). Building that
//   cleanly is real work, not a quick add - deferred, not faked with a
//   layering shortcut into memoryRecords directly from here.
// - "Re-tense expired states" has no real action to take yet: nothing
//   consumes valid_to today, and states already hard-expire via
//   runMaintenance()'s own STATE_EXPIRY_DAYS. Real bi-temporal
//   consumption is step 10's own job ("tombstones and clock stamps"),
//   not this one's to anticipate.
//
// What IS built: contradiction detection (ported from legacy's own
// CONTRA_COSINE_MIN/MAX pass) and demoting never-recalled durable
// records (BACKLOG.md's "mis-tiered junk is immortal" finding) - both
// real, both testable without inventing a new store primitive.
const CONTRA_COSINE_MIN = 0.55;
const CONTRA_COSINE_MAX = 0.86;
const MAX_CONTRA_CHECKS_PER_RUN = 15;

const CONTRA_SCHEMA = {
  name: "memory_contradiction",
  schema: { type: "object", properties: { contradicts: { type: "boolean" } }, required: ["contradicts"] },
} as const;

async function checkContradiction(older: string, newer: string): Promise<boolean> {
  try {
    const result = await completeBackground(
      [
        {
          role: "system",
          content:
            'Do these two remembered facts CONTRADICT each other (both cannot be true at once), or can they coexist? Respond with EXACTLY one JSON object: {"contradicts":true|false}.',
        },
        { role: "user", content: `Fact A (older): "${older}"\nFact B (newer): "${newer}"` },
      ],
      { temperature: 0.1, response_format: { type: "json_schema", json_schema: CONTRA_SCHEMA } },
    );
    if (!result.ok) return false;
    const parsed = JSON.parse(result.text) as { contradicts?: unknown };
    return parsed.contradicts === true;
  } catch {
    return false;
  }
}

// ==== Step 7: the profile paragraph (written only here, per the plan's
// own "never by the extractor directly") ====

const PROFILE_MAX_CHARS = 600; // the plan's own cap, enforced in code, not just asked of the model
const MAX_PROFILE_INPUT_FACTS = 20; // bounds prompt size regardless of how many facts a long-lived household member accumulates
const MAX_PROFILE_REWRITES_PER_RUN = 20; // one consolidate tick amortizes over a household this large before the next weekly run picks up the rest

const PROFILE_SCHEMA = {
  name: "profile_paragraph",
  schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
} as const;

/** Synthesizes and writes/rewrites one person's profile paragraph from
 * their own active person-scope facts (never household-shared ones - a
 * profile is inherently personal). Returns whether it actually wrote
 * something; a person with no eligible facts yet, or a model call that
 * fails, is a real, silent no-op - there's nothing this run could say
 * about them that wouldn't be invented. */
async function rewriteProfileParagraph(personRow: PersonRow): Promise<boolean> {
  // list()'s own ordering (pinned, then importance, then recency) already
  // picks the most representative facts first - reusing it here is the
  // same "don't re-invent a second ranking" the rest of this file already
  // leans on. The profile's own prior record is excluded by source, and
  // record_kind is restricted to plain facts: an entity record's "Name:
  // description" text isn't a fact ABOUT this person.
  const facts = list(personRow, { scope: "person", person: personRow.id })
    .filter((r) => r.source !== PROFILE_SOURCE && r.record_kind === "memory")
    .slice(0, MAX_PROFILE_INPUT_FACTS);
  if (facts.length === 0) return false;

  const factLines = facts.map((f) => `- ${f.text}`).join("\n");
  // sanitizeForPrompt (SEC-8, code review, 2026-09-06): personRow.displayName
  // is free text the person set on their own profile - see extractFacts()'s
  // own call above for the identical reasoning.
  const safeDisplayName = sanitizeForPrompt(personRow.displayName);
  const prompt = `Write a single plain-prose paragraph (at most ${PROFILE_MAX_CHARS} characters) summarizing who ${safeDisplayName} is, what they like, and what's going on with them this week, based ONLY on the facts below - never invent anything not listed, and never mention a fact that isn't there. No bullet points or headings, third person, plain prose.\n\nKnown facts about ${safeDisplayName}:\n${factLines}`;

  let text: string;
  try {
    const result = await completeBackground(
      [
        { role: "system", content: prompt },
        { role: "user", content: "Write the paragraph now." },
      ],
      { temperature: 0.3, response_format: { type: "json_schema", json_schema: PROFILE_SCHEMA } },
    );
    if (!result.ok) return false;
    const parsed = JSON.parse(result.text) as { text?: unknown };
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return false;
    const raw = parsed.text.trim();
    // A code review (2026-09-05) found a bare slice() could cut mid-word
    // or mid-sentence with no indication anything was truncated - the
    // household would read a paragraph that just stops. Same "the
    // ellipsis counts INSIDE the cap" contract capSection() already
    // established for prompt sections (step 4), applied here since a
    // reused import across these two files isn't warranted for three
    // lines of string slicing.
    text = raw.length > PROFILE_MAX_CHARS ? raw.slice(0, PROFILE_MAX_CHARS - 3) + "..." : raw;
  } catch {
    return false;
  }

  const existing = db
    .select()
    .from(memoryRecords)
    .where(and(eq(memoryRecords.person, personRow.id), eq(memoryRecords.source, PROFILE_SOURCE), eq(memoryRecords.status, "active")))
    .get();

  if (existing) {
    const result = supersede(personRow, existing.id, {
      text,
      category: "identity",
      tier: "durable",
      pinned: true,
      importance: 0.9,
      source: PROFILE_SOURCE,
    });
    return result.ok;
  }
  const result = remember(personRow, {
    text,
    category: "identity",
    tier: "durable",
    scope: "person",
    person: personRow.id,
    source: PROFILE_SOURCE,
    importance: 0.9,
    pinned: true,
  });
  return result.ok;
}

export interface ConsolidateResult {
  contradictionsSuperseded: number;
  demoted: number;
  profilesRewritten: number;
}

/** Groups active durable records by (scope, person, category) and checks
 * every mid-similarity pair (cosine in [0.55, 0.86) - related but not a
 * near-duplicate) for a real contradiction, bounded per run the same way
 * legacy's own pass was. Then demotes never-recalled durable records
 * separately (pure code, no LLM). No actor: this is a household-wide
 * sweep, same shape as runMaintenance(). */
export async function runConsolidation(): Promise<ConsolidateResult> {
  // Raw rows, no actor/canRead filtering - a household-wide sweep has to
  // see every person's durable records, including scope=person ones no
  // single actor could browse together, the same reason runMaintenance()
  // above queries memoryRecords directly instead of going through list().
  // Never the profile paragraph itself: it's category:"identity",
  // tier:"durable", scope:"person" - the exact same bucket as a
  // person's own real identity facts - so without this exclusion a
  // code review (2026-09-05) found it could land in the SAME
  // contradiction-check group as those facts. A real fact superseded
  // "in favor of" a synthesized paragraph (or the profile row itself
  // marked superseded outside rewriteProfileParagraph()'s own
  // supersede-or-remember logic, silently breaking "written and
  // rewritten only by this pass") is a genuine correctness risk, not
  // just noise.
  const durable = db
    .select()
    .from(memoryRecords)
    .where(and(eq(memoryRecords.status, "active"), eq(memoryRecords.tier, "durable"), ne(memoryRecords.source, PROFILE_SOURCE)))
    .all();

  const byGroup = new Map<string, typeof durable>();
  for (const r of durable) {
    const key = `${r.scope}:${r.person ?? ""}:${r.category}`;
    const bucket = byGroup.get(key) ?? [];
    bucket.push(r);
    byGroup.set(key, bucket);
  }

  let contraChecks = 0;
  let contradictionsSuperseded = 0;
  const superseded = new Set<string>();

  for (const group of byGroup.values()) {
    const vectors = vectorsFor(group.map((r) => r.id));
    for (let i = 0; i < group.length && contraChecks < MAX_CONTRA_CHECKS_PER_RUN; i++) {
      const a = group[i]!;
      if (superseded.has(a.id)) continue;
      const va = vectors.get(a.id);
      if (!va) continue;
      for (let j = i + 1; j < group.length && contraChecks < MAX_CONTRA_CHECKS_PER_RUN; j++) {
        const b = group[j]!;
        if (superseded.has(b.id)) continue;
        const vb = vectors.get(b.id);
        if (!vb) continue;
        const cos = cosineSimilarity(va, vb);
        if (cos < CONTRA_COSINE_MIN || cos >= CONTRA_COSINE_MAX) continue;
        // A code review (2026-09-06) found this LLM call had no idle
        // gate at all, unlike runJudgeBatch()'s own turnActiveWithin()
        // check right above - the identical shared-chat-slot contention
        // that check exists to prevent, just reachable through the
        // weekly consolidate job instead of the per-minute judge one.
        // Skipped (not counted against contraChecks - no LLM call was
        // actually spent) rather than the whole run gated at the top:
        // this is a once-a-week job, and scheduler.ts computes its NEXT
        // fire from the recurrence interval, not from when this run
        // finished, so gating the whole function could silently drop an
        // entire week's contradiction pass instead of just this one
        // pair; an undetected contradiction waits for the next weekly
        // run either way, never a correctness problem.
        if (turnActiveWithin(JUDGE_IDLE_WINDOW_MS)) continue;
        contraChecks++;
        const older = a.createdAt <= b.createdAt ? a : b;
        const newer = older.id === a.id ? b : a;
        if (await checkContradiction(older.text, newer.text)) {
          if (supersedeInFavorOfExisting(older.id, newer.id, newer.createdAt)) {
            superseded.add(older.id);
            contradictionsSuperseded++;
            // `a` itself just got retired: a code review (2026-09-05)
            // found the inner loop kept pairing this now-dead record
            // against every remaining `b` in the group (only `b` was
            // ever re-checked against `superseded`, never `a` again
            // after the top of this outer iteration), which could
            // supersede the same old record a second time against a
            // DIFFERENT target - silently orphaning whichever one it
            // was first pointed at. Breaking here is exact, not a
            // heuristic: once `a` is superseded, every further pair
            // this outer iteration would form is meaningless.
            if (older.id === a.id) break;
          }
        }
      }
    }
  }

  const demoted = demoteNeverRecalledDurables();

  // Every distinct person with at least one eligible fact gets their
  // profile paragraph rewritten this run, bounded the same way the
  // passes above are. A person with zero eligible facts is never a
  // candidate at all (the WHERE clause below), so a fresh household
  // member with nothing said yet costs nothing here.
  const profileCandidates = db
    .selectDistinct({ person: memoryRecords.person })
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.status, "active"),
        eq(memoryRecords.scope, "person"),
        isNotNull(memoryRecords.person),
        ne(memoryRecords.source, PROFILE_SOURCE),
      ),
    )
    .all();

  // Least-recently-profiled first (never-profiled sorts first of all,
  // via the empty-string default): a code review (2026-09-05) found the
  // un-ordered query above left MAX_PROFILE_REWRITES_PER_RUN's own
  // cutoff arbitrary once a household has more eligible people than
  // that - not just non-deterministic, but potentially starving the
  // same people every single week if SQLite's own row order happens to
  // stay stable. This costs one extra query, not a join, and turns
  // "arbitrary" into "fair rotation."
  const existingProfiles = db
    .select({ person: memoryRecords.person, createdAt: memoryRecords.createdAt })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.source, PROFILE_SOURCE), eq(memoryRecords.status, "active")))
    .all();
  const profiledAt = new Map(existingProfiles.map((p) => [p.person, p.createdAt]));
  const orderedCandidates = [...profileCandidates].sort((a, b) => {
    const aTime = (a.person && profiledAt.get(a.person)) || "";
    const bTime = (b.person && profiledAt.get(b.person)) || "";
    return aTime.localeCompare(bTime);
  });

  let profilesRewritten = 0;
  for (const row of orderedCandidates.slice(0, MAX_PROFILE_REWRITES_PER_RUN)) {
    if (!row.person) continue;
    const personRow = db.select().from(people).where(and(eq(people.id, row.person), isNull(people.deletedAt))).get();
    if (!personRow) continue; // soft-deleted since - nothing to profile
    if (await rewriteProfileParagraph(personRow)) profilesRewritten++;
  }

  return { contradictionsSuperseded, demoted, profilesRewritten };
}
