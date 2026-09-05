// Phrase rotation for the household's fixed, constant replies (2026-09-05,
// Jesse: "it can't just be repeating one response after another - it has
// to [not] repeat exact phrasing in a conversation" and "we probably have
// multiple hard coded things... phrases from skills"). A person who asks
// the same blocked thing three times, or says "remember that..." five
// times a day, hears MaiPai's own real constant replies today: the exact
// same sentence, verbatim, forever. That is the same "canned response"
// tell home-legacy.git's docs/internal/voice-naturalness.md names ("the
// same acknowledgment every turn... uniform turn length" as a known
// robotic failure mode) - and the fix has to be instant and exact to the
// message being conveyed (no model call, no risk of drifting the
// meaning): a small, hand-written pool of EQUIVALENT phrasings per
// constant, walked in sequence so the same person never hears the same
// one twice in a row.
//
// Deliberately NOT a general "vary any reply" transform: it only ever
// touches a reply that is ALREADY one of these known, fixed constants
// (the safety refusal, a skill error, a skill's own default confirmation,
// or one of the two known constant confirmations the recall/remember
// packages produce today - backend/packages/remember/recipe.json and
// spec/interpreters/{ts,py}/recipe-interpreter.ts's own NOTHING_RECALLED).
// A model's own freeform reply, or a skill's real dynamic content (a
// recalled fact, a weather number), is never touched - there is nothing
// fixed there to rotate, and guessing would risk changing what was
// actually said.

// Per (person, pool key), the next index to hand out. In-memory only,
// same tolerance as home-legacy.git's own cue rotation (`_cueCounters`):
// worst case after a size-cap clear is one same-phrase coincidence, never
// a correctness problem.
const _counters = new Map<string, number>();

function hashStart(seed: string, length: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % length;
}

/** Walks `variants` in order for this (personId, poolKey), starting from a
 * hash of personId so different households don't all hear variant 0
 * first, and never repeating the immediately previous pick as long as
 * `variants.length >= 2` (each call advances the index by exactly one). */
export function pickVariant(personId: string, poolKey: string, variants: readonly string[]): string {
  if (variants.length === 0) throw new Error(`pickVariant: empty pool for "${poolKey}"`);
  if (_counters.size > 2000) _counters.clear();
  const key = `${personId}:${poolKey}`;
  let n = _counters.get(key);
  if (n === undefined) n = hashStart(personId, variants.length);
  _counters.set(key, n + 1);
  return variants[n % variants.length]!;
}

/** True the first time this (personId, poolKey) is asked for - before
 * pickVariant() would give it a real answer. Refusals are the one case
 * that genuinely needs to know "have I already said this to them" rather
 * than just rotating blindly: a first-ever refusal saying "still can't
 * help with that" would be a real, jarring lie about there having been a
 * prior refusal at all. */
function isFirstOccurrence(personId: string, poolKey: string): boolean {
  return !_counters.has(`${personId}:${poolKey}`);
}

// ── Safety refusals ────────────────────────────────────────────────────
// Every variant here means EXACTLY the same thing (a flat, unambiguous
// no) - none softens it into something that could read as negotiable.
// The REPEAT pool additionally marks that this isn't the first time,
// which only ever applies from the second refusal onward.
export const REFUSAL_FIRST: readonly string[] = [
  "I can't help with that.",
  "That's not something I can do.",
  "I'm not able to help with that.",
];
export const REFUSAL_REPEAT: readonly string[] = [
  "Still can't help with that.",
  "Same answer - I can't do that.",
  "As I said, I can't help with that.",
  "That's still a no from me.",
];
const REFUSAL_POOL_KEY = "safety_refuse";

/** The safety refusal, varied and marked as a repeat once it genuinely is
 * one. `evaluateSafety()` re-runs on every turn (nothing here weakens or
 * skips that check); this only changes the WORDS around the identical
 * refuse decision. */
