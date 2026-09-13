// Tier 1 routing on real embeddings (session-c-brain-and-voice.md step 1),
// replacing turnEngine.ts's own documented placeholder: `exampleScore()`
// there was keyword overlap against `routing.examples` "since no embedder
// exists (4.11's embed role)" - lib/llm.ts's `embed()` is real now
// (session-c-brain-and-voice.md step 0 extended it for the per-person
// rate limiter; the embed role itself shipped in session-a-intelligence.md
// step 5). This module owns the real thing; turnEngine.ts keeps
// `exampleScore()` only as the keyword-overlap fallback for when the
// embed backend is down, exactly as this step's own text asks for.
//
// The store mirrors memory.ts's `memoryEmbeddings` (same buffer shape:
// `space`/`dims`/`vector`/`hlc`, reusing its `vectorToBuffer`/
// `bufferToVector`), keyed instead by (package_id, example_hash, space):
// a package declares several `routing.examples`, not one, and hashing
// each example's own text is what makes "a changed example re-embeds, an
// unchanged one is a pure lookup" real rather than an unenforced
// intention. No space reconciliation beyond memory.ts's own precedent
// (recall()'s cosine comparison never filters by space either): a single
// pinned embedding model is the whole household's reality today, and a
// model change is a future migration, not a per-call check here.
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { routingEmbeddings } from "@/db/schema";
import { embed } from "@/lib/llm";
import { cosineSimilarity, vectorToBuffer, bufferToVector } from "@/lib/memory";
import { nextHlc } from "@/lib/hlc";

export interface RoutingCandidate {
  id: string;
  examples: readonly string[] | undefined;
}

// Fix D (docs/dev.md's "Chat reliability: the 2026-09-07 incident and the
// five fixes"): nomic-embed-text-v1.5's own model card documents an
// asymmetric "search_query: "/"search_document: " task-prefix convention
// - the model's own trained scheme, not a house style choice.
// `routing.examples` are always the DOCUMENT side (a package's own
// canonical phrasing, embedded once and stored); prefixing just that
// side is the one live-measured change here, against the real GGUF this
// hub actually spawns, not the model card's own claim about the
// original HF weights (`bun run scripts/bench/routing.ts`,
// docs/dev/session-c.md carries the recorded numbers). The utterance
// side (embedUtterance(), below) is deliberately left UNPREFIXED, and
// that is the measured answer, not a shortcut: this file's own vector is
// ALSO reused as recall()'s own query vector (turnEngine.ts's
// prepareTurn(), "embedded once here... reused below as recall()'s own
// queryVector" - a 2026-09-06 review's fix for a real duplicate-HTTP-
// round-trip cost), and memory.ts's own stored document vectors are not
// prefixed (a real household's already-written memories need an actual
// re-embedding migration to move safely, not a hash bump - see that
// file's own `embedQueryForRecall()` comment and docs/BACKLOG.md's
// follow-up item) - so a query-side prefix here would silently mismatch
// every memory recall's own document side. Measured head to head on the
// real corpus rather than assumed: document-only prefixing scored the
// SAME true-positive rate as no prefixing at all (68/71) while cutting
// the null-row noise floor's own top wrong-package score from p90 1.00
// to p90 0.86; prefixing BOTH sides, the model card's own default
// recipe, actually scored WORSE on this corpus (66/71) - a real,
// measured case where "do what the shared vector already constrains you
// to do" and "do what scores best" turned out to be the identical
// answer, not a compromise between two different ones.
const NOMIC_DOCUMENT_PREFIX = "search_document: ";

// Hashes the STRING ACTUALLY SENT to the embedder (prefixed), not the
// bare example - self-invalidating by construction: a stored row's hash
// stops matching the moment either the example's own words OR this
// file's own prefix scheme changes, so ensureRoutingEmbeddings() below
// re-embeds automatically either way, with no separate version counter
// to remember to bump.
function hashExample(example: string): string {
  return createHash("sha256").update(`${NOMIC_DOCUMENT_PREFIX}${example}`).digest("hex");
}

