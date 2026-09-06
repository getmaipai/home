// What the model may not say, checked here AFTER it says it (session-c-
// brain-and-voice.md step 3). Ported from bot-legacy's own
// `robot/robot/cognition/dialogue/guards.py` and
// `robot/robot/cognition/skills/social.py` - both real, hand-tuned
// against live conversation failures on-device (the file comments name
// the exact bench and date each rule came from); this file keeps that
// same "one guard per real failure shape" discipline rather than a
// generic content filter. The legacy file has more guard shapes than
// this step's own seven (unknown_person, invented_location,
// unknown_relation, unknown_event, confessed_action, claimed_experience,
// context_echo...); only the seven this session's plan names are ported
// here. The rest is a rich reference for a later pass, not silently
// dropped - see docs/dev/session-c.md.
//
// Guards run on the FULL reply (guardReply) and, for the ones that can
// apply to a single sentence in isolation, on the stream one sentence at
// a time BEFORE hand-off to the speaker (guardSentence) - the same "a
// sentence is out of the speaker the moment it is handed over" reasoning
// bot-legacy's own docstring gives. Guards NEVER run on a safety refusal,
// a command, or a plugin's own reply (turnEngine.ts only ever calls
// these on `source: "model"` text) - a package's own `speech` string is
// never rewritten by anything here, only the model's own words are ever
// second-guessed.
import { tokenize } from "@/lib/text";
import { pickVariant } from "@/lib/replyVariation";

export type GuardReason =
  | "invention"
  | "unrelated_recall"
  | "near_echo"
  | "medication_dose"
  | "capability_claim"
  | "like_i_said"
  | "example_parrot";

export interface GuardContext {
  utterance: string;
  /** The conversation's own prior turns this session (user text only,
   * oldest first) - "like I said" is only ever true against these, never
   * a DIFFERENT conversation (session-c-brain-and-voice.md's own "never
   * across conversations": a fresh conversation's `history` is empty, so
   * nothing here can ever ground the phrase). */
  history?: readonly string[];
  /** Real, on-hand facts the reply may draw from: tool results, recalled
   * memory lines, the conversation window's own content - never the
   * model's own persona/rules prompt text (that's what the attractor and
   * recitation guards exist to catch it borrowing from instead). */
  sources?: readonly string[];
  /** True only when a real package actually ran this turn - the one
   * thing that can make "I've added that" true rather than a claim
   * ahead of the fact. */
  actionsRan?: boolean;
  /** The active persona's own few-shot voice lines (persona.ts's
   * `Persona.examples`) - borrowed for TONE, never handed back verbatim. */
  personaExamples?: readonly string[];
  /** Rotates the honest replacement line so the same household doesn't
   * hear the identical guard line every time (replyVariation.ts's own
   * `pickVariant`, reused rather than a second rotation mechanism). */
  personId: string;
  /** Whether a "?" appears ANYWHERE in the full reply, not just the
   * sentence guardCapabilityClaim happens to be checking right now - a
   * code review (2026-09-06) found "Sure! What do you have in the
   * fridge?" flagged outright: sentence 1 ("Sure!") has no "?" of its
   * own, so the per-sentence check alone couldn't see the honest
   * clarifying question sentence 2 actually asks. `guardReply()` sets
   * this once from the whole text before splitting it; the streaming
   * path (gateGuards()) can't know a later sentence before it arrives,
   * so this stays unset there - a real, honest limitation of streaming
   * one sentence at a time, not something a lookahead could fix without
   * delaying speech. */
  replyHasQuestion?: boolean;
}

export interface Guarded {
  reply: string;
  reason: GuardReason | null;
}

// ==== Honest replacement lines, one small rotating bank per reason ====
// Says what's true (didn't do it, wasn't told it, isn't safe to guess)
// rather than asking the person to repeat themselves - bot-legacy's own
// guards.py docstring: "the person was clear; the model was not."

