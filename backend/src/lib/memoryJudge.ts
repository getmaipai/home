// The memory judge (platform plan 4.4's "judge" half, session-a-
// intelligence.md step 6): a post-turn core job that reads a completed
// `source: "model"` turn and decides what, if anything, is worth
// remembering from it - the "sleep-time" pattern (Letta), adapted from
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
import { eq, and, isNull, isNotNull, ne, asc } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, people, memoryRecords } from "@/db/schema";
import { complete, embed, type LlmMessage } from "@/lib/llm";
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
  type SimilarMatch,
} from "@/lib/memory";
import { trigger } from "@/lib/notifications";
import { sanitizeForPrompt } from "@/lib/promptSanitize";
import { nextHlc } from "@/lib/hlc";
import { turnActiveWithin, DEFAULT_IDLE_WINDOW_MS } from "@/lib/turnActivity";
import type { ConversationTurnRow } from "@/wire";
import type { PersonRow } from "@/types";

const MAX_JUDGE_ATTEMPTS = 3;
const MAX_FACTS_PER_TURN = 12;
// One core-job tick processes a bounded batch, not the whole backlog at
// once - the same "amortize over ticks, never monopolize the model"
// discipline legacy's own consolidate.ts used (MAX_MERGES_PER_RUN).
const MAX_TURNS_PER_RUN = 10;

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
          },
          required: ["text", "category", "scope", "importance"],
        },
      },
    },
    required: ["facts"],
  },
} as const;

