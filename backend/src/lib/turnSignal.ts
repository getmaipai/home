// ACT-01 (docs/dev.md section 12, "The act and the emotion of a turn, and
// the register they drive"): the turn signal's producer, the first two of
// its four layers. What kind of turn the person just made (the act) and
// what the words expressed (the emotion), read once before routing and
// frozen on the turn (spec/schemas/turn-signal.schema.json, carried on
// the conversation-turn record), so the router, the guards, the judge and
// the review all read what the engine believed at the time and nothing
// classifies the turn twice. `utteranceShape()` is a projection of this
// now (`shapeOf()`), not a second reading.
//
// The precedence, one place: protocol state wins (an answer the pending
// ask's state machine consumed is that answer, whatever a classifier
// would say about "yes"); high-precision rules next (an exact greeting,
// closing or backchannel, an explicit question form, a package-declared
// command opener or a literal-pattern win, a correction phrase, a stance
// marker, an unmistakable emotion word); the heads over the utterance
// embedding are ACT-02's (`source: head`); and the conservative fallback
// (inform, neutral, every clause `unknown`) stands when nothing above
// decided. Precision over recall throughout: a missed emotion costs a
// warmer sentence, a false one makes the companion behave wrongly, and
// on the memory side a false `asserted` is a false memory (MEM-06 reads
// the clause stance; `unknown` writes nothing).
//
// No engine, no database: the caller hands in the roster and a name
// resolver, so the same function runs on the robot and in a test.
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import { NEGATIVE_RE } from "@/lib/consentVocab";
import { isBareSocialTurn } from "@/lib/guards";
import { readClauses, shapeFromReading, type ClauseReading, type UtteranceClause, type UtteranceShape } from "@/lib/utteranceShape";
import { relationshipTypes } from "@maipai/spec/records/ts/validate.js";

export type Act = TurnSignal["primary_act"];
export type Stance = TurnSignal["clauses"][number]["stance"];
export type Emotion = TurnSignal["expressed_emotion"];
export type Intensity = TurnSignal["emotion_intensity"];
export type SignalClause = TurnSignal["clauses"][number];
export type ClauseSubject = SignalClause["subject"];

/** The pending-ask state machine's reading of the turn, when it consumed
 * it (turnEngine.ts's resolvePendingAsk()): the signal is that answer.
 * `who` and `lookup` arrive with ASK-01 and LOOKUP-01. */
export interface ProtocolAnswer {
  kind: "confirm" | "ask" | "who" | "lookup";
  answer: "affirmative" | "negative" | "value";
}

export interface SignalInput {
  text: string;
  /** The installed packages' own command verbs (utteranceShape.ts's
   * commandOpenersFrom()), the router's declaration of what a directive
   * opens with. */
  commandOpeners?: ReadonlySet<string>;
  /** Household display names and nicknames, and the speaker's own
   * people and pets (subjects.ts's subjectRosterFor()): a clause about
   * one of them is a `named` clause. */
  roster?: readonly string[];
  /** Resolves a roster name to a household entity id (`ent-...`), or
   * null when the name is a person row or unresolved. */
  resolveEntity?: (name: string) => string | null;
  protocol?: ProtocolAnswer;
  /** A literal-pattern win in routing: a directive by construction. */
  literalWin?: boolean;
  ageBand: TurnSignal["age_band"];
  ageBandBasis?: TurnSignal["age_band_basis"];
}

// ==== The rule vocabularies ====
// Greetings and closings: the near-echo guard's own greeting set
// (guards.ts's GREETING_ONLY_RE, read through isBareSocialTurn()) plus
// thanks and goodbyes; a thank-you is a closing move (the reciprocal
// close is "you're welcome"), an acknowledgment a backchannel.
const GREETING_RE = /^(?:(?:good\s+)?(?:morning|afternoon|evening)|hello|hi|hey|howdy|greetings|yo|what'?s up|hiya)\b/i;
const CLOSING_RE =
  /\b(?:bye|goodbye|good ?night|night night|see you|see ya|later|talk (?:to you )?(?:later|soon|tomorrow)|that'?s (?:all|it|everything)(?: for (?:now|tonight|today))?|(?:i'?m|i am) (?:off|done|heading (?:out|to bed)|going to bed)|gotta go|got to go|have to go|catch you later|take care|thanks?|thank you|cheers|ta)\b/i;