/** At first load of each package (turnEngine.ts's own `loadAllManifests()`
 * re-reads every manifest every turn, so "first load" in practice means
 * "the first turn after an example's hash isn't in the store yet"):
 * embeds every `routing.examples` entry not already stored under its
 * current hash, one batched `embed()` call for everything missing rather
 * than one call per example. Best-effort and silent on failure - the
 * embed backend being down here just means Tier 1 falls back to keyword
 * overlap for this turn (turnEngine.ts's own fallback), never a thrown
 * error partway through preparing a turn. */
export async function ensureRoutingEmbeddings(candidates: readonly RoutingCandidate[]): Promise<void> {
  const packageIds = candidates.map((c) => c.id);
  // One query for everything already stored across every candidate,
  // never one query per example (a code review, 2026-09-06, found the
  // first cut doing exactly that - a real per-turn cost that only grows
  // with the catalog, for a check that's almost always "yes, skip it").
  const existingHashes = new Set(
    packageIds.length === 0
      ? []
      : db
          .select({ packageId: routingEmbeddings.packageId, exampleHash: routingEmbeddings.exampleHash })
          .from(routingEmbeddings)
          .where(inArray(routingEmbeddings.packageId, packageIds))
          .all()
          .map((r) => `${r.packageId}:${r.exampleHash}`),
  );

  const pending: { packageId: string; example: string; hash: string }[] = [];
  for (const { id, examples } of candidates) {
    for (const example of examples ?? []) {
      const hash = hashExample(example);
      if (!existingHashes.has(`${id}:${hash}`)) pending.push({ packageId: id, example, hash });
    }
  }
  if (pending.length === 0) return;

  let result;
  try {
    result = await embed(pending.map((p) => `${NOMIC_DOCUMENT_PREFIX}${p.example}`));
  } catch (err) {
    console.error(`[routing] embed-on-load failed, Tier 1 falls back to keyword overlap this turn: ${(err as Error).message}`);
    return;
  }
  if (!result.ok) return;

  const now = nextHlc();
  for (let i = 0; i < pending.length; i++) {
    const { packageId, example, hash } = pending[i]!;
    const vector = result.value.vectors[i]!;
    const row = {
      packageId,
      exampleHash: hash,
      space: result.value.model,
      example,
      dims: vector.length,
      vector: vectorToBuffer(vector),
      hlc: now,
    };
    // A concurrent turn embedding the identical new example is possible
    // (two household members speaking at once, both missing the same
    // just-added example) - onConflictDoUpdate rather than a plain
    // insert, the same "last write wins, harmlessly" shape
    // memory.ts's storeEmbedding() already uses for the identical race.
    db.insert(routingEmbeddings)
      .values(row)
      .onConflictDoUpdate({ target: [routingEmbeddings.packageId, routingEmbeddings.exampleHash, routingEmbeddings.space], set: row })
      .run();
  }
}

// FAST-04: how many times embedUtterance() has run, so a test can prove
// a literal-pattern turn never embeds and an ordinary one embeds exactly
// once. The same test-only shape as `__resetLlmSupervisorForTests`.
let __embedCallCount = 0;

/** Embeds the utterance once per turn (never once per candidate). Never
 * throws: undefined means "fall back to keyword overlap for every
 * candidate this turn," the same contract memory.ts's
 * `embedQueryForRecall()` already established for the identical
 * down-backend case. */
export async function embedUtterance(text: string): Promise<Float32Array | undefined> {
  __embedCallCount++;
  try {
    const result = await embed([text]);
    if (!result.ok) return undefined;
    return new Float32Array(result.value.vectors[0]!);
  } catch {
    return undefined;
  }
}

export function __embedCallCountForTests(): number {
  return __embedCallCount;
}

export function __resetEmbedCallCountForTests(): void {
  __embedCallCount = 0;
}

/** Max cosine similarity between `utteranceVector` and each candidate's
 * OWN stored example embeddings - brute-force in JS, the same "household
 * scale, no ANN index needed yet" posture memory.ts's own vector store
 * comment already states. A candidate with no stored rows (embed backend
 * was down at ensureRoutingEmbeddings time, or it simply has no
 * examples) is absent from the returned map entirely, not scored 0 -
 * callers that need a fallback score for it use `exampleScore()`. */
