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
 * person; a turn with no signal at all is a statement. */
export function utteranceShape(text: string, commandOpeners: ReadonlySet<string> = NO_OPENERS): UtteranceShape {
  const unaddressed = text.replace(VOCATIVE_PREFIX, (whole: string, afterHey: string | undefined, bare: string | undefined) => {
    const word = (afterHey ?? bare ?? "").toLowerCase();
    if (!COURTESY_WORDS.test(word) && !commandOpeners.has(word)) return "";
    return whole.slice(whole.toLowerCase().indexOf(word)); // "hey remember ..." keeps its verb, loses the "hey"
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
  return "statement";
}

/** True when the utterance is a question or a first-person statement:
 * the shapes that fall to the conversational path (with the always-offer
 * set alone) rather than to a model's guess at a package. */
export function conversationShaped(text: string, commandOpeners?: ReadonlySet<string>): boolean {
  return utteranceShape(text, commandOpeners) !== "command";
}
