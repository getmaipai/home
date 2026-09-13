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
  /** JOIN-01: verbatim lines from earlier conversations (both halves of
   * each recalled turn) that ground a reply the same way `sources` do,
   * but are NOT candidates for `unrelated_recall`: a recalled reply said
   * back to "what did you suggest last week" is the answer, not a memory
   * line said to the wrong question, and its words rarely share a stem
   * with the question that asked for it (a code review on JOIN-01). */
  episodes?: readonly string[];
  /** True only when a real package actually ran this turn - the one
   * thing that can make "I've added that" true rather than a claim
   * ahead of the fact. */
  actionsRan?: boolean;
  /** The active persona's own few-shot voice lines (persona.ts's
   * `Persona.examples`) - borrowed for TONE, never handed back verbatim. */
  personaExamples?: readonly string[];
  /** FAST-05: the household's own people (display names and nicknames),
   * so a location claim can tell a household subject ("Pippa is at
   * soccer practice", which needs a source) from the world ("Paris is
   * in France", which needs none). Empty or absent means only the
   * second person ("you", "your brother") counts as household. */
  roster?: readonly string[];
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
  /** getmaipai/home#78: true when `reply` is the guard's own honest line
   * (nothing of the model's words survived); false when a cuttable
   * reason only dropped the tail and `reply` is the model's own kept
   * prefix, a genuine if shortened answer. The turn row stores the
   * reason only for the replaced case, so the episode store can tell a
   * canned line from an answer by the row alone. */
  replaced: boolean;
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

// ==== Invention: a claim about the household with nothing behind it ====
// bot-legacy's guards.py: "unsupported_claim"/"invented_location" -
// several narrow sub-shapes there (a third party's traits, a place for a
// person, a quote put in someone's mouth, a sensory experience this hub
// cannot have). Each one is a SHAPE, not a word check.
//
// FAST-05 (docs/dev.md, "Chat direction review and the two-track plan",
// decision 5): until 2026-09-12 this guard also ran a bare-candidate
// scan, flagging any mid-sentence capitalised word, four-digit-or-less
// number, or day/month name that appeared nowhere in the utterance, the
// sources, or the history. That was the 2026-09-07 record's "world
// knowledge is allowed" decision, recorded but never built: it rejected
// "The capital is Paris.", "It is 4.", and "how often do those need
// watering" answered with a number, and fired on 19 of 44 turns in the
// hub's own log. The scan is gone, together with the `GUESSING_RE`
// hedge check ("probably a", "I'm guessing": a hedge is exactly what
// INFORMATION_HANDLING_POLICY asks for when the model is unsure, not an
// invention). What remains is the household-claim half, kept unchanged:
// a trait or place for a person here, a quote attributed to someone, a
// first-person experience. General knowledge passes; a claim about the
// people in this house still needs a source. The four probes and the
// three household negatives live in spec/llm/guard-corpus.json and
// tests/guards.test.ts as permanent regression rows.

/** How many of the person's earlier turns count as "the question in its
 * conversation": enough to resolve a pronoun or a possessive ("my car"
 * two turns back), not the whole window. Shared by the household guess
 * and unrelated-recall checks. */
const RECENT_TURNS_FOR_RECALL = 2;