export function scoreByEmbedding(utteranceVector: Float32Array, candidateIds: readonly string[]): Map<string, number> {
  if (candidateIds.length === 0) return new Map();
  const rows = db.select().from(routingEmbeddings).where(inArray(routingEmbeddings.packageId, [...candidateIds])).all();
  const scores = new Map<string, number>();
  for (const row of rows) {
    const cosine = cosineSimilarity(utteranceVector, bufferToVector(row.vector));
    const best = scores.get(row.packageId);
    if (best === undefined || cosine > best) scores.set(row.packageId, cosine);
  }
  return scores;
}

// Fix D (docs/dev.md's "Chat reliability: the 2026-09-07 incident and
// the five fixes"): measured against the real embed backend
// (`bun run scripts/bench/routing.ts`, numbers recorded in
// docs/dev/session-c.md), not the start values this step's own text
// asked for. 31 genuinely ordinary conversational negatives (the
// script's own `noiseFloorExempt` corpus field excludes the handful of
// rows deliberately DESIGNED to score high - a consequential package's
// own trigger phrase, and the "remember"/"recall" near-misses meant for
// Tier 2, never Tier 1 - a code review on this fix caught the first cut
// computing this distribution over ALL null rows, unfiltered, which
// would have set a threshold from noise dominated by rows that were
// never noise) scored p50=0.607 p90=0.659 p95=0.705 max=0.798 against
// SOME wrong package. The weakest genuine Tier 1 positive in the corpus
// ("tell me a bedtime story about a fox" -> storytime-style) scores
// 0.770 - the two distributions genuinely overlap at the edges (a real
// greeting can outscore a real match for a DIFFERENT utterance), so no single
// threshold cleanly separates every case; 0.75 sits just above the
// measured p95 while still clearing every real positive in the corpus.
// One real, confirmed false WIN this measurement caught and fixed here:
// "I can't decide what to wear today" scored 0.74 against `list-view`
// (margin 0.08 over the runner-up, right at the old bar) and won Tier 1
// outright at the OLD 0.62 threshold - a genuine, deterministic misroute
// with no model in the loop to catch it. Gone at 0.75.
//
// A second thing this measurement found is NOT the same class of bug,
// worth naming so it isn't rediscovered as one: "good morning" scores
// 0.80 against `translate` (one of its OWN routing.examples used to be
// "translate good morning into french" - replaced in translate/
// manifest.json with a non-greeting example anyway, real hygiene, just
// not a fix for a live misroute) but can never actually WIN Tier 1
// regardless of score - `translate` requires one arg (`expression`) and
// `deterministicArgs()` only ever binds that from a literal pattern's
// own wildcard capture, never a fuzzy Tier 1 score, so `canFire()`
// rejects it unconditionally for every fuzzy match. It only ever reaches
// Tier 2 as an OFFERED candidate (turnEngine.ts's selectOfferedTools(),
// the top three by score, ROUTE-01 removed the floor), where a real
// model - not a deterministic threshold - decides whether to call it.
export const TIER1_THRESHOLD = 0.75;
export const TIER1_MARGIN = 0.08;

// ROUTE-01 (docs/dev/session-a.md, getmaipai/home#80): the bot's shape
// guard, ported from its router.py (tier 3 of that cascade, between the
// example tier and the model tier). A sentence shaped like a QUESTION or
// a first-person STATEMENT that no deterministic tier placed belongs to
// conversation: the model tier rescues commands the example lines
// missed ("dim the lights"), it does not get to guess which package a
// question resembles (measured on the bot's bench, 2026-09-02: a 0.6B
// offered every skill id answered "who wrote the book IT" with silence
// and "what do you mean" with a check-in skill's "by what time?"). A
// polite request ("could you remember that pippa's recital is friday?")
// is a command by intent and a question by punctuation, and it is
// exactly how a household talks to the hub, so the courtesy prefix is
// stripped first and the shape is read off the verb that follows it,
// never off the question mark (the coordinator's condition on this
// item). The three expressions are the bot's, plus "please" as a
// courtesy prefix of its own.
const COURTESY_PREFIX = /^\s*(?:hey\s+\w+[,\s]+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please[,\s]+)/i;
const QUESTION_OPENER =
  /^\s*(?:who|whose|what|whats|when|where|which|why|how|is|are|was|were|am|do|does|did|can|could|should|would|will|shall|have|has|had|any|anything|anyone)\b/i;