const CANNOT_DO = [
  "I can't actually do that from a chat like this.",
  "I'm not able to do that yet, sorry.",
  "That's not something I can do right now.",
];
const NOT_TOLD = [
  "I don't actually have that - nobody's told me.",
  "I don't know that one, sorry.",
  "That's not something I've been told.",
];
const DONT_KNOW = [
  "I don't know, sorry.",
  "I'm not sure about that.",
  "I don't have an answer for that.",
];
const CHAT_LOOP = [
  "I keep landing on the same answer - ask me that another way?",
  "Hmm, I'm going in circles. Try me a different way?",
  "I'm stuck on that one, sorry. Ask me again some other way?",
];
const MED_CAUTION = [
  "I'm not able to give medication amounts - check with a pharmacist or the label.",
  "I can't advise on doses - a pharmacist or doctor is the safe call there.",
];

function honest(personId: string, reason: GuardReason, pool: readonly string[]): string {
  return pickVariant(personId, `guard:${reason}`, pool);
}

// ==== Invention: a proper noun, number or date not grounded anywhere ====
// bot-legacy's guards.py: "unsupported_claim"/"invented_location" -
// several narrow sub-shapes there (a third party's traits, a place for a
// person, a guess hedged politely); this is the plan's own single,
// general rule - a candidate fact-word that appears nowhere in the
// utterance, the sources, or the conversation's own history is invented.