// A backchannel is one to three words with no content word beyond an
// acknowledgment or a reaction word.
const BACKCHANNEL_WORDS = new Set([
  "ok", "okay", "k", "kk", "alright", "that", "please", "never", "mind", "ugh", "whoa", "woah", "oops", "yay", "ew", "eww", "aw", "aww", "hmph", "meh", "argh", "grr", "omg", "damn", "phew", "yikes", "ooh", "whew", "right", "sure", "yeah", "yes", "yep", "yup", "no", "nope", "nah", "oh", "ah", "so", "hmm", "hm", "mm", "mhm", "uh", "huh", "got", "it", "i", "see", "makes", "sense", "nice", "cool", "great", "good", "fine", "perfect", "sounds", "will", "do", "wow", "really", "interesting", "true", "fair", "enough", "gotcha", "understood", "noted", "same", "totally", "exactly", "indeed", "then", "well", "ha", "haha", "lol",
]);
// A commitment: first person, a future or a promise, the speaker's own.
const COMMISSIVE_RE = /^\s*(?:i'?ll|i will|i won'?t|i'?m going to|i'?m gonna|i am going to|i promise|i plan to|i intend to|we'?ll|we will|we'?re going to|we are going to|let me|i'?m about to|i'?d (?:love|be (?:glad|happy)) to|i can do that|count me in|(?:it'?s a )?deal)\b/i;
// A proposal or advice is a directive (DailyDialog's own reading, and the
// household's: "you should add milk" asks for the add).
// "don't forget to lock the door", "stop the music": a request in the
// negative or a stop word is a directive, never a correction.
const NEGATIVE_IMPERATIVE_RE = /^\s*(?:don'?t|do not|never|stop|cancel|please don'?t|no more)\b/i;
const SUGGESTION_RE = /^\s*(?:let'?s|shall we|you (?:should|must|need to|have to|had better|'d better|ought to)|we should|why don'?t (?:you|we))\b/i;
// Unmistakable stance markers. Quoted needs the marks or a speech verb
// with a colon-free direct quote; reported is "says", "according to",
// "I heard from", a speech verb with an embedded clause; hypothetical is
// "if", "what if", "imagine", "suppose", "I would"; a joke is a laugh
// token or "jk" (irony without a marker is the head's, ACT-02).
const QUOTE_MARKS_RE = /["“”]|(?:^|\s)'[^']{2,}'(?=[\s,.!?]|$)/;
const SPEECH_VERB_RE = /\b(?:said|says|saying|tells?|told|mentioned|claims?|claimed|insists?|swears?|thinks?|reckons?|texted|wrote|heard from|according to)\b/i;
const REPORTED_RE = /\b(?:says|said|tells? me|told me|mentioned|claims?|claimed|insists?|swears?|texted|wrote|heard from|according to|apparently|supposedly)\b/i;
const HYPOTHETICAL_RE = /^\s*(?:if|what if|imagine|suppose)\b|\b(?:if i|if we|imagine if|suppose|hypothetically|what if|would be nice if|wish i|wish we)\b/i;
const JOKE_RE = /\b(?:jk|j\/k|lol|lmao|haha+|hehe+|kidding|joking|as if)\b|(?:^|\s)ha[,!.\s]|😂|🤣|😜|😉/i;
// Repair: a correction rejects a fact the hub used ("no, Friday, not
// Thursday", "you added the wrong item", "I meant"), a retraction takes a
// request or a statement back ("never mind", "scratch that").
const RETRACTION_RE = /\b(?:never ?mind|scratch that|forget (?:it|that|about it)|cancel that|don'?t bother|drop it|leave it|no need)\b/i;
const CORRECTION_RE = /\b(?:the wrong \w+|(?:you'?re|that'?s|that was|it'?s|it was|you got (?:it|that)) wrong|not that|i meant|no,? not|isn'?t right|that'?s not (?:it|right|what i)|no longer|not (?:\w+ ){0,3}anymore|\w+,\s*not\s+\w+|not \w+,\s*\w+)\b/i;
// "no, Friday" opens a correction; "no thanks" and "don't forget to
// lock the door" do not (a review).
const CORRECTING_NO_RE = /^\s*(?:no|nope|nah)\s*,\s*\S/i;
// The emotion lexicon: what the words express, at a strength; the
// common case with no marker is neutral here and the head's later.
type EmotionCue = { emotion: Emotion; strong?: boolean; weak?: boolean };
const EMOTION_CUES: ReadonlyArray<[RegExp, EmotionCue]> = [
  [/\b(?:devastated|heartbroken|grief|grieving|crushed|inconsolable|died|passed away|put (?:him|her|them) down|funeral)\b/i, { emotion: "sadness", strong: true }],
  [/\b(?:sad|miserable|lonely|depressed|upset(?! stomach)|gutted|miss(?:es|ing)? (?:him|her|them|you)|crying|cried|tearing up|heavy heart|bummed|disappointed|feeling (?:down|low))\b/i, { emotion: "sadness" }],
  [/\b(?:terrified|petrified|panicking|panic|horrified)\b/i, { emotion: "fear", strong: true }],
  // "I'm afraid there's been a mistake" is a politeness formula, not fear.
  [/\b(?:nervous|anxious|worried|worrying|worries|worry|scared|afraid(?! (?:that|there|it|we|you|i|not|so|of the|this|he|she|they)\b)|frightened|uneasy|stressed|stressing|freaking out|on edge|apprehensive|jittery|anxiety|dread(?:ing|ed)?|keeps? (?:getting|being) (?:sick|ill|hurt))\b/i, { emotion: "fear" }],
  [/\b(?:furious|livid|enraged|outraged|seething|hate(?:s|d)?(?! to\b)|sick of|fed up|pissed)\b/i, { emotion: "anger", strong: true }],
  [/\b(?:angry|annoyed|annoying|irritated|irritating|frustrated|frustrating|grr+|argh+|ugh+|dammit|damn it|infuriating|ridiculous|unacceptable|the wrong (?:item|one|thing|list|time|day|date|name|person|answer|order|song|playlist|light|room|channel|show|film|movie)|you (?:messed|screwed) up)\b/i, { emotion: "anger" }],
  [/\b(?:thrilled|ecstatic|overjoyed|over the moon|elated|best day|so happy|can'?t wait)\b/i, { emotion: "happiness", strong: true }],
  [/\b(?:happy(?! birthday)|so glad|really glad|glad (?:you|that|to hear)|excited|delighted|thrilled|proud|love(?:d|s)? (?:it|this|that|them|how)|awesome|amazing|wonderful|fantastic|brilliant|yay|woohoo|hooray|great news|good news|got the (?:job|lead|part|role|offer|spot|place)|got in|promoted|won(?!['’])|nailed it|celebrat\w+|happy birthday|congratulations)\b|🎉|🥳|😊|😄|❤️|🎂/i, { emotion: "happiness" }],
  [/\b(?:disgusting|revolting|vile|repulsive|nauseating)\b|🤮|🤢/i, { emotion: "disgust", strong: true }],
  [/\b(?:(?:so|that'?s|how|totally|pretty|really) gross|grossed out|yuck|ew+|eww+|nasty|stinks|rancid|moldy|mouldy|rotten|slimy)\b|\bgross[.!]/i, { emotion: "disgust" }],
  [/\b(?:can'?t believe|no way|unbelievable|shocked|stunned|speechless|out of nowhere|didn'?t see that coming|what the (?:hell|heck))\b/i, { emotion: "surprise", strong: true }],
  [/^\W*(?:wow|whoa|woah|omg)\b|\b(?:surprised|surprising|really\?|seriously\?|huh\?|oh my|wait,? what|plot twist)|😮|😲|🤯/i, { emotion: "surprise" }],
  // A weak cue names an occasion, not a feeling ("play the birthday
  // playlist"): low, a warm word allowed, nothing for memory. Last, so
  // a marked feeling beside the occasion wins (a review).
  [/\b(?:birthday|party|celebration|holiday|vacation|honeymoon|wedding|graduation)\b/i, { emotion: "happiness", weak: true }],
];
const INTENSIFIER_RE = /\b(?:so|very|extremely|absolutely|totally|completely|incredibly|utterly|super|truly|deeply|beyond)\b/i;
// "I'm not nervous anymore" expresses no fear: a negated cue is neutral.
const NEGATED_CUE_RE = /\b(?:not|never|no longer|n't|isn'?t|aren'?t|wasn'?t|don'?t|doesn'?t|didn'?t|hardly)\s+(?:\w+\s+){0,2}$/i;
const DIMINISHER_RE = /\b(?:a (?:little|bit|tad|touch)|slightly|kind of|kinda|sort of|sorta|somewhat|mildly|a little bit)\b/i;
const EXPLETIVE_RE = /\b(?:damn|dammit|hell|crap|shit|fuck\w*|bloody|freaking|frigging|wtf|ffs)\b/i;
const REPEATED_PUNCTUATION_RE = /[!?]{2,}|!\s*$/;
const REPEATED_WORD_RE = /\b(\w{3,})\b(?:[\s,]+\1\b)+/i;
const SHOUTING_RE = /\b[A-Z]{3,}\b/;
// Whose feeling: first person, the hub, a named other, or the world.
const FIRST_PERSON_RE = /\b(?:i|i'?m|i'?ve|i'?d|i'?ll|me|my|mine|myself)\b/i;
const FIRST_PERSON_SUBJECT_RE = /\b(?:i|i'?m|i'?ve|i'?d|i'?ll|me|myself)\b/i;
const HOUSEHOLD_RE = /\b(?:we|we'?re|we'?ve|we'?d|we'?ll|us|our|ours|the (?:house|family|kids|household))\b/i;
const SECOND_PERSON_RE = /\b(?:you|you'?re|you'?ve|your|yours)\b/i;
const HUB_BLAME_RE = /\byou (?:added|set|put|said|told|gave|sent|did|got|forgot|missed|deleted|removed|turned|played|changed|made|messed|screwed|were|are|keep|didn'?t|don'?t|never|always|have|had|heard|read|misheard|misunderstood)\b|\b(?:wrong|not what i (?:said|asked|meant))\b/i;

// The everyday imperative verbs a household says to its hub beside the
// packages' own declared openers (guards.ts's REQUEST_RE trusts the same
// list for an action claim): "lock the front door", "text Nadia", "take
// the second one off" are directives whether or not a package matched.
// Bounded on purpose: never "every opener-less fragment" (the router's
// own review), and the router's shape reads the same merged set through
// shapeOf(), so the two never disagree.
export const EVERYDAY_IMPERATIVES: ReadonlySet<string> = new Set([
  "text", "send", "order", "book", "email", "add", "set", "call", "print", "buy", "schedule", "message", "put", "turn", "play", "lock", "unlock", "open", "close", "start", "stop", "remind", "remember", "forget",
  "tell", "show", "say", "repeat", "take", "give", "find", "search", "check", "cancel", "delete", "remove", "pause", "resume", "skip", "dim", "brighten", "wake", "read", "list", "change", "switch", "mute", "unmute",
]);

function openersFor(input: SignalInput): ReadonlySet<string> {
  const merged = new Set(EVERYDAY_IMPERATIVES);
  for (const o of input.commandOpeners ?? []) merged.add(o);
  return merged;
}

/** The confidence a directive by construction carries; a proposal read
 * by the rules sits below it (see shapeOf()). */
export const COMMAND_CONFIDENCE = 0.9;

const ACT_PRECEDENCE: readonly Act[] = ["directive", "question", "commissive", "inform", "greeting", "closing", "backchannel"];
const EMOTION_RANK: Record<Intensity, number> = { none: 0, low: 1, moderate: 2, high: 3 };
const BANDS: readonly Intensity[] = ["none", "low", "moderate", "high"];

const wordsOf = (text: string) => text.toLowerCase().replace(/[^a-z' ]+/g, " ").split(/\s+/).filter(Boolean);

function isBackchannel(clause: string): boolean {
  const words = wordsOf(clause);
  if (words.length === 0 || words.length > 3) return false;
  return words.every((w) => BACKCHANNEL_WORDS.has(w));
}

function isGreetingClause(clause: string): boolean {
  return GREETING_RE.test(clause.trim()) && isBareSocialTurn(clause);
}

// What may stand beside a closing phrase and leave it a close ("ok
// thanks, that's all for tonight, night Sage"): the backchannel words,
// the connectives, and a capitalized addressee.
const CLOSING_FILLER = new Set(["for", "now", "tonight", "today", "everyone", "everybody", "all", "anyway", "guess", "think", "and", "to", "the", "a", "you", "much", "very", "lot", "again", "night", "with", "help", "that", "this", "update", "info", "reminder", "answer", "tip", "bed", "sleep", "im", "i'm", "off"]);
function isClosingClause(clause: string): boolean {
  const t = clause.trim();
  if (!CLOSING_RE.test(t)) return false;
  if (isBareSocialTurn(t)) return true;
  // "remind me later" is a request, "thanks, what time is it" a
  // question: a closing clause is bare beyond its closing words, the
  // same test the greeting uses.
  const residual = t.replace(new RegExp(CLOSING_RE.source, "gi"), " ").replace(/[,\s]+(?:\p{Lu}\p{L}*)(?=[\s!.,?]*$)/u, " ");
  return wordsOf(residual).every((w) => BACKCHANNEL_WORDS.has(w) || CLOSING_FILLER.has(w));
}

/** The act of one clause from the shape reading and the management
 * vocabularies; `literalWin` is applied by the caller on the turn. */
function clauseAct(clause: UtteranceClause, reading: ClauseReading, index: number): { act: Act; confidence: number } {
  const t = clause.text;
  const questionMarked = /\?\s*$/.test(t.trim()) && !clause.polite;
  if (clause.signal === "command" || (index === 0 && reading.leadingPlease && clause.signal !== "question")) return { act: "directive", confidence: 0.9 };
  if (clause.signal === "question" || questionMarked) return { act: "question", confidence: questionMarked && clause.signal === "question" ? 0.95 : 0.85 };
  if (isGreetingClause(t)) return { act: "greeting", confidence: 0.95 };
  if (isClosingClause(t)) return { act: "closing", confidence: 0.9 };
  if (isBackchannel(t)) return { act: "backchannel", confidence: 0.85 };
  if (COMMISSIVE_RE.test(t)) return { act: "commissive", confidence: 0.8 };
  if (SUGGESTION_RE.test(t)) return { act: "directive", confidence: 0.7 };
  if (NEGATIVE_IMPERATIVE_RE.test(t)) return { act: "directive", confidence: 0.7 };
  // Inform is the residual: a first-person or third-person statement.
  // Without the head, inform-versus-commissive on an unmarked clause is
  // the fallback's guess, at a lower confidence.
  return { act: "inform", confidence: clause.signal === "first_person" ? 0.75 : 0.6 };
}

function clauseStance(text: string, act: Act, turnJoke: boolean): { stance: Stance; confidence: number } {
  if (act === "question" || act === "directive" || act === "greeting" || act === "closing" || act === "backchannel") return { stance: "asserted", confidence: 0.9 };
  if (turnJoke || JOKE_RE.test(text)) return { stance: "joke", confidence: 0.85 };
  if (QUOTE_MARKS_RE.test(text) && SPEECH_VERB_RE.test(text)) return { stance: "quoted", confidence: 0.9 };
  if (HYPOTHETICAL_RE.test(text)) return { stance: "hypothetical", confidence: 0.85 };
  if (REPORTED_RE.test(text)) return { stance: "reported", confidence: 0.85 };
  return { stance: "asserted", confidence: 0.7 };
}

// One compiled pattern per roster name, kept across turns: the roster
// is read on every turn and a fresh RegExp per name per clause was most
// of the classifier's cost.
const NAME_PATTERNS = new Map<string, RegExp>();
function namePattern(name: string): RegExp {
  let re = NAME_PATTERNS.get(name);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu");
    if (NAME_PATTERNS.size > 512) NAME_PATTERNS.clear();
    NAME_PATTERNS.set(name, re);
  }
  return re;
}

function nameIn(text: string, roster: readonly string[]): string | null {
  for (const name of roster) {
    if (name && namePattern(name).test(text)) return name;
  }
  return null;
}

// The source of a report or a quote when the roster does not know the
// name yet ("my sister Nadia says she hates cilantro" before the judge
// has made Nadia an entity): the capitalized word before the speech verb.
const NAMED_SOURCE_RE = /(?:^|[\s,])(\p{Lu}\p{L}+)\s+(?:says|said|tells|told|mentioned|claims|claimed|insists|swears|texted|wrote)\b/u;
// A sentence-initial pronoun or quantifier before a speech verb is not a
// name ("He said the vet is closed"): a review.
const NOT_A_NAME = new Set(["i", "he", "she", "they", "we", "you", "it", "everyone", "everybody", "someone", "somebody", "nobody", "anyone", "people", "who", "that", "this", "the", "and", "but", "so", "then", "well", "also", "my", "our", "her", "his", "their", "its"]);
// A relation phrase with a name ("my coworker Tempo", "our older
// neighbor Marlow") names the subject before the registry knows it
// (ASK-01's relation nouns resolve it later). The nouns are the
// relationship vocabulary's own said_as phrases (spec/vocab/
// relationship-types.json), never any two words: "my trip to Paris" is
// the speaker's trip, not someone called Paris (a review).
let relatedNameRe: RegExp | null = null;
function relatedNamePattern(): RegExp {
  if (relatedNameRe) return relatedNameRe;
  const nouns = new Set(["neighbor", "neighbour", "teacher", "doctor", "dentist", "vet", "coach", "nanny", "babysitter", "roommate", "landlord"]);
  for (const type of relationshipTypes()) {
    for (const phrase of type.said_as ?? []) {
      const [head, ...rest] = phrase.split(" ");
      if ((head === "my" || head === "our") && rest.length === 1 && /^[a-z-]+$/.test(rest[0]!)) nouns.add(rest[0]!);
    }
  }
  relatedNameRe = new RegExp(`\\b(?:my|our) (?:[a-z]+ )?(?:${[...nouns].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}) (\\p{Lu}\\p{L}+)\\b`, "u");
  return relatedNameRe;
}

function namedIn(text: string, stance: Stance, roster: readonly string[]): string | null {
  const fromRoster = nameIn(text, roster);
  if (fromRoster) return fromRoster;
  const source = stance === "reported" || stance === "quoted" ? (NAMED_SOURCE_RE.exec(text)?.[1] ?? null) : null;
  if (source && !NOT_A_NAME.has(source.toLowerCase())) return source;
  return relatedNamePattern().exec(text)?.[1] ?? null;
}

function clauseSubject(text: string, stance: Stance, input: SignalInput): ClauseSubject {
  const named = namedIn(text, stance, input.roster ?? []);
  // A report or a quote is about its source, not the speaker who
  // relayed it ("my sister Nadia says she hates cilantro").
  if (named && (stance === "reported" || stance === "quoted")) return { kind: "named", name: named, entity_id: input.resolveEntity?.(named) ?? null };
  // "my coworker Tempo likes seltzer" is about Tempo: a possessive alone
  // ("my", "our") does not make the speaker the subject beside a name.
  if (FIRST_PERSON_RE.test(text) && !(named && !FIRST_PERSON_SUBJECT_RE.test(text))) return { kind: "speaker" };
  if (named) return { kind: "named", name: named, entity_id: input.resolveEntity?.(named) ?? null };
  if (HOUSEHOLD_RE.test(text)) return { kind: "household" };
  return { kind: "world" };
}

function bump(band: Intensity, steps: number): Intensity {
  const i = Math.max(0, Math.min(BANDS.length - 1, EMOTION_RANK[band] + steps));
  return BANDS[i]!;
}

/** The expressed emotion of a clause and its intensity from surface
 * cues: a strong word starts at high, an ordinary one at moderate; an
 * intensifier, shouting, repeated punctuation, an expletive or a
 * repeated word raise a band, a diminisher lowers one. Neutral is none. */
function clauseEmotion(text: string): { emotion: Emotion; intensity: Intensity; confidence: number } {
  let cue: EmotionCue | null = null;
  for (const [re, c] of EMOTION_CUES) {
    const m = re.exec(text);
    if (!m) continue;
    if (NEGATED_CUE_RE.test(text.slice(0, m.index))) continue;
    cue = c;
    break;
  }
  if (!cue) return { emotion: "neutral", intensity: "none", confidence: 0.5 };
  let band: Intensity = cue.strong ? "high" : cue.weak ? "low" : "moderate";
  const raise = [INTENSIFIER_RE, SHOUTING_RE, REPEATED_PUNCTUATION_RE, EXPLETIVE_RE, REPEATED_WORD_RE].filter((re) => re.test(text)).length;
  if (raise > 0) band = bump(band, 1);
  if (DIMINISHER_RE.test(text)) band = bump(band, -1);
  return { emotion: cue.emotion, intensity: band, confidence: cue.strong ? 0.85 : cue.weak ? 0.55 : 0.7 };
}

function targetOf(text: string, subject: ClauseSubject): TurnSignal["target"] {
  if (HUB_BLAME_RE.test(text) && SECOND_PERSON_RE.test(text) && subject.kind !== "named") return "hub";
  if (subject.kind === "named") return "other";
  if (subject.kind === "speaker") return "self";
  if (SECOND_PERSON_RE.test(text) && subject.kind === "world") return "hub";
  return "world";
}

/** A retraction takes anything back; a correction rejects a fact the
 * hub used, so it is read only on a turn that states something (never
 * on a question or a request: "what's wrong with the lights" asks,
 * "stop the music" directs). */
function repairOf(text: string, primary: Act): TurnSignal["repair"] {
  if (RETRACTION_RE.test(text)) return "retraction";
  if (primary !== "inform" && primary !== "commissive") return "none";
  if (CORRECTION_RE.test(text) || CORRECTING_NO_RE.test(text)) return "correction";
  return "none";
}

function primaryOf(acts: readonly Act[]): Act {
  for (const act of ACT_PRECEDENCE) if (acts.includes(act)) return act;
  return "inform";
}

/** The conservative signal: an explicit question or directive from the
 * rules stands (the caller passes them), otherwise inform, neutral, every
 * clause `unknown`. Also what a turn gets when classification throws. */
export function fallbackSignal(text: string, ageBand: TurnSignal["age_band"], ageBandBasis: TurnSignal["age_band_basis"] = "identified_profile", act: Act = "inform"): TurnSignal {
  return {
    primary_act: act,
    secondary_acts: [],
    expressed_emotion: "neutral",
    emotion_intensity: "none",
    target: "self",
    repair: "none",
    refers_to_prior: null,
    clauses: [{ range: { start: 0, end: text.length }, act, stance: "unknown", subject: { kind: "unknown" }, emotion: "neutral", emotion_intensity: "none", confidence: 0.3 }],
    act_confidence: 0.3,
    emotion_confidence: 0.3,
    source: "fallback",
    classifier_id: null,
    age_band: ageBand,
    age_band_basis: ageBandBasis,
  };
}

/** The signal an answer to the pending ask carries: the parked directive
 * (the person is completing what they asked for), a refusal of a
 * confirmation as that directive retracted. */
function protocolSignal(input: SignalInput, protocol: ProtocolAnswer): TurnSignal {
  const text = input.text;
  const emotion = clauseEmotion(text);
  // ASK-01's second round: the answer to "Who's Clover?" ("my cousin,
  // she teaches piano") is a statement about the household, an
  // inform, so the judge extracts from it (a directive-only turn is
  // skipped); the other kinds complete a parked directive as before.
  const act: TurnSignal["primary_act"] = protocol.kind === "who" && protocol.answer === "value" ? "inform" : "directive";
  return {
    primary_act: act,
    secondary_acts: [],
    expressed_emotion: emotion.emotion,
    emotion_intensity: emotion.intensity,
    target: act === "inform" ? "other" : "hub",
    repair: protocol.answer === "negative" ? "retraction" : "none",
    refers_to_prior: null,
    clauses: [{ range: { start: 0, end: text.length }, act, stance: "asserted", subject: act === "inform" ? { kind: "household" } : { kind: "world" }, emotion: emotion.emotion, emotion_intensity: emotion.intensity, confidence: 1 }],
    act_confidence: 1,
    emotion_confidence: emotion.confidence,
    source: "protocol",
    classifier_id: null,
    age_band: input.ageBand,
    age_band_basis: input.ageBandBasis ?? "identified_profile",
  };
}

/** The producer. Protocol state first, then the rules over every clause
 * of `utteranceShape()`'s own split; the fallback when the rules read
 * nothing they trust. Never throws: a classification error is the
 * fallback, logged by the caller. */
export function classifyTurnSignal(input: SignalInput): TurnSignal {
  const basis = input.ageBandBasis ?? "identified_profile";
  if (input.protocol) return protocolSignal(input, input.protocol);
  const text = input.text;
  if (text.trim().length === 0) return fallbackSignal(text, input.ageBand, basis);
  const reading = readClauses(text, openersFor(input));
  // A laugh token opening the turn ("ha, I'm basically a professional
  // chef now") marks the whole turn a joke.
  const turnJoke = /^\s*(?:ha+|haha+|hehe+|lol|lmao|jk)\b/i.test(reading.body);
  const emotionConfidences: number[] = [];
  const clauses: SignalClause[] = reading.clauses.map((clause, i) => {
    const { act, confidence } = clauseAct(clause, reading, i);
    const stance = clauseStance(clause.text, act, turnJoke);
    const subject = clauseSubject(clause.text, stance.stance, input);
    const emotion = clauseEmotion(clause.text);
    emotionConfidences.push(emotion.confidence);
    return {
      range: { start: clause.start, end: clause.end },
      act,
      stance: stance.stance,
      subject,
      emotion: emotion.emotion,
      emotion_intensity: emotion.intensity,
      confidence: Math.min(confidence, stance.confidence),
    };
  });
  // A literal-pattern win is a directive by construction: the clause the
  // router matched is the first one that is not a question.
  if (input.literalWin && !clauses.some((c) => c.act === "directive")) {
    const target = clauses.find((c) => c.act !== "question");
    if (target) {
      target.act = "directive";
      target.stance = "asserted";
      target.confidence = Math.max(target.confidence, 0.9);
    }
  }
  // A whole-turn question mark with a non-question first clause and a
  // tag folded in ("Rover keeps getting sick, any idea why?") is the
  // shape reading's own rule: the turn asks.
  const shapeSaysQuestion = shapeFromReading(reading) === "question";
  if (shapeSaysQuestion && !clauses.some((c) => c.act === "question")) {
    const last = clauses[clauses.length - 1]!;
    last.act = "question";
    last.stance = "asserted";
  }
  const acts = clauses.map((c) => c.act);
  const primary = primaryOf(acts);
  const primaryIndex = acts.indexOf(primary);
  const secondary = acts.filter((_, i) => i !== primaryIndex);
  // The strongest marked emotion across the clauses, the one the
  // composer reacts to; its clause names the target.
  let strongest = clauses[0]!;
  for (const c of clauses) if (EMOTION_RANK[c.emotion_intensity] > EMOTION_RANK[strongest.emotion_intensity]) strongest = c;
  const emotionClause = strongest.emotion === "neutral" ? (clauses.find((c) => c.emotion !== "neutral") ?? strongest) : strongest;
  // An interjection carries the feeling ("ugh, Rover chewed my
  // headphones"); the clause after it says whom it is about.
  const aboutClause = emotionClause.act === "backchannel" ? (clauses.find((c) => c.act !== "backchannel") ?? emotionClause) : emotionClause;
  const emotionText = text.slice(aboutClause.range.start, aboutClause.range.end);
  const actConfidence = Math.min(...clauses.map((c) => c.confidence));
  const emotionConfidence = emotionConfidences[clauses.indexOf(emotionClause)] ?? 0.5;
  return {
    primary_act: primary,
    secondary_acts: secondary,
    expressed_emotion: emotionClause.emotion,
    emotion_intensity: emotionClause.emotion_intensity,
    target: targetOf(emotionText, aboutClause.subject),
    repair: repairOf(text, primary),
    refers_to_prior: null,
    clauses,
    act_confidence: actConfidence,
    emotion_confidence: emotionConfidence,
    source: "rule",
    classifier_id: null,
    age_band: input.ageBand,
    age_band_basis: basis,
  };
}

/** The literal-pattern win applied after routing to a signal computed
 * before it: the routed clause becomes a directive, the rest stands. A
 * question stays a question ("what time is it" answered by a package's
 * own pattern asks; the package outcome rides on the turn either way),
 * so a turn made only of questions is left as read. */
export function freezeDirective(signal: TurnSignal): TurnSignal {
  if (signal.source === "protocol" || signal.clauses.some((c) => c.act === "directive")) return signal;
  const clauses = signal.clauses.map((c) => ({ ...c }));
  const target = clauses.find((c) => c.act !== "question");
  if (!target) return signal;
  target.act = "directive";
  target.stance = target.stance === "unknown" ? "asserted" : target.stance;
  target.confidence = Math.max(target.confidence, 0.9);
  const acts = clauses.map((c) => c.act);
  const primaryIndex = acts.indexOf("directive");
  return { ...signal, primary_act: "directive", secondary_acts: acts.filter((_, i) => i !== primaryIndex), clauses, act_confidence: Math.max(signal.act_confidence, 0.9), source: signal.source === "fallback" ? "rule" : signal.source };
}

/** The router's and the guards' reading, projected from the signal:
 * `command` for a directive, `question` for a question, `first_person`
 * for a statement the speaker opens in the first person, `statement`
 * otherwise. One classification, one projection. */
export function shapeOf(signal: TurnSignal, text: string): UtteranceShape {
  // A directive by construction (a declared opener, a courtesy prefix, a
  // literal-pattern win, a consumed ask: confidence 0.9 or more) is the
  // router's command; a proposal or a negative request the rules read
  // as a directive ("let's plan the trip", "don't forget to lock up":
  // 0.7) stays conversation-shaped for the router, which never widened
  // past declared openers (ROUTE-01's review), and is a directive for
  // the plan and the judge all the same.
  if (signal.primary_act === "directive") return signal.clauses.some((c) => c.act === "directive" && c.confidence >= COMMAND_CONFIDENCE) ? "command" : signal.clauses.some((c) => c.act === "question") ? "question" : "statement";
  if (signal.primary_act === "question") return "question";
  if (signal.clauses.some((c) => (c.act === "inform" || c.act === "commissive") && /^\s*(?:i|i'm|i've|i'd|i'll|we|we're|we've|we'd)\b/i.test(text.slice(c.range.start, c.range.end).replace(/^\s*(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please[,\s]+)/i, "")))) return "first_person";
  return "statement";
}

/** MEM-06's eligibility, the structural half ACT-01 lands: only an
 * inform or a commissive clause with stance asserted or reported can
 * yield a memory. A question asks, a directive acts, a greeting, a
 * closing or a backchannel says nothing about anyone, and a quoted,
 * hypothetical, joking or unknown clause writes nothing. */
export function isEligibleClause(clause: SignalClause): boolean {
  return (clause.act === "inform" || clause.act === "commissive") && (clause.stance === "asserted" || clause.stance === "reported");
}

export function hasEligibleClause(signal: TurnSignal): boolean {
  return signal.clauses.some(isEligibleClause);
}