const TRAILING_QUESTION_MARK = /\?\s*$/;
const FIRST_PERSON_OPENER = /^\s*(?:i|i'm|i've|i'd|i'll|we|we're|we've|we'd)\b/i;

export type UtteranceShape = "question" | "first_person" | "command";

// A compound sentence is its clauses: "what does ephemeral mean and
// remember that my dentist appointment is next week" carries a command
// in its second clause, and the household talks that way (the
// coordinator's ruling on ROUTE-01, after the tool-calling bench's
// routed pass lost that exact row to a guard that read only the
// opener). Split on " and " and on a comma; a clause under two words
// ("right?") is a tag, not a clause; a vocative in front ("hey maipai,",
// "Sage,") is dropped first. A clause counts as a command only on a
// real imperative signal: a courtesy prefix, or an opening word that
// opens one of the installed packages' own literal patterns ("remember
// that *", "turn off the * light", "set a timer for *"), which is the
// packages' own declaration of their command verbs rather than a
// hand-kept list (a code review on the first cut defaulted every
// opener-less fragment to command, so "what's the difference between a
// crocodile and an alligator" was a command by its noun phrase). A
// clause with no signal at all decides nothing; a turn made only of
// those ("good morning", "keep that on file") is a command, today's
// default, ROUTE-02's question.
// Two vocative forms: "hey maipai" with or without a comma (speech
// transcripts carry none), and a bare "Sage," with one. The word
// itself is never stripped when it is a courtesy word or a command
// opener ("Remember, I have a dentist appointment", "Please, set a
// timer"): that word is the signal, not a name (a code review).
const VOCATIVE_PREFIX = /^\s*(?:(?:hey|hi|hello|ok|okay)\s+([a-z]+)[,\s]+|([a-z]+),\s*)/i;
const COURTESY_WORDS = /^(?:please|can|could|would|will)$/i;
const LEADING_PLEASE = /^\s*please[,\s]+/i;
const CLAUSE_BREAK = /\s*,\s*(?:and\s+)?|\s+and\s+/i;
const MIN_CLAUSE_WORDS = 2;
const NEVER_AN_OPENER = /^(?:this|that|the|a|an|my|our|your|it|its|\*)$/i;

/** The command verbs the installed packages declared: the first word of
 * every literal `routing.patterns` entry that is not a question opener,
 * a determiner or a wildcard. */
export function commandOpenersFrom(patterns: Iterable<string>): ReadonlySet<string> {
  const openers = new Set<string>();
  for (const pattern of patterns) {
    const first = pattern.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, "");
    if (!first || NEVER_AN_OPENER.test(first) || QUESTION_OPENER.test(first) || FIRST_PERSON_OPENER.test(first)) continue;
    openers.add(first);
  }
  return openers;
}
const NO_OPENERS: ReadonlySet<string> = new Set();

type ClauseSignal = UtteranceShape | "none";

function clauseSignal(clause: string, commandOpeners: ReadonlySet<string>): { signal: ClauseSignal; polite: boolean } {
  const bare = clause.replace(COURTESY_PREFIX, "");
  const polite = bare !== clause;
  if (QUESTION_OPENER.test(bare)) return { signal: "question", polite };
  if (polite) return { signal: "command", polite };
  if (FIRST_PERSON_OPENER.test(bare)) return { signal: "first_person", polite };
  const first = bare.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, "") ?? "";
  if (commandOpeners.has(first)) return { signal: "command", polite };
  return { signal: "none", polite };
}

/** The shape the guard reads, named for the `[route]` trace line. Per
 * clause: after a courtesy prefix only the opener counts (a polite
 * request keeps its question mark and is still a command). A trailing
 * question mark makes the turn a question unless a clause was a polite
 * request. Any command clause makes the turn a command; otherwise any
 * question clause a question; otherwise any first-person clause first
 * person; a turn with no signal at all is a command. */
