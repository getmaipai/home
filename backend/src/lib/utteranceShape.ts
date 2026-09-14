// ROUTE-01's shape guard, in its own pure module (CHAT-04): routing.ts
// re-exports it for the router and the trace, and guards.ts reads it to
// tell a restated question (a non-answer) from a restated statement (an
// acknowledgment) without a second classifier. No engine, no database.

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
export const COURTESY_PREFIX = /^\s*(?:hey\s+\w+[,\s]+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please[,\s]+)/i;
const QUESTION_OPENER =
  /^\s*(?:who|whose|what|whats|when|where|which|why|how|is|are|was|were|am|do|does|did|can|could|should|would|will|shall|have|has|had|any|anything|anyone)\b/i;
const TRAILING_QUESTION_MARK = /\?\s*$/;
const FIRST_PERSON_OPENER = /^\s*(?:i|i'm|i've|i'd|i'll|we|we're|we've|we'd)\b/i;

/** ROUTE-02: `statement` is a turn with no signal at all (a greeting,
 * "thanks", "okay", a bare fact), conversation-shaped: it rides the
 * ordinary tool set like a question does. */
export type UtteranceShape = "question" | "first_person" | "command" | "statement";

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
// those ("good morning", "thanks", "keep that on file") is a statement,
// conversation (ROUTE-02: it rides the stable ordinary tool set, which
// holds the packages the household actually uses, `remember` by
// default).
// Two vocative forms: "hey maipai" with or without a comma (speech
// transcripts carry none), and a bare "Sage," with one. The word
// itself is never stripped when it is a courtesy word or a command
// opener ("Remember, I have a dentist appointment", "Please, set a
// timer"): that word is the signal, not a name (a code review).
const VOCATIVE_PREFIX = /^\s*(?:(?:hey|hi|hello|ok|okay)\s+([a-z]+)[,\s]+|([a-z]+),\s*)/i;
// ACT-01: a bare "word," in front is a vocative only when the word is a
// name, never an interjection or an acknowledgment ("ugh, Rover chewed
// my headphones", "no, Friday, not Thursday", "thanks, that's all"):
// those words are the turn signal's own evidence (an emotion, a
// correction, a close) and stay a clause of their own.
const INTERJECTIONS = /^(?:ok|okay|k|no|nope|nah|yes|yeah|yep|yup|ugh|wow|whoa|oh|ah|hmm|hm|well|so|thanks|thank|hey|hi|hello|great|cool|nice|right|sure|alright|fine|ha|haha|lol|oops|yay|ew|eww|damn|man|dude|gosh|god|jeez|honestly|seriously|anyway|also|actually|wait|look|listen|sorry|yikes|phew|meh|hmph|huh|aw|aww|omg|whew|ooh|argh|grr)$/i;
// A comma inside a quotation, or right after a speech verb ("Quill
// said, 'I hate seltzer'"), is punctuation, never a clause break.
const SPEECH_VERB_BEFORE_CUT = /\b(?:said|says|say|saying|tells?|told|goes|went|like|asked|asks|replied|replies|wrote|texted)\s*$/i;
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

export type ClauseSignal = UtteranceShape | "none";

// ACT-01: a clause may open with a conjunction ("and why is a sunset
// red", "but what's on the list") that the opener is read past; and an
// exclamative "what a long day" is not a question, whatever its opener.
const LEADING_CONJUNCTION = /^\s*(?:and|but|so|also|then|or)\s+/i;
const EXCLAMATIVE_RE = /^\s*what\s+an?\s+\w+|^\s*how\s+\w+\s*!/i;

function clauseSignal(clause: string, commandOpeners: ReadonlySet<string>): { signal: ClauseSignal; polite: boolean } {
  const unjoined = clause.replace(LEADING_CONJUNCTION, "");
  const bare = unjoined.replace(COURTESY_PREFIX, "");
  const polite = bare !== unjoined;
  if (QUESTION_OPENER.test(bare) && !(EXCLAMATIVE_RE.test(bare) && !/\?\s*$/.test(bare))) return { signal: "question", polite };
  if (polite) return { signal: "command", polite };
  if (FIRST_PERSON_OPENER.test(bare)) return { signal: "first_person", polite };
  const first = bare.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, "") ?? "";
  if (commandOpeners.has(first)) return { signal: "command", polite };
  return { signal: "none", polite };
}

/** ACT-01: one clause of the utterance, with its range in the original
 * text (the same split `utteranceShape()` makes, so the turn signal's
 * clause ranges and the router's reading come from one cut). `signal`
 * is the clause's own shape reading; `polite` says a courtesy prefix
 * was stripped before it. */
export interface UtteranceClause {
  text: string;
  start: number;
  end: number;
  signal: ClauseSignal;
  polite: boolean;
}

export interface ClauseReading {
  clauses: UtteranceClause[];
  /** The body after the vocative and a leading "please," were taken off. */
  body: string;
  leadingPlease: boolean;
  trailingQuestionMark: boolean;
}

