// Item 4b (docs/plans/baseline-fixes-2026-09-13.md): telling the hub to
// forget is honored or refused, never "Got it." with the record kept.
// The 47-conversation bench saw "forget what I told you about Marlow's
// birthday" get "Got it." while the record stayed active and the next
// conversation said June. "Forget that", "forget what I (just) told
// you (about X)" and "don't remember that" are a command the turn
// engine answers itself, before routing and before the model, the way
// a credential in chat is (CHAT-03).
//
// What "that" means (the 4b review's two high findings): the judge
// drains on a five-second idle window, so the turn a person is
// pointing at is usually still unjudged. "Forget that" therefore always
// means the previous turn of this conversation, never "the latest
// remembered record": if that turn's records exist they are tombstoned
// (forgetByIds() applies the same tombstone the Memory page does) and
// its episodes deleted; if the turn is unjudged it is marked skipped so
// the judge never extracts it, and its episodes deleted; if it was
// judged and kept nothing, the reply says so.
//
// With a topic ("about Marlow's birthday") the scope is what this
// person told the hub in any conversation, not only this one (the
// second review's finding 7: the bench's own scenario ends with "the
// next conversation said June", and a miss reply there was the same
// privacy lie in other words). Every record carrying all the topic's
// content words goes, plus the partial matches from the most recent
// turn that wrote one, and in the same command every unjudged turn
// that mentions the topic is marked
// skipped (finding 1: otherwise the judge writes the topic back seconds
// after "Forgotten"). A tombstoned record's own source turn, when the
// judge left it unjudged after a partial write, is skipped too (finding
// 2). A model reply that claims to have forgotten with no such outcome
// meets the guards' "forget" family (guards.ts) instead.
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { conversationTurns, memoryRecords } from "@/db/schema";
import { forgetByIds } from "@/lib/memory";
import { deleteEpisodesForTurns } from "@/lib/episodes";
import { nextHlc } from "@/lib/hlc";
import { tokenize } from "@/lib/text";
import type { PersonRow } from "@/types";

/** The `command_id` the forget turn carries on its row: the request's
 * own wording names the topic, so the episode store (episodes.ts) keeps
 * no episode of it (finding 11), and the judge never reads a command
 * turn. */
export const FORGET_COMMAND_ID = "forget";

const LEAD = String.raw`^\s*(?:(?:please|actually|ok(?:ay)?|oh|hey|no|wait)[,\s]+)*(?:(?:can|could|would|will) you\s+)?(?:please\s+)?`;
// "Forget" and "don't remember" are memory verbs. "Delete", "erase" and
// "scratch" are not on their own: "delete that" after "add milk" is the
// list package's, "erase my drawing" is a canvas, "scratch that" is
// "never mind" (the third review's finding 4). They count only with
// "what you know about", which names a memory by its shape.
const VERB = String.raw`(?:forget|don'?t remember|do not remember)`;
// "It" is not a demonstrative here: bare "forget it" is "never mind"
// (finding 5); "don't remember it" still is a command.
const THAT = String.raw`(?:that|this|what i (?:just )?(?:told|said(?: to)?) you|what i (?:just )?said|the last thing(?: i (?:said|told you))?|that last (?:bit|thing|part))`;
const WHEN = String.raw`(?:\s+(?:earlier|before|just now|a (?:minute|moment|second) ago))?`;
// A courtesy after the object ("forget that, thanks") is still the
// command (finding 5: it fell through to the model, whose "Got it." no
// guard catches).
const TAIL = String.raw`(?:[,\s]*(?:please|thanks|thank you|cheers))?\s*[.!]?\s*$`;
// A possessive that is a name or a noun, never a contraction: "forget
// what's for dinner" is not "forget what" (finding 6).
const POSSESSIVE = String.raw`(?!(?:it|that|this|what|let|there|here|he|she|who|how|where|when|one)'s\b)[a-z]+'s`;