function buildExtractionPrompt(speakerName: string, turnTimestamp: string): string {
  const turnDateObj = new Date(turnTimestamp);
  const turnDate = turnDateObj.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  // A real, computed ISO-8601-with-offset example date (not a bare
  // "<the 20th>" placeholder) - a code review (2026-09-05) found the
  // prompt gave the model no format guidance for valid_from/valid_to at
  // all, and remember()'s own Zod gate rejects anything but
  // z.string().datetime({offset:true}); a plausible model output like
  // "2026-09-20" (no time, no offset) would fail validation and silently
  // drop the whole fact with no trace.
  const exampleFutureDate = new Date(turnDateObj.getTime() + 6 * 86_400_000).toISOString();
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

SCOPE - "person": a fact about ${speakerName} specifically. "household": a fact the whole family should know (the wifi password, the dog's name, the trash pickup day) - use household only when a new family member would need to be told it too.

Category options: ${CATEGORY_VALUES.join(", ")}.
Importance 0 to 1: identity/relationship = 0.9-1.0, strong preference = 0.7-0.8, project/goal = 0.5-0.6, minor fact = 0.3-0.4.

Examples (these exact names never recur in a real household - never copy them into a real fact):
- "How long until bacteria grows on meat left out?" -> nothing (a one-off question)
- "My brother Rover loves horror movies" -> {"text": "Rover loves horror movies, ${speakerName}'s brother", "category": "relationship", "scope": "person", "importance": 0.7}
- "I hate cilantro" -> {"text": "${speakerName} dislikes cilantro", "category": "preference", "scope": "person", "importance": 0.7}
- "The wifi password is Juniper2026" -> {"text": "the wifi password is Juniper2026", "category": "fact", "scope": "household", "importance": 0.6}
- "We're in Brazil until next week visiting my wife's family" -> {"text": "${speakerName} was in Brazil visiting his wife's family, ${turnDate}", "category": "state", "scope": "person", "importance": 0.5, "valid_to": "${exampleFutureDate}"}

Return ONLY a JSON object: {"facts": [...]} (an empty array if nothing qualifies). At most ${MAX_FACTS_PER_TURN} facts.`;
}

interface ExtractedFact {
  text: string;
  category: Category;
  scope: "person" | "household";
  importance: number;
  valid_from: string | null;
  valid_to: string | null;
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
  return {
    text: r.text.trim().slice(0, 500),
    category: r.category,
    scope,
    importance,
    valid_from: normalizeDate(r.valid_from),
    valid_to: normalizeDate(r.valid_to),
  };
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
  const result = await complete("chat", messages, {
    temperature: 0.1,
    response_format: { type: "json_schema", json_schema: EXTRACTION_SCHEMA },
  });
  if (!result.ok) return null;
  try {
    const parsed = JSON.parse(result.value.text) as { facts?: unknown };
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

/** Phase 2: never counts against the poison guard (see this file's own
 * header) - any failure here just defaults to ADD, the exact fallback
 * legacy's own catch block used. */
async function decideDedupe(newText: string, candidates: SimilarMatch[]): Promise<DedupeDecision> {
  if (candidates.length === 0) return { action: "ADD" };
  const existingList = candidates.map((c) => `[${c.record.id}] ${c.record.text} (similarity ${c.cosine.toFixed(2)})`).join("\n");
  const prompt = `New fact: "${newText}"\n\nExisting similar memories:\n${existingList}`;
  try {
    const result = await complete(
      "chat",
      [
        { role: "system", content: DEDUPE_SYSTEM },
        { role: "user", content: prompt },
      ],
      { temperature: 0.1, response_format: { type: "json_schema", json_schema: DEDUPE_SCHEMA } },
    );
    if (!result.ok) return { action: "ADD" };
    const parsed = JSON.parse(result.value.text) as { action?: unknown; id?: unknown; merged_text?: unknown; contradiction?: unknown };
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

function markAttempt(turnId: string, attempts: number): void {
  const status = attempts >= MAX_JUDGE_ATTEMPTS ? "failed" : null;
  db.update(conversationTurns).set({ judgeAttempts: attempts, judgeStatus: status, hlc: nextHlc() }).where(eq(conversationTurns.id, turnId)).run();
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
  const facts = await extractFacts(sanitizeForPrompt(speaker.displayName), turn);
  if (facts === null) {
    markAttempt(turn.id, turn.judgeAttempts + 1);
    return { ok: false, factsWritten: 0 };
  }

  let written = 0;
  const writtenTexts: string[] = [];
  for (const fact of facts) {
    const embedded = await embed([fact.text]);
    const vector = embedded.ok ? new Float32Array(embedded.value.vectors[0]!) : undefined;
    const candidates = vector
      ? similarByVector(
          speaker,
          vector,
          fact.scope === "person" ? { scope: "person", person: speaker.id } : { scope: "household" },
          categoryToRecordKind(fact.category),
        )
      : [];
    const decision = await decideDedupe(fact.text, candidates);

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
        },
        { ...(decision.contradiction ? { closeValidTo: turn.createdAt } : {}), enforcePrivilegedRoute: true },
      );
      if (result.ok) {
        written++;
        writtenTexts.push(decision.mergedText ?? fact.text);
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
      const result = remember(speaker, {
        text: fact.text,
        record_kind: categoryToRecordKind(fact.category),
        category: fact.category,
        tier: categoryToTier(fact.category),
        scope: fact.scope,
        person: fact.scope === "person" ? speaker.id : undefined,
        source: turn.id,
        importance: fact.importance,
        valid_from: fact.valid_from,
        valid_to: fact.valid_to,
        // Reuses the vector already computed above for this exact text
        // (safe here specifically: the ADD path always stores fact.text
        // verbatim, unlike SUPERSEDE's own decision.mergedText, which
        // can differ from what was embedded - see RememberInput's own
        // comment on why this field only travels with an exact match).
        precomputed_embedding: embedded.ok ? { space: embedded.value.model, vector: embedded.value.vectors[0]! } : undefined,
      });
      if (result.ok) {
        written++;
        writtenTexts.push(fact.text);
      } else {
        console.error(`[memoryJudge] remember failed for turn ${turn.id}: ${result.error}`);
      }
    }
  }

  db.update(conversationTurns).set({ judgeStatus: "done", hlc: nextHlc() }).where(eq(conversationTurns.id, turn.id)).run();

  if (written > 0) {
    const summary = writtenTexts.length === 1 ? writtenTexts[0]! : `${writtenTexts.length} things from our conversation`;
    await trigger("memory.updated", { summary }, { personId: speaker.id });
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
// any other late tick; MAX_TURNS_PER_RUN's own oldest-first ordering
// already handles a backlog from several skipped ticks in a row.
const JUDGE_IDLE_WINDOW_MS = DEFAULT_IDLE_WINDOW_MS;

/** The core job's own entry point (scheduler.ts's "memory.judge",
 * every:1m): picks up to MAX_TURNS_PER_RUN still-unjudged model turns,
 * oldest first, and judges each in turn. */
export async function runJudgeBatch(): Promise<JudgeBatchResult> {
  if (turnActiveWithin(JUDGE_IDLE_WINDOW_MS)) return { processed: 0, factsWritten: 0 };

  const pending = db
    .select()
    .from(conversationTurns)
    .where(and(eq(conversationTurns.source, "model"), isNull(conversationTurns.judgeStatus)))
    .orderBy(asc(conversationTurns.createdAt))
    .limit(MAX_TURNS_PER_RUN)
    .all();

  let processed = 0;
  let factsWritten = 0;
  for (const turn of pending) {
    const result = await judgeTurn(turn);
    processed++;
    factsWritten += result.factsWritten;
  }
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
    const result = await complete(
      "chat",
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
    const parsed = JSON.parse(result.value.text) as { contradicts?: unknown };
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
    const result = await complete(
      "chat",
      [
        { role: "system", content: prompt },
        { role: "user", content: "Write the paragraph now." },
      ],
      { temperature: 0.3, response_format: { type: "json_schema", json_schema: PROFILE_SCHEMA } },
    );
    if (!result.ok) return false;
    const parsed = JSON.parse(result.value.text) as { text?: unknown };
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