export function pickRefusalVariant(personId: string): string {
  const first = isFirstOccurrence(personId, REFUSAL_POOL_KEY);
  return pickVariant(personId, REFUSAL_POOL_KEY, first ? REFUSAL_FIRST : REFUSAL_REPEAT);
}

// ── Other known constants ──────────────────────────────────────────────
export const SKILL_ERROR_VARIANTS: readonly string[] = [
  "Sorry, I couldn't do that.",
  "That didn't work - sorry.",
  "Couldn't get that done, sorry.",
];
export const SKILL_DONE_VARIANTS: readonly string[] = ["Done.", "Done!", "Got it, done.", "All set."];
export const RECALL_NOTHING_VARIANTS: readonly string[] = [
  "I don't remember anything about that.",
  "Nothing on that from me.",
  "I've got nothing saved about that.",
  "Don't have anything on that.",
];
export const REMEMBER_CONFIRM_VARIANTS: readonly string[] = [
  "Got it, I'll remember that.",
  "Okay, noted.",
  "Got it.",
  "Noted - I'll remember that.",
];

// ── The spoken "thinking" cue ────────────────────────────────────────────
// Deliberately content-free continuers (routes/turn.ts's own
// "spoken_cue" event), the same shape as home-legacy.git's
// TOOL_ACK_CUES/REPLAN_CUES: what a person actually says while a reply is
// taking a genuinely noticeable moment, never a task announcement
// ("Checking that...") and never a filler word inserted into the answer
// itself (docs/internal/voice-naturalness.md: prompted mid-utterance
// fillers measurably lower perceived confidence - Kirkland et al. 2022).
export const THINKING_CUE_VARIANTS: readonly string[] = [
  "One sec.",
  "Hmm, let me think.",
  "Give me a second.",
  "Let me see.",
];

/** A rotated thinking cue for this person - reuses `pickVariant` under
 * its own dedicated key so it never shares state with any reply-text
 * rotation above. */
export function pickThinkingCue(personId: string): string {
  return pickVariant(personId, "thinking_cue", THINKING_CUE_VARIANTS);
}

// Maps a still-exact match of one of the OTHER known constant reply
// strings - turnEngine.ts's own skill-error/skill-done fallbacks, plus
// the package layer's known constant confirmations - to its pool. Keyed
// on each constant's CURRENT exact text (not a source or skill id) since,
// for example, spec/interpreters produces NOTHING_RECALLED for any recipe
// that uses a `recall` step, not just the bundled `recall` package. If
// any of these source strings ever changes, this map's key must change
// with it - there is no way to enforce that at the type level across a
// turnEngine.ts literal, a spec/ string constant, and a package's own
// recipe.json, so it's called out here instead. The safety refusal is
// the one constant NOT in this map: it alone needs pickRefusalVariant's
// first/repeat distinction, not plain rotation.
const KNOWN_CONSTANT_POOLS: ReadonlyMap<string, readonly string[]> = new Map([
  ["Sorry, I couldn't do that.", SKILL_ERROR_VARIANTS], // turnEngine.ts's own skill_error fallback
  ["Done.", SKILL_DONE_VARIANTS], // turnEngine.ts's own no-reply skill fallback
  ["I don't remember anything about that.", RECALL_NOTHING_VARIANTS], // spec/interpreters/{ts,py}/recipe-interpreter's NOTHING_RECALLED
  ["Got it, I'll remember that.", REMEMBER_CONFIRM_VARIANTS], // backend/packages/remember/recipe.json's own reply text
]);

/** Applied to a skill's already-rendered reply text: if it's exactly one
 * of the package layer's known constant confirmations, rotate it; any
 * real, dynamic content (a recalled fact, a weather number, a recipe's
 * own bespoke confirmation sentence) passes through completely
 * unchanged, because it isn't in the map at all. */
export function varyKnownConstant(personId: string, text: string): string {
  const pool = KNOWN_CONSTANT_POOLS.get(text);
  if (!pool) return text;
  // The map's key IS the pool's own first/canonical entry, so it doubles
  // as this constant's own dedicated rotation key.
  return pickVariant(personId, text, pool);
}