export function utteranceShape(text: string, commandOpeners: ReadonlySet<string> = NO_OPENERS): UtteranceShape {
  const unaddressed = text.replace(VOCATIVE_PREFIX, (whole, afterHey: string | undefined, bare: string | undefined) => {
    const word = (afterHey ?? bare ?? "").toLowerCase();
    return COURTESY_WORDS.test(word) || commandOpeners.has(word) ? whole : "";
  });
  // A leading "please," is a courtesy on the whole turn: a command
  // unless what follows opens as a question ("please, what time is it").
  const body = unaddressed.replace(LEADING_PLEASE, "");
  const leadingPlease = body !== unaddressed;
  const clauses = body.split(CLAUSE_BREAK).filter((c) => {
    const words = c.trim().split(/\s+/);
    if (words.length >= MIN_CLAUSE_WORDS) return true;
    const word = (words[0] ?? "").toLowerCase().replace(/[^a-z']/g, "");
    return COURTESY_WORDS.test(word) || commandOpeners.has(word); // "Remember, ..." is a one-word command clause
  });
  const read = (clauses.length > 0 ? clauses : [body]).map((c) => clauseSignal(c, commandOpeners));
  const signals = new Set(read.map((r) => r.signal));
  if (TRAILING_QUESTION_MARK.test(body) && !read.some((r) => r.polite) && !leadingPlease) signals.add("question");
  if (leadingPlease && read[0]?.signal !== "question") signals.add("command");
  if (signals.has("command")) return "command";
  if (signals.has("question")) return "question";
  if (signals.has("first_person")) return "first_person";
  return "command";
}

/** True when the utterance is a question or a first-person statement:
 * the shapes that fall to the conversational path (with the always-offer
 * set alone) rather than to a model's guess at a package. */
export function conversationShaped(text: string, commandOpeners?: ReadonlySet<string>): boolean {
  return utteranceShape(text, commandOpeners) !== "command";
}

export interface Tier1Score {
  id: string;
  score: number;
}

/** The real Tier 1 firing rule: not "does this ONE candidate clear a bar"
 * (the old per-package `EXAMPLE_MATCH_THRESHOLD` check this replaces) but
 * "does the best candidate clear the bar AND clearly beat whatever else
 * was in contention" - the margin exists specifically for the live-found
 * bug this step's own goal names ("'bedtime story' reaches the storytime
 * skill, not the joke plugin"): two candidates landing close together
 * from shared filler words is exactly what a bare per-candidate threshold
 * cannot tell apart, and a real margin against the runner-up can. A
 * single candidate with nothing to beat still needs to clear the
 * threshold on its own. */
export function pickTier1Winner(scored: readonly Tier1Score[]): Tier1Score | null {
  if (scored.length === 0) return null;
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const top = sorted[0]!;
  if (top.score < TIER1_THRESHOLD) return null;
  const runnerUp = sorted[1];
  if (runnerUp && top.score - runnerUp.score < TIER1_MARGIN) return null;
  return top;
}

/** pickTier1Winner(), retried against whatever's left when the winner
 * turns out unable to actually fire (turnEngine.ts's `deterministicArgs`:
 * a required arg with no wildcard capture to bind, the one real way a
 * Tier 1 winner can still be a non-starter) - the same "skip it, keep
 * looking" behavior the pre-embedding per-candidate loop had. A code
 * review (2026-09-06) found the first cut of route() returning null for
 * the WHOLE turn the instant the top scorer couldn't bind its arg,
 * silently dropping a perfectly good arg-free runner-up (joke, trivia, a
 * skill) that had also cleared the bar. Each retry re-runs the margin
 * check against the shrunk field, so a genuinely ambiguous runner-up
 * still doesn't fire just because the top pick got disqualified. */
export function pickTier1WinnerAmong(scored: readonly Tier1Score[], canFire: (id: string) => boolean): Tier1Score | null {
  let remaining = scored;
  for (;;) {
    const winner = pickTier1Winner(remaining);
    if (!winner) return null;
    if (canFire(winner.id)) return winner;
    remaining = remaining.filter((s) => s.id !== winner.id);
  }
}