const DECLINE_RE =
  /\b(?:i (?:don't|do not|didn't|did not|can't|cannot|haven't|have not|never|wasn't|was not) (?:know|remember|recall|have|hear|heard|see|saw|think|catch))\b|\bnot sure\b|\bno idea\b/i;

// A code review (2026-09-06) found this returning a plain joined STRING,
// checked with `.includes()` - a real word-boundary bug, not just an
// edge case: "carbarn" grounds "barn" as a substring match, silently
// defeating invention detection for any invented word that happens to
// be a substring of an unrelated grounded one. A tokenized WORD SET
// (reused `tokenize()`, same stopword-dropping every other guard already
// uses) checked with `.has()` is real word-boundary matching, not a
// substring scan.
function groundedWords(ctx: GuardContext): Set<string> {
  return tokenize([ctx.utterance, ...(ctx.sources ?? []), ...(ctx.episodes ?? []), ...(ctx.history ?? [])].join(" "));
}

// Narrow, specific invention SHAPES - each ported directly from a
// guards.py regex of the same name, kept narrow on purpose (a real
// pattern, not "any ungrounded word") so this stays a precise catch
// rather than a blunt content filter that would flag ordinary, harmless
// conversational words too. Found live via this step's own conversation
// bench (backend/scripts/bench/conversation.ts): the 34 real scenarios
// invent lowercase nouns ("gallery", "sedan", "kitchen") a name/number
// check could never see, which is why the shapes carry the guard.

// "I think you're talking about a sedan, right?" answering "what type of
// car needs to be charged" after "my car needs to be charged": a guess
// about the household's own business is an invented household fact
// wearing a hedge. FAST-05b (the coordinator's ruling after FAST-05
// deleted the old GUESSING_RE outright and the conversation bench lost
// this exact row): the guess phrases stay, household-scoped. They fire
// only when the subject is household-owned (a first- or second-person
// possessive in the utterance, the person's last two turns, or the
// guessed clause itself, or a roster name in any of them) AND the
// guessed clause carries a word nothing in the sources grounds. "I
// think you're talking about Paris" to a France question is the
// world-knowledge hedge INFORMATION_HANDLING_POLICY asks for and
// passes; "my guess is your dentist is Thursday" passes with the
// memory present and flags without it. "probably a" and "I'm guessing"
// (the old regex's other two shapes) stay deleted: they hedge, they do
// not point at what the household meant.
const HOUSEHOLD_GUESS_RE = /\bi think you(?:'re| are)? (?:talking about|referring to|means?)\b|\byou must mean\b|\bmy guess is\b/i;
const OWNED_BY_HOUSEHOLD_RE = /\b(?:my|our|your|mine|ours|yours)\b/i;

// A confirmation tag after the guess ("..., right?", "correct?") is
// not part of what was guessed.
const TAG_QUESTION_RE = /[,\s]*\b(?:right|correct|yeah|yes|no|ok|okay|isn't it|is that it)\b\s*\??\s*$/i;

function guessesAboutHousehold(sentence: string, ctx: GuardContext, grounded: Set<string>): boolean {
  const guess = sentence.match(HOUSEHOLD_GUESS_RE);
  if (!guess) return false;
  const guessed = sentence.slice(guess.index! + guess[0].length).replace(TAG_QUESTION_RE, "");
  const recent = (ctx.history ?? []).slice(-RECENT_TURNS_FOR_RECALL);
  // The guessed CLAUSE, never the whole sentence: "my guess is" carries
  // "my" and would otherwise own itself (a code review on this diff).
  const scope = [ctx.utterance, ...recent, guessed].join(" ");
  // Letter lookarounds, not `\b`: "José's" has no ASCII word boundary
  // between the é and the apostrophe. Raw text, not tokenize(), so
  // "Pippa's practice" still counts.
  const namesFirstWord = (ctx.roster ?? []).map((name) => name.trim().split(/\s+/)[0]!).filter(Boolean);
  const householdOwned =
    OWNED_BY_HOUSEHOLD_RE.test(scope) ||
    namesFirstWord.some((first) => new RegExp(`(?<!\\p{L})${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\p{L})`, "iu").test(scope));
  if (!householdOwned) return false;
  return unclaimedWords(guessed, grounded).length > 0;
}

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

// "Pippa is at soccer practice right now.", "You're at the office." - a
// location for a person in THIS household, the one shape guards.py's own
// comment calls out by name ("the robot has exactly one source for it:
// somebody told it - its OWN situation is not that source"). FAST-05
// narrowed the subject: it used to be any word of three letters or more
// (the /i flag made `[A-Z][a-z]{2,}` match "paris" and "dinner" alike),
// so "Paris is in France" and "Dinner is on the table" were inventions.
// Now the subject must be a roster name (`ctx.roster`), a second-person
// form, or a third-person pronoun; the world's own geography needs no
// source. The article after the preposition became optional so "at
// soccer practice" is caught, not just "at the office"; the medium code
// review on this diff then found that the wider subject and the
// optional article together turned everyday idioms into cuts ("You're
// in luck", "They're on their way", "He's in a good mood"), so the word
// after the preposition is checked against LOCATION_IDIOM_WORDS first.
// Every clause is checked (matchAll), not just the first: "Dinner is on
// the table and Pippa is at the shops" has its household claim second.
const LOCATION_CLAIM_RE =
  /\b(he|she|they|you|your\s+\p{L}+|\p{L}[\p{L}'-]+)(?:'s|'re|\s+(?:is|are|was|were|lives?|lived|stays?|staying|works?|sits?|sleeps?))\s+(?:currently\s+|probably\s+|still\s+)?(?:in|at|on|near|by|inside)\s+(?:(?:the|a|an|his|her|their|your|my|its)\s+)?([\p{L}][\p{L}\d'-]{1,20})\b/giu;

// Words that follow "in/on/at" in an idiom about a state, not a place.
// "You're in luck", "on the right track", "in a good mood", "on their
// way", "in season", "in charge", "in touch": none of these puts anyone
// anywhere, and every one is ordinary assistant phrasing.
const LOCATION_IDIOM_WORDS = new Set(
  "luck track way season mood charge trouble board fire time touch love hurry doubt risk odds shape stock control danger fact general particular order business middle meantime addition case spite favor favour need pain sync line tune edge rush awe vain common private public total turn use question effect right good bad same new old best big little great high low top front back side own other".split(" "),
);

/** A roster name (its first word, so "Pippa" matches a "Pippa Jones"
 * display name), the second person, or a third-person pronoun: "He's in
 * the kitchen" (the conversation bench's own live-found shape) can only
 * ever be about a person in this conversation, never about the world,
 * the same reading PERSON_TRAIT_RE already takes of he/she/they. "It's
 * in the kitchen" is a thing, and passes. */
function isHouseholdSubject(subject: string, ctx: GuardContext): boolean {
  const lower = subject.toLowerCase();
  if (lower === "he" || lower === "she" || lower === "they" || lower === "you" || lower.startsWith("your ")) return true;
  return (ctx.roster ?? []).some((name) => {
    const first = name.trim().toLowerCase().split(/\s+/)[0];
    return first === lower || name.trim().toLowerCase() === lower;
  });
}

/** True when some clause of `sentence` puts a household subject at an
 * ungrounded place. */
function claimsUngroundedHouseholdLocation(sentence: string, ctx: GuardContext, grounded: Set<string>): boolean {
  for (const m of sentence.matchAll(LOCATION_CLAIM_RE)) {
    const place = m[2]!.toLowerCase();
    if (LOCATION_IDIOM_WORDS.has(place)) continue;
    if (!isHouseholdSubject(m[1]!, ctx)) continue;
    if (!grounded.has(place)) return true;
  }
  return false;
}

// "Nadia said she'd like pasta tonight." - speech attributed to a named
// person, where the CONTENT of the quote isn't anything the sources
// actually hold. A real quote the robot holds ("Bramble said he wants
// pizza") is grounded and stands; an invented one is not.
//
// FAST-05, live-found 2026-09-12 on the Track A engine: this carried the
// /i flag, so its `[A-Z][a-z]{2,}` name branch matched any three-letter
// word and "That's not something I've been told." (the hub's own
// honest line, parroted back by the model from earlier in the
// conversation) read as "<Name> told" and was cut as an invention. The
// name branch is case-sensitive now (a capitalised name), with the
// relation and pronoun forms spelled out; "been told", "was told" and
// "just mentioned" are no longer attributions. A capitalised word that
// names no person ("Legend says", "History says", "Research says") is
// a world-knowledge framing, not a quote, and is excluded by name.
const ATTRIBUTED_QUOTE_RE = /\b([A-Z][a-z]{2,}|[Yy]our (?:brother|sister|mother|mom|father|dad)|[Hh]e|[Ss]he|[Tt]hey)\s+(?:said|says|told|mentioned)\b/g;
const NOT_A_SPEAKER = new Set(
  "legend history science research studies experts people everyone everybody nobody someone anyone rumor rumour tradition folklore wikipedia google reports sources data evidence".split(" "),
);

function attributesToAPerson(sentence: string): boolean {
  for (const m of sentence.matchAll(ATTRIBUTED_QUOTE_RE)) {
    if (!NOT_A_SPEAKER.has(m[1]!.toLowerCase())) return true;
  }
  return false;
}

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

  if (CLAIMED_EXPERIENCE_RE.test(sentence)) return "invention";
  if (guessesAboutHousehold(sentence, ctx, grounded)) return "invention";

  if (claimsUngroundedHouseholdLocation(sentence, ctx, grounded)) return "invention";

  if (attributesToAPerson(sentence)) {
    // The name/relation word and the speech verb itself are never the
    // invented part - only what comes AFTER "said" is the quote's own
    // content, so a plain re-check of every content word (minus a small
    // set of the sentence's own scaffolding, on top of the shared safe
    // words) is what actually tells a real quote from a fabricated one.
    const scaffold = new Set(["said", "says", "told", "mentioned", "your", "brother", "sister", "mother", "mom", "father", "dad"]);
    if (unclaimedWords(sentence, grounded).some((w) => !scaffold.has(w))) return "invention";
  }

  return null;
}

// ==== Unrelated recall: a real source line, said back to the WRONG question ====
// Ported closely from guards.py's `_is_unrelated_source_line`: "when is my
// flight" answered "The dentist is on Thursday at four" - a real memory
// line, just not one that answers what was asked. Recognised by the
// sentence's content words being (nearly) all inside ONE source line,
// while the sentence shares NO content word with the question itself.
//
// FAST-05: "the question itself" is the question in its conversation.
// "what does she like" after "tell me about Pippa" is a question about
// Pippa, so the source line "Pippa likes painting" answering it with
// "She likes painting." is related, not a wrong memory said back: the
// person's last two turns (`ctx.history`, enough to resolve a pronoun,
// not the whole window, which would let any topic mentioned earlier in
// a long conversation excuse the wrong memory) count as part of what
// was asked, and a shared stem counts as a shared word (near-echo's own
// `wordMatches`, one rule, not a second one). The flight-versus-dentist
// case still flags: nothing in "when is my eye exam" shares a stem with
// "dentist", "thursday", "four".

function guardUnrelatedRecall(sentence: string, ctx: GuardContext): GuardReason | null {
  const said = tokenize(sentence);
  if (said.size < 2) return null;
  const recent = (ctx.history ?? []).slice(-RECENT_TURNS_FOR_RECALL);
  const asked = [...tokenize([ctx.utterance, ...recent].join(" "))];
  for (const line of ctx.sources ?? []) {
    const have = tokenize(line);
    if (have.size === 0) continue;
    const overlap = [...said].filter((w) => have.has(w)).length;
    if (overlap < Math.max(2, Math.floor(0.8 * said.size))) continue;
    const havePool = [...have];
    return asked.some((w) => wordMatches(w, havePool)) ? null : "unrelated_recall";
  }
  return null;
}

// ==== Near-echo: the reply only restates the person's own words ====
// Ported from social.py's `_is_near_echo`: strip a leading acknowledgment
// ("Okay, ..."), then ask whether every remaining word already appeared
// in the utterance (a shared 4+ letter stem counts, so "playing" answers
// "play"). Restating is never an answer.

const ACK_LEAD_RE = /^(?:okay|ok|alright|right|sure|yeah|yes|oh|ah|so|got it|nice|cool|mm-?hmm|mm)\b[\s,.!-]*/i;

// Live-found 2026-09-07, Jesse: "good morning" -> "Good morning!" was
// getting flagged near_echo too. The check below works by asking whether
// every word of the reply's first sentence already appears in the
// utterance - which is exactly what a correct greeting reciprocation
// does (it's the same two or three words, on purpose), so a bare
// greeting exchange leaves the check no way to tell "stalled, just
// echoed the claim back" from "said good morning back, which is the
// right thing to say." A greeting reciprocation is the one reply shape
// where echoing the words back *is* the answer, so it's exempted here -
// a short, bounded, well-known vocabulary (matching ACK_LEAD_RE's own
// precedent just above), not an open-ended judgment call.
//
// A code review (2026-09-07) caught the first cut of this anchoring the
// exemption to the WHOLE utterance being nothing but the greeting -
// which missed the everyday compound case "good morning, how are you"
// -> "Good morning!" (still flagged, since the utterance carries more
// than just the greeting). The reply's OWN first sentence is what
// actually needs to be a bare reciprocation (GREETING_ONLY_RE, anchored
// both ends); the utterance only needs to contain a greeting somewhere
// in it (GREETING_ANYWHERE_RE, unanchored) for that reciprocation to
// make sense. This still leaves the ps5 bench case caught: its
// utterance carries no greeting at all, so GREETING_ANYWHERE_RE never
// matches. And it still leaves a REAL echo caught even inside a
// greeting-carrying utterance ("good morning, I play it on the ps5" ->
// "Okay, playing it on the ps5.") - that reply's own sentence isn't a
// bare greeting, so GREETING_ONLY_RE doesn't match it either.
const GREETING_ONLY_RE =
  /^(?:(?:good\s+)?(?:morning|afternoon|evening|night)|hello|hi|hey|howdy|greetings|yo|what'?s up)\b(?:\s+(?:there|to you|too))*[\s!.,?]*$/i;
const GREETING_ANYWHERE_RE =
  /\b(?:good\s+(?:morning|afternoon|evening|night)|hello|hi|hey|howdy|greetings|yo|what'?s up)\b/i;

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
  if (GREETING_ONLY_RE.test(stripped.trim()) && GREETING_ANYWHERE_RE.test(ctx.utterance)) return null;
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

/** Exported so turnEngine.ts's streaming path (`gateGuards()`) makes the
 * SAME cut-vs-replace-the-rest distinction guardReply() does below - one
 * definition of "which reasons are padding vs the reply's own thesis,"
 * never a second copy re-guessed at the call site. */
export function isCuttable(reason: GuardReason): boolean {
  return CUTTABLE.has(reason);
}

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

/** The exact sentence split guardReply() itself applies below - exported
 * so a caller that needs to check just the reply's FIRST sentence in
 * isolation (turnEngine.ts's own invention-retry, getmaipai/home#67)
 * uses the IDENTICAL split guardReply() will apply moments later,
 * rather than a second, independently-typed regex that could drift from
 * it (a code review, 2026-09-07, found a first cut doing exactly that). */
export function splitIntoSentences(reply: string): string[] {
  return (reply || "").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
}

/** The non-streaming path: splits `reply` into sentences, guards each in
 * order, and either cuts a CUTTABLE offender (keeping whatever honest
 * sentences came before it) or replaces the whole reply the moment a
 * non-cuttable reason fires - bot-legacy's own guard_reply(), same
 * shape. Never called on a safety refusal, a command, or a package's own
 * `speech` string - turnEngine.ts only ever runs this on `source:
 * "model"` text. */
export function guardReply(reply: string, ctx: GuardContext): Guarded {
  const sentences = splitIntoSentences(reply);
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
      return { reply: kept.join(" "), reason, replaced: false };
    }
    return { reply: replacementFor(reason, ctx.personId), reason, replaced: true };
  }
  return { reply, reason: null, replaced: false };
}