// "forget that", "forget what I told you about X", "don't remember it":
// the demonstrative forms, with an optional "about X" topic.
const FORGET_THAT_RE = new RegExp(`${LEAD}(?:${VERB}\\s+${THAT}|(?:don'?t|do not) remember\\s+it)${WHEN}(?:\\s+about\\s+(.+?))?${TAIL}`, "i");
// "forget Marlow's birthday", "forget my dentist appointment", "forget
// what you know about the recital": an object that is a memory by its
// own shape (a possessive, or "what you know about"). A bare object
// ("forget the dishes") is not a memory command: it is how people say
// "never mind the dishes", and treating it as one would erase a record
// on an ordinary sentence.
const FORGET_OBJECT_RE = new RegExp(
  `${LEAD}(?:(?:forget|erase|delete)\\s+(what you (?:know|have) about\\s+.+?)|forget\\s+(?:about\\s+)?((?:my|our)\\s+.+?|${POSSESSIVE}\\s+.+?))${TAIL}`,
  "i",
);
// iOS keyboards write a curly apostrophe (finding 6: "forget Marlow’s
// birthday" missed both patterns); nothing upstream normalizes it.
const CURLY_APOSTROPHE_RE = /[\u2018\u2019]/g;

/** The forget command's topic when the utterance is one: `null` for
 * "forget that", a string for "forget what I told you about X". */
export function parseForgetCommand(text: string): { topic: string | null } | null {
  const plain = text.replace(CURLY_APOSTROPHE_RE, "'");
  const that = FORGET_THAT_RE.exec(plain);
  if (that) return { topic: that[1]?.trim() || null };
  const object = FORGET_OBJECT_RE.exec(plain);
  if (object) return { topic: (object[1] ?? object[2])!.replace(/^what you (?:know|have) about\s+/i, "").trim() };
  return null;
}

export interface ForgetOutcome {
  reply: string;
  /** Records tombstoned, by text. */
  forgotten: string[];
  /** Turns whose extraction was skipped because nothing was kept yet. */
  skippedTurnIds: string[];
}

const NOTHING_TO_FORGET = "There's nothing to forget yet.";
const NOTHING_KEPT = "I hadn't kept anything from that yet, and I won't.";
const NOTHING_WAS_KEPT = "Nothing was kept from that.";
const NOT_YOURS = "I can't forget that one; it isn't yours to clear.";
const NOT_YOURS_REST = "The rest isn't yours to clear, so it stays.";

/** Content words of a topic or a record, possessives folded ("marlow's"
 * and "marlow" are the same word), so "about Marlow's birthday" finds
 * "Marlow's birthday is in June" and "Marlow was born in June" alike.
 * tokenize() drops stopwords and single letters; a two-letter name
 * ("Bo's birthday") is a word like any other (the third review's
 * finding 1: dropping it made the topic "birthday", every birthday). */
function contentWords(text: string): string[] {
  return [...tokenize(text)].map((w) => w.replace(/'s$|'$/, "")).filter((w) => w.length >= 2);
}

type TurnRow = { id: string; userText: string; judgeStatus: string | null; source: string };
type RecordRow = { id: string; text: string; source: string };

function activeRecordsOf(turnIds: string[]): RecordRow[] {
  if (turnIds.length === 0) return [];
  return db
    .select({ id: memoryRecords.id, text: memoryRecords.text, source: memoryRecords.source })
    .from(memoryRecords)
    .where(and(inArray(memoryRecords.source, turnIds), eq(memoryRecords.status, "active"), isNull(memoryRecords.deletedAt)))
    .all();
}

/** Marks unjudged turns skipped (a status the judge never overwrites;
 * memoryJudge.ts re-reads it before each write), deletes their
 * episodes, and tombstones any record the judge wrote to one of them in
 * the window between its own skip check and its write (finding 4).
 * Returns the texts of anything that sweep tombstoned, and whether it
 * had to leave one in place. */
function skipTurns(actor: PersonRow, turnIds: string[]): { swept: string[]; refused: boolean } {
  if (turnIds.length === 0) return { swept: [], refused: false };
  for (const id of turnIds) {
    sqlite.query("UPDATE conversation_turns SET judge_status = 'skipped', hlc = ? WHERE id = ? AND judge_status IS NULL").run(nextHlc(), id);
  }
  deleteEpisodesForTurns(turnIds);
  const raced = activeRecordsOf(turnIds);
  if (raced.length === 0) return { swept: [], refused: false };
  const outcomes = forgetByIds(actor, raced.map((r) => r.id));
  return { swept: raced.filter((r) => outcomes.find((o) => o.id === r.id)?.deleted).map((r) => r.text), refused: outcomes.some((o) => !o.deleted) };
}