/** The clause split with ranges into the original utterance: the
 * vocative and a leading "please," are skipped (their offsets kept), the
 * body is cut on " and " and on a comma, and a fragment under two words
 * folds into the clause before it (a tag, not a clause) unless it is a
 * one-word command. A turn with no cut is one clause. */
export function readClauses(text: string, commandOpeners: ReadonlySet<string> = NO_OPENERS): ClauseReading {
  let offset = 0;
  const vocative = VOCATIVE_PREFIX.exec(text);
  if (vocative && !(vocative[2] !== undefined && INTERJECTIONS.test(vocative[2]))) {
    const word = (vocative[1] ?? vocative[2] ?? "").toLowerCase();
    // "hey remember ..." keeps its verb, loses the "hey"
    offset = !COURTESY_WORDS.test(word) && !commandOpeners.has(word) ? vocative[0].length : vocative[0].toLowerCase().indexOf(word);
  }
  const unaddressed = text.slice(offset);
  // A leading "please," is a courtesy on the whole turn: a command
  // unless what follows opens as a question ("please, what time is it").
  const please = LEADING_PLEASE.exec(unaddressed);
  const leadingPlease = please !== null;
  if (please) offset += please[0].length;
  const body = text.slice(offset);
  const cuts: { start: number; end: number }[] = [];
  let last = 0;
  for (const m of body.matchAll(new RegExp(CLAUSE_BREAK.source, "gi"))) {
    if (m[0].length === 0) continue;
    const before = body.slice(0, m.index);
    const quotesOpen = (before.match(/["“”]/g) ?? []).length % 2 === 1;
    if (quotesOpen || SPEECH_VERB_BEFORE_CUT.test(before)) continue;
    // "Marsh and I are training": an "and" after a single word joins a
    // compound subject, never two clauses.
    const sincePrevious = body.slice(last, m.index).trim();
    if (/^and\b/i.test(m[0].trim()) && sincePrevious.split(/\s+/).length === 1) continue;
    cuts.push({ start: last, end: m.index });
    last = m.index + m[0].length;
  }
  cuts.push({ start: last, end: body.length });
  const clauses: UtteranceClause[] = [];
  for (const cut of cuts) {
    const piece = body.slice(cut.start, cut.end);
    const trimmedStart = cut.start + (piece.length - piece.trimStart().length);
    const trimmedEnd = cut.end - (piece.length - piece.trimEnd().length);
    const clause = body.slice(trimmedStart, trimmedEnd);
    const words = clause.split(/\s+/).filter(Boolean);
    const word = (words[0] ?? "").toLowerCase().replace(/[^a-z']/g, "");
    const standsAlone = words.length >= MIN_CLAUSE_WORDS || COURTESY_WORDS.test(word) || commandOpeners.has(word); // "Remember, ..." is a one-word command clause
    const previous = clauses[clauses.length - 1];
    if (!standsAlone && previous && trimmedEnd > trimmedStart) {
      // A tag ("right?") rides on the clause before it, so the ranges
      // still cover the whole body and the tag's question mark counts.
      previous.end = offset + trimmedEnd;
      previous.text = text.slice(previous.start, previous.end);
      continue;
    }
    if (trimmedEnd <= trimmedStart) continue;
    const read = clauseSignal(clause, commandOpeners);
    clauses.push({ text: clause, start: offset + trimmedStart, end: offset + trimmedEnd, ...read });
  }
  if (clauses.length === 0) {
    const read = clauseSignal(body, commandOpeners);
    clauses.push({ text: body, start: offset, end: text.length, ...read });
  }
  return { clauses, body, leadingPlease, trailingQuestionMark: TRAILING_QUESTION_MARK.test(body) };
}

/** The shape the guard reads, named for the `[route]` trace line. Per
 * clause: after a courtesy prefix only the opener counts (a polite
 * request keeps its question mark and is still a command). A trailing
 * question mark makes the turn a question unless a clause was a polite
 * request. Any command clause makes the turn a command; otherwise any
 * question clause a question; otherwise any first-person clause first
 * person; a turn with no signal at all is a statement. */
export function utteranceShape(text: string, commandOpeners: ReadonlySet<string> = NO_OPENERS): UtteranceShape {
  return shapeFromReading(readClauses(text, commandOpeners));
}

export function shapeFromReading(reading: ClauseReading): UtteranceShape {
  const signals = new Set(reading.clauses.map((c) => c.signal));
  if (reading.trailingQuestionMark && !reading.clauses.some((c) => c.polite) && !reading.leadingPlease) signals.add("question");
  if (reading.leadingPlease && reading.clauses[0]?.signal !== "question") signals.add("command");
  if (signals.has("command")) return "command";
  if (signals.has("question")) return "question";
  if (signals.has("first_person")) return "first_person";
  return "statement";
}

/** True when the utterance is a question or a first-person statement:
 * the shapes that fall to the conversational path (with the always-offer
 * set alone) rather than to a model's guess at a package. */
export function conversationShaped(text: string, commandOpeners?: ReadonlySet<string>): boolean {
  return utteranceShape(text, commandOpeners) !== "command";
}