const DECLINE_RE =
  /\b(?:i (?:don't|do not|didn't|did not|can't|cannot|haven't|have not|never|wasn't|was not) (?:know|remember|recall|have|hear|heard|see|saw|think|catch))\b|\bnot sure\b|\bno idea\b/i;

// Capitalised mid-sentence (never the sentence's own first word, which is
// capitalised by grammar alone, not because it names something): the
// same safe direction bot-legacy's own `_NAME_IN_QUESTION` comment
// argues for.
const PROPER_NOUN_RE = /(?<!^)(?<=[a-z]\s|[a-z][.!?]\s)\b([A-Z][a-z]{2,})\b/g;
const NOT_NAMES = new Set(
  "I You We He She They The A An Is Are Was Were Do Does Did Can Could Would Will What When Where Who Why How Which Sunday Monday Tuesday Wednesday Thursday Friday Saturday January February March April May June July August September October November December MaiPai OK Okay"
    .split(" ")
    .map((w) => w.toLowerCase()),
);
const BARE_NUMBER_RE = /\b\d{1,4}\b/g;
const DATE_WORD_RE =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;

// A code review (2026-09-06) found this returning a plain joined STRING,
// checked with `.includes()` - a real word-boundary bug, not just an
// edge case: "carbarn" grounds "barn" as a substring match, silently
// defeating invention detection for any invented word that happens to
// be a substring of an unrelated grounded one. A tokenized WORD SET
// (reused `tokenize()`, same stopword-dropping every other guard already
// uses) checked with `.has()` is real word-boundary matching, not a
// substring scan.
function groundedWords(ctx: GuardContext): Set<string> {
  return tokenize([ctx.utterance, ...(ctx.sources ?? []), ...(ctx.history ?? [])].join(" "));
}

// Three narrow, specific invention SHAPES beyond a bare proper noun/
// number/date - each ported directly from a guards.py regex of the same
// name, kept narrow on purpose (a real pattern, not "any ungrounded
// word") so this stays a precise catch rather than a blunt content
// filter that would flag ordinary, harmless conversational words too.
// Found live via this step's own conversation bench
// (backend/scripts/bench/conversation.ts): a bare proper-noun/number/
// date check alone missed most of the 34 real scenarios, which invent
// lowercase nouns ("gallery", "sedan", "kitchen") a name/number check
// can't see at all.

// "I think you're talking about a sedan, right?" - a guess about the
// household's own business is an invention however politely it is
// hedged; the PATTERN itself is the tell, no grounding check needed.
const GUESSING_RE =
  /\bi think you(?:'re| are)? (?:talking about|referring to|means?)\b|\byou must mean\b|\bi(?:'m| am) guessing\b|\bprobably (?:a|an|the)\b|\bsounds like (?:a|an)\b|\bmy guess is\b/i;

// "he drives a black BMW i3", "she lives in the kitchen": a third-party
// pronoun given a concrete trait or place. Narrow on purpose (a pronoun
// PLUS one of these specific verbs) - word grounding alone can't tell
// whose blue car it is, so the shape itself is what's checked.
const PERSON_TRAIT_RE = /\b(?:he|she|they)(?:'s| is| are)?\s+(?:drives?|owns?|has|had|lives?|works?|wears?|stays?|sits?|sleeps?)\b|\bgood (?:boy|girl|guy|kid|one)\b/i;

// "I'm watching too", "I've even seen one of their videos" - a first-
// person SENSORY EXPERIENCE this hub cannot have (no eyes, no ears
// beyond a mic for the wake word, no hands). Negation and hearsay stand
// ("I've never seen it", "I hear it's good" - listening is something a
// voice assistant genuinely does); only a flat first-person claim of
// having done/seen/eaten/watched something is the invention.
const CLAIMED_EXPERIENCE_RE =
  /\bi(?:'m| am| was|'ve| have|'d| had)?(?: just| also| even| already| actually)? (?:watch(?:ing|ed)|see(?:ing|n)|saw|play(?:ing|ed)|read(?:ing)?|binge\w*|eat(?:ing)?|ate|drink(?:ing)?|drank|cook(?:ing|ed)|went|visit(?:ing|ed)|been to|waiting for|sleep(?:ing)?|slept|dream(?:ing|ed|t)|tried|tasted|bought|drove|driving)\b/i;

// "Rover lives in the kitchen.", "He's in the kitchen." - a location for
// a person, the one shape guards.py's own comment calls out by name
// ("the robot has exactly one source for it: somebody told it - its OWN
// situation is not that source").
const LOCATION_CLAIM_RE = /\b(?:he|she|they|[A-Z][a-z]{2,})(?:'s|\s+(?:is|was|lives?|lived|stays?|staying|works?|sits?|sleeps?))\s+(?:currently\s+|probably\s+|still\s+)?(?:in|at|on|near|by|inside)\s+(?:the|a|an|his|her|their)\s+([a-z][\w'-]{2,20})\b/i;

// "Nadia said she'd like pasta tonight." - speech attributed to a named
// person, where the CONTENT of the quote isn't anything the sources
// actually hold. A real quote the robot holds ("Bramble said he wants
// pizza") is grounded and stands; an invented one is not.
const ATTRIBUTED_QUOTE_RE = /\b(?:[A-Z][a-z]{2,}|your (?:brother|sister|mother|mom|father|dad))\s+(?:said|says|told|mentioned)\b/i;

// Words a sentence may use about anybody without having been grounded in
// them - the machinery of a sentence, pronouns, and the honest moves
// (memory.ts's own precedent list, extended with pronouns/time words a
// code review, 2026-09-06, found missing: "He lives in Florida now."
// against a source that already grounds "Rover lives in Florida" was
// flagged as invention purely because of "he" and "now", neither of
// which claims anything on its own). Checking every raw tokenized word
// for grounding, with no allowlist at all, is a blunt content filter
// that would eventually flag ordinary harmless words too - this is
// what keeps the claim-word checks precise instead.
const CLAIM_SAFE_WORDS = new Set(
  "he she they him her his hers their theirs now today tonight still just really very so well there here yes yeah okay sure nice good great lovely sorry thanks thank tell told say said know knew remember heard hear ask asked more want like course maybe brother sister mum mom dad father mother wife husband partner son daughter kid kids child children friend family dog cat pet person people"
    .split(" "),
);

/** The sentence's own content words that neither `grounded` nor
 * `CLAIM_SAFE_WORDS` accounts for - what a claim-shaped guard (a
 * third-party trait, an attributed quote) actually checks for
 * groundedness, never the sentence's raw word list unfiltered. */
function unclaimedWords(sentence: string, grounded: Set<string>): string[] {
  return [...tokenize(sentence)].filter((w) => !grounded.has(w) && !CLAIM_SAFE_WORDS.has(w));
}

function guardInvention(sentence: string, ctx: GuardContext): GuardReason | null {
  const grounded = groundedWords(ctx);
  const declines = DECLINE_RE.test(sentence);

  // Fired EVEN BEHIND a decline (guards.py's own comment on why, verbatim
  // in spirit): "I don't know his name, but I know he's a good boy" - the
  // decline about the NAME doesn't excuse inventing the TRAIT in the same
  // breath. A clearest-shape invention (a concrete third-party trait) is
  // never waved through just because the sentence also, honestly,
  // admitted not knowing something else.
  if (PERSON_TRAIT_RE.test(sentence) && unclaimedWords(sentence, grounded).length > 0) return "invention";

  if (declines) return null; // an honest "I don't know" is never itself an invention, for everything else below

  if (GUESSING_RE.test(sentence)) return "invention";
  if (CLAIMED_EXPERIENCE_RE.test(sentence)) return "invention";

  const locationMatch = sentence.match(LOCATION_CLAIM_RE);
  if (locationMatch && !grounded.has(locationMatch[1]!.toLowerCase())) return "invention";

  if (ATTRIBUTED_QUOTE_RE.test(sentence)) {
    // The name/relation word and the speech verb itself are never the
    // invented part - only what comes AFTER "said" is the quote's own
    // content, so a plain re-check of every content word (minus a small
    // set of the sentence's own scaffolding, on top of the shared safe
    // words) is what actually tells a real quote from a fabricated one.
    const scaffold = new Set(["said", "says", "told", "mentioned", "your", "brother", "sister", "mother", "mom", "father", "dad"]);
    if (unclaimedWords(sentence, grounded).some((w) => !scaffold.has(w))) return "invention";
  }

  const candidates = new Set<string>();
  for (const m of sentence.matchAll(PROPER_NOUN_RE)) if (!NOT_NAMES.has(m[1]!.toLowerCase())) candidates.add(m[1]!);
  for (const m of sentence.matchAll(DATE_WORD_RE)) candidates.add(m[0]!);
  for (const m of sentence.matchAll(BARE_NUMBER_RE)) candidates.add(m[0]!);
  for (const c of candidates) {
    if (!grounded.has(c.toLowerCase())) return "invention";
  }
  return null;
}

// ==== Unrelated recall: a real source line, said back to the WRONG question ====
// Ported closely from guards.py's `_is_unrelated_source_line`: "when is my
// flight" answered "The dentist is on Thursday at four" - a real memory
// line, just not one that answers what was asked. Recognised by the
// sentence's content words being (nearly) all inside ONE source line,
// while the sentence shares NO content word with the question itself.

function guardUnrelatedRecall(sentence: string, ctx: GuardContext): GuardReason | null {
  const said = tokenize(sentence);
  if (said.size < 2) return null;
  const asked = tokenize(ctx.utterance);
  for (const line of ctx.sources ?? []) {
    const have = tokenize(line);
    if (have.size === 0) continue;
    const overlap = [...said].filter((w) => have.has(w)).length;
    if (overlap < Math.max(2, Math.floor(0.8 * said.size))) continue;
    const sharesWithQuestion = [...asked].some((w) => have.has(w));
    return sharesWithQuestion ? null : "unrelated_recall";
  }
  return null;
}

// ==== Near-echo: the reply only restates the person's own words ====
// Ported from social.py's `_is_near_echo`: strip a leading acknowledgment
// ("Okay, ..."), then ask whether every remaining word already appeared
// in the utterance (a shared 4+ letter stem counts, so "playing" answers
// "play"). Restating is never an answer.

const ACK_LEAD_RE = /^(?:okay|ok|alright|right|sure|yeah|yes|oh|ah|so|got it|nice|cool|mm-?hmm|mm)\b[\s,.!-]*/i;

function wordMatches(word: string, pool: readonly string[]): boolean {
  for (const other of pool) {
    if (word === other) return true;
    const [short, long] = word.length <= other.length ? [word, other] : [other, word];
    if (short.length >= 4 && long.startsWith(short)) return true;
  }
  return false;
}

function guardNearEcho(sentence: string, ctx: GuardContext): GuardReason | null {
  const stripped = sentence.replace(ACK_LEAD_RE, "");
  const words = [...tokenize(stripped)];
  const pool = [...tokenize(ctx.utterance)];
  if (words.length < 2 || pool.length === 0) return null;
  return words.every((w) => wordMatches(w, pool)) ? "near_echo" : null;
}

// ==== Medication doses: never a bare number ====
// Not in bot-legacy's guards.py (its medication rule is an INPUT-side
// safety escalation, lib/safety.ts's own territory here - see
// docs/dev/session-c.md); this is the plan's own separate OUTPUT rule:
// whatever the model was about to say about a dose, it never states one
// as a number. Deliberately narrow and unconditional - there is no
// "safe" numeric dose to let through, so this never checks grounding the
// way invention does.

const MEDICATION_DOSE_RE =
  /\d+(?:\.\d+)?\s?(?:mg|ml|milligrams?|milliliters?)\b|\b(?:dose|doses|dosage|pill|pills|tablet|tablets|medication|medicine|meds)\b.{0,25}\b\d+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b.{0,25}\b(?:dose|doses|dosage|pill|pills|tablet|tablets)\b/i;

function guardMedicationDose(sentence: string): GuardReason | null {
  return MEDICATION_DOSE_RE.test(sentence) ? "medication_dose" : null;
}

// ==== Capability claims: no "I've added that" unless a package ran ====
// Ported from guards.py's `_REQUEST`/`_CLAIMED`/`_ACCEPTS`: a chat turn
// that ran no action cannot have "already" done, or even accepted, a
// request - "I'll text Nadia now" is the claim before the fact, exactly
// as false as "done."

const REQUEST_RE =
  /^\s*(?:please\s+)?(?:can|could|would|will) you\b|^\s*(?:please\s+)?(?:text|send|order|book|email|add|set|call|print|buy|schedule|message|put|turn|play|lock|unlock|open|close|start|stop)\b/i;
const CLAIMED_RE =
  /\bi(?:'ve| have)? (?:just )?(?:sent|added|ordered|booked|set|texted|emailed|called|printed|scheduled|messaged|bought|turned|locked|unlocked|opened|closed|started|stopped|put)\b|\b(?:done|all set|sent it|it's on the|consider it done|on it)\b|\bi(?:'ll| will) (?:send|add|order|book|text|email|call|print|schedule|message|buy)\b/i;
const ACCEPTS_RE =
  /^\s*(?:sure|okay|ok|on it|will do|of course|absolutely|no problem|got it|alright|right away|consider it done|sure thing|you got it)\b|\bi(?:'ll| will) (?:get|set|do|take|handle|make|have|let|pass|send|text|call|email|order|book|print|add|buy|schedule|message|turn|play|put|open|close|lock|unlock|start|stop)\b/i;

function guardCapabilityClaim(sentence: string, ctx: GuardContext): GuardReason | null {
  if (ctx.actionsRan || !REQUEST_RE.test(ctx.utterance) || sentence.includes("?") || ctx.replyHasQuestion) return null;
  if (CLAIMED_RE.test(sentence) || ACCEPTS_RE.test(sentence)) return "capability_claim";
  return null;
}

// ==== "Like I said": never across conversations ====
// bot-legacy's actual mechanism (dialogue/manager.py) is structural (the
// same reply text twice in a row, in the SAME conversation, becomes a
// "chat_loop" line instead) rather than a literal phrase match. This
// step's own text asks for "never across conversations" specifically -
// the literal phrase is the tell (bench, 2026-09-02: a FRESH
// conversation opened with "Like I said, I don't know" - nothing said
// could possibly have grounded it), so it's checked directly: the phrase
// is fine ONLY when this conversation's own history actually contains
// what's being referred back to.

const LIKE_I_SAID_RE = /\b(?:like|as) i (?:said|mentioned|told you)\b/i;

function guardLikeISaid(sentence: string, ctx: GuardContext): GuardReason | null {
  if (!LIKE_I_SAID_RE.test(sentence)) return null;
  if (!ctx.history || ctx.history.length === 0) return "like_i_said"; // nothing to refer back to at all
  const claim = new Set([...tokenize(sentence)].filter((w) => w !== "said" && w !== "mentioned" && w !== "told"));
  const historyWords = tokenize(ctx.history.join(" "));
  const grounded = [...claim].some((w) => historyWords.has(w));
  return grounded ? null : "like_i_said";
}

// ==== The attractor rule: the reply IS one of the prompt's own examples ====
// Ported from social.py's `_is_example_parrot`: the persona prompt says
// to borrow the tone of its few-shot lines and never the words; a small
// model under load hands one back verbatim instead (bench, 2026-09-03:
// the identical line answering two different statements in a row).

function normalizeForCompare(text: string): string {
  return [...tokenize(text)].sort().join(" ");
}

function guardExampleParrot(sentence: string, ctx: GuardContext): GuardReason | null {
  if (!ctx.personaExamples || ctx.personaExamples.length === 0) return null;
  const normalized = normalizeForCompare(sentence);
  if (!normalized) return null;
  return ctx.personaExamples.some((ex) => normalizeForCompare(ex) === normalized) ? "example_parrot" : null;
}

// ==== Composition ====

// Reasons that cut just the offending sentence, leaving an otherwise
// honest reply's earlier sentences standing (bot-legacy's own
// `_CUTTABLE`: the sentence was padding, not the answer). Everything
// else replaces the whole reply - the sentence WAS the reply's thesis.
const CUTTABLE: ReadonlySet<GuardReason> = new Set(["invention", "unrelated_recall"]);

// Per-reason lines, not one generic fallback - bot-legacy's own
// guard_reply picks between cannot_do/not_told/dont_know/chat_loop the
// same way, because "I can't do that" and "I don't know that" are
// different true statements, not interchangeable ones.
const REPLACEMENT_FOR: Record<GuardReason, readonly string[]> = {
  invention: NOT_TOLD,
  unrelated_recall: DONT_KNOW,
  near_echo: DONT_KNOW,
  medication_dose: MED_CAUTION,
  capability_claim: CANNOT_DO,
  like_i_said: CHAT_LOOP,
  example_parrot: DONT_KNOW,
};

/** The honest line a guard hit replaces text with, for a given reason -
 * exported so the streaming path (turnEngine.ts's `gateGuards`) can
 * build the SAME replacement `guardReply()` uses below, one sentence at
 * a time instead of the whole-reply cut/replace decision. */
export function replacementFor(reason: GuardReason, personId: string): string {
  return honest(personId, reason, REPLACEMENT_FOR[reason]);
}

/** Runs every guard against one sentence, in the order a real reply
 * would trip them (an outright claim or echo before a subtler grounding
 * check). `null` means the sentence may stand as written. Exported for
 * the streaming path (turnEngine.ts calls this per sentence, before
 * hand-off to the speaker, the same "a sentence is out of the speaker
 * the moment it is handed over" reasoning bot-legacy's own guards.py
 * docstring gives).
 *
 * `isFirstSentence` (default true) gates near_echo specifically: it is a
 * WHOLE-REPLY concept in bot-legacy (`_is_near_echo(reply, user_text)`,
 * checked once against the complete candidate reply, never per-
 * sentence) - checking a LATER sentence's few words against the FULL
 * utterance's word pool is a real bug this file's own tests found: a
 * compound utterance ("Good morning. How is it going today? Let me
 * know.") lets an unrelated later sentence ("Let me know.") spuriously
 * match words from an EARLIER, unrelated clause ("How is it going
 * today?") of the SAME utterance, near-echo-flagging text that never
 * echoed anything a person actually said back to them in that shape.
 * Restricting the check to the first sentence keeps the guard's real
 * job (catching a reply that opens by just restating the question) while
 * dropping the false positive on everything after it. */
export function guardSentence(sentence: string, ctx: GuardContext, isFirstSentence = true): GuardReason | null {
  const s = sentence.trim();
  if (!s) return null;
  return (
    guardCapabilityClaim(s, ctx) ??
    guardMedicationDose(s) ??
    guardLikeISaid(s, ctx) ??
    guardExampleParrot(s, ctx) ??
    (isFirstSentence ? guardNearEcho(s, ctx) : null) ??
    guardUnrelatedRecall(s, ctx) ??
    guardInvention(s, ctx)
  );
}

/** The non-streaming path: splits `reply` into sentences, guards each in
 * order, and either cuts a CUTTABLE offender (keeping whatever honest
 * sentences came before it) or replaces the whole reply the moment a
 * non-cuttable reason fires - bot-legacy's own guard_reply(), same
 * shape. Never called on a safety refusal, a command, or a package's own
 * `speech` string - turnEngine.ts only ever runs this on `source:
 * "model"` text. */
export function guardReply(reply: string, ctx: GuardContext): Guarded {
  const sentences = (reply || "").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const fullReplyCtx: GuardContext = { ...ctx, replyHasQuestion: (reply || "").includes("?") };
  const kept: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]!;
    const reason = guardSentence(sentence, fullReplyCtx, i === 0);
    if (reason === null) {
      kept.push(sentence);
      continue;
    }
    if (kept.length > 0 && CUTTABLE.has(reason)) {
      return { reply: kept.join(" "), reason };
    }
    return { reply: replacementFor(reason, ctx.personId), reason };
  }
  return { reply, reason: null };
}