function saidForgotten(texts: string[], refused: boolean): string {
  const said = `Forgotten: ${texts.map((t) => t.replace(/[.!]+$/, "")).join("; ")}.`;
  // A record the person may not clear (an entity or a pinned one, for a
  // non-admin) is named in the reply, never silently kept (finding 10).
  return refused ? `${said} ${NOT_YOURS_REST}` : said;
}

type Tombstoned = { forgotten: string[]; skippedTurnIds: string[]; refused: boolean };

/** Tombstones `records`, deletes the episodes of the turns that wrote
 * them, and skips any of those turns the judge left unjudged (finding
 * 2: its idle early-return leaves status null after a partial write, so
 * the next tick would write the fact again). `null` when nothing could
 * be tombstoned. */
function tombstone(actor: PersonRow, records: RecordRow[], turns: TurnRow[]): Tombstoned | null {
  const outcomes = forgetByIds(actor, records.map((r) => r.id));
  const forgotten = records.filter((r) => outcomes.find((o) => o.id === r.id)?.deleted);
  if (forgotten.length === 0) return null;
  // Episodes go only once a record really went (the first review's
  // finding 7: a refusal must leave the transcript's episodes alone).
  const sources = [...new Set(forgotten.map((r) => r.source))];
  deleteEpisodesForTurns(sources);
  const unjudged = turns.filter((t) => sources.includes(t.id) && t.judgeStatus === null && t.source === "model").map((t) => t.id);
  const { swept, refused } = skipTurns(actor, unjudged);
  return { forgotten: [...forgotten.map((r) => r.text), ...swept], skippedTurnIds: unjudged, refused: refused || outcomes.some((o) => !o.deleted) };
}

/** Runs the forget: "forget that" against this conversation's previous
 * turn, a topic against everything this person has told the hub. */
export function forgetFromConversation(actor: PersonRow, conversationId: string, topic: string | null, currentTurnId: string): ForgetOutcome {
  const topicWords = topic ? contentWords(topic) : [];
  // A topic made only of stopwords ("about it") is "forget that".
  if (topicWords.length === 0) return forgetPrevious(actor, conversationId, currentTurnId);
  return forgetTopic(actor, topic!, topicWords, currentTurnId);
}

const turnColumns = { id: conversationTurns.id, userText: conversationTurns.userText, judgeStatus: conversationTurns.judgeStatus, source: conversationTurns.source };

function forgetPrevious(actor: PersonRow, conversationId: string, currentTurnId: string): ForgetOutcome {
  const previous: TurnRow | undefined = db
    .select(turnColumns)
    .from(conversationTurns)
    .where(and(eq(conversationTurns.conversationId, conversationId), eq(conversationTurns.personId, actor.id), ne(conversationTurns.id, currentTurnId)))
    .orderBy(desc(conversationTurns.createdAt))
    .limit(1)
    .get();
  if (!previous) return { reply: NOTHING_TO_FORGET, forgotten: [], skippedTurnIds: [] };
  const kept = activeRecordsOf([previous.id]);
  if (kept.length > 0) {
    const done = tombstone(actor, kept, [previous]);
    if (!done) return { reply: NOT_YOURS, forgotten: [], skippedTurnIds: [] };
    return { reply: saidForgotten(done.forgotten, done.refused), forgotten: done.forgotten, skippedTurnIds: done.skippedTurnIds };
  }
  if (previous.judgeStatus === null && previous.source === "model") {
    const { swept, refused } = skipTurns(actor, [previous.id]);
    return { reply: swept.length > 0 ? saidForgotten(swept, refused) : refused ? NOT_YOURS : NOTHING_KEPT, forgotten: swept, skippedTurnIds: [previous.id] };
  }
  return { reply: NOTHING_WAS_KEPT, forgotten: [], skippedTurnIds: [] };
}

function forgetTopic(actor: PersonRow, topic: string, topicWords: string[], currentTurnId: string): ForgetOutcome {
  const wordsOf = (text: string) => new Set(contentWords(text));
  const full = (text: string) => {
    const words = wordsOf(text);
    return topicWords.every((w) => words.has(w));
  };
  const partial = (text: string) => {
    const words = wordsOf(text);
    return topicWords.some((w) => words.has(w));
  };
  // Every active record written from one of this person's own turns, in
  // any conversation, newest turn first. Records from elsewhere (the
  // Memory page, a profile) are not "what I told you".
  const told = db
    .select({ id: memoryRecords.id, text: memoryRecords.text, source: memoryRecords.source, judgeStatus: conversationTurns.judgeStatus, turnSource: conversationTurns.source })
    .from(memoryRecords)
    .innerJoin(conversationTurns, eq(memoryRecords.source, conversationTurns.id))
    .where(and(eq(conversationTurns.personId, actor.id), ne(conversationTurns.id, currentTurnId), eq(memoryRecords.status, "active"), isNull(memoryRecords.deletedAt)))
    .orderBy(desc(conversationTurns.createdAt))
    .all();
  // Every record carrying all of the topic's words is about the topic
  // and goes, whichever conversation said it (the live bench had the
  // same birthday kept twice, from a polite "can you remember" days
  // earlier and a plain "remember", and forgetting only the newest
  // left June for the next question). Only when no record carries them
  // all do the partial matches count, and then only from the newest
  // turn that wrote one ("Marlow loves the park" for "Marlow's
  // birthday" never goes beside a real birthday record: the third
  // review's finding 2).
  const chosen = ((): typeof told => {
    const whole = told.filter((r) => full(r.text));
    if (whole.length > 0) return whole;
    const some = told.filter((r) => partial(r.text));
    return some.filter((r) => r.source === some[0]?.source);
  })();
  // The person's unjudged turns about the topic, by the same rule (the
  // judge would otherwise write the topic back after "Forgotten",
  // finding 1; an unrelated turn sharing one word is not skipped,
  // finding 3).
  const unjudged: TurnRow[] = db
    .select(turnColumns)
    .from(conversationTurns)
    .where(and(eq(conversationTurns.personId, actor.id), eq(conversationTurns.source, "model"), isNull(conversationTurns.judgeStatus), ne(conversationTurns.id, currentTurnId)))
    .orderBy(desc(conversationTurns.createdAt))
    .all();
  const pending = ((): TurnRow[] => {
    const whole = unjudged.filter((t) => full(t.userText));
    if (whole.length > 0) return whole;
    const newest = unjudged.find((t) => partial(t.userText));
    return newest ? [newest] : [];
  })();

  let done: Tombstoned | null = null;
  let refusedAll = false;
  if (chosen.length > 0) {
    const turns: TurnRow[] = chosen.map((r) => ({ id: r.source, userText: "", judgeStatus: r.judgeStatus, source: r.turnSource }));
    done = tombstone(actor, chosen, turns);
    // A refusal is said at the end; the skips and the transcript still
    // happen (finding 8: a child's own unjudged turn about the dog was
    // judged seconds after "it isn't yours to clear").
    refusedAll = done === null;
  }
  const pendingIds = pending.map((t) => t.id).filter((id) => !done?.skippedTurnIds.includes(id));
  const { swept, refused: sweepRefused } = skipTurns(actor, pendingIds);
  // The transcript too: an earlier exchange about the topic ("when is
  // Marlow's birthday" / "It's in June") wrote no record, but its
  // episodes would let the next question recall the answer anyway (the
  // live bench: "2 days ago, you asked me to remember that Marlow's
  // birthday is in June"). Every turn whose own words (the person's,
  // never only the reply's) carry all the topic's words loses its
  // episodes, both sides.
  const about = db
    .select({ id: conversationTurns.id, userText: conversationTurns.userText })
    .from(conversationTurns)
    .where(and(eq(conversationTurns.personId, actor.id), ne(conversationTurns.id, currentTurnId)))
    .all()
    .filter((t) => full(t.userText))
    .map((t) => t.id);
  deleteEpisodesForTurns(about);
  const forgotten = [...(done?.forgotten ?? []), ...swept];
  const refused = (done?.refused ?? false) || sweepRefused || refusedAll;
  if (forgotten.length > 0) {
    return { reply: saidForgotten(forgotten, refused), forgotten, skippedTurnIds: [...(done?.skippedTurnIds ?? []), ...pendingIds] };
  }
  if (refused) return { reply: NOT_YOURS, forgotten: [], skippedTurnIds: pendingIds };
  if (pendingIds.length > 0) {
    return { reply: `I hadn't kept anything about ${topic} yet, and I won't.`, forgotten: [], skippedTurnIds: pendingIds };
  }
  return { reply: `I don't have anything kept about ${topic} from what you've told me. The Memory page shows everything I keep.`, forgotten: [], skippedTurnIds: [] };
}
