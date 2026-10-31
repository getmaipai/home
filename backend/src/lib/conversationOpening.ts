// NAT-07b (docs/design/warmth-over-time-2026-10-28.md): what a conversation may open with. A pure
// function over the person, the clock, the turn facts and the candidate memory rows; the reader that
// fetches the rows and the render sit below it. The model decides whether to say anything (rule 1):
// this file only decides what it may be told, and never reads a date out of the text of a record.
import { and, desc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, memoryRecords, openQuestions } from "@/db/schema";
import { markOpenQuestionAsked, queueOpenQuestion } from "@/lib/conversationHistory";

import { sanitizeForPrompt } from "@/lib/promptSanitize";
import { threadOfferFloor } from "@/lib/threadOfferFloor";

export type SinceLast = "same_day" | "few_days" | "few_weeks" | "months";
export type DayPart = "morning" | "afternoon" | "evening" | "night";

export interface OpeningThread {
  record_id: string;
  kind: "event" | "goal" | "project";
  subject: string;
  when: string;
}

export interface OpeningMood {
  record_id: string;
  state: string;
  valid_until: string | null;
}

export interface ConversationOpening {
  since_last: SinceLast;
  day_part: DayPart;
  thread?: OpeningThread;
  mood?: OpeningMood;
}

/** The speaker the opening is for. `pickUpThreads` is the resolved `chat.pick_up_threads` (teens default off). */
export interface OpeningPerson {
  id: string;
  band: "child" | "teen" | "adult";
  pickUpThreads: boolean;
}

/** The facts about this turn and the conversation, none of them read from the person's words. */
export interface OpeningTurns {
  /** This is the first turn of the conversation. */
  firstTurn: boolean;
  /** The typed turn signal's `no_task`. */
  noTask: boolean;
  /** When this person last spoke in any earlier conversation; null when there is none. */
  lastTurnAt: string | null;
  /** A shared or ambient surface, or the speaker is not confirmed as this person. */
  sharedOrUnidentified: boolean;
  /** A temporary (Incognito) conversation. */
  incognito: boolean;
}

/** One candidate memory row, as the reader fetches it. */
export interface OpeningRecord {
  id: string;
  scope: string;
  person: string | null;
  category: string;
  text: string;
  status: string;
  archivedReason: string | null;
  deletedAt: string | null;
  expiredAt: string | null;
  createdAt: string;
  validTo: string | null;
  supersededBy: string | null;
  sensitive: boolean;
  offerWithheld: boolean | null;
  /** The record's source turn was replaced by an edit (conversation_turns.supersedes). */
  sourceReplaced: boolean;
  /** A thread question about this record was already put (any status). */
  alreadyOffered: boolean;
}

/** How far back a thread reaches: an event that ended, or a goal or project set, in the last 14 days. */
export const THREAD_WINDOW_DAYS = 14;
/** A state is a mood worth opening on only this long. Deliberately shorter
 * than memory.ts's STATE_EXPIRY_DAYS (14 since MEM-AUDIT-04): a state may
 * stay recallable for two weeks when the message is about it, but an
 * opener that brings up a two-week-old mood unasked is the jacket reply
 * in another coat. */
export const MOOD_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
const MAX_SUBJECT_CHARS = 140;

export function dayPartAt(now: Date): DayPart {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

export function sinceLastAt(lastTurnAt: string, now: Date): SinceLast | null {
  const last = new Date(lastTurnAt);
  if (Number.isNaN(last.getTime()) || last.getTime() > now.getTime()) return null;
  const a = new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((b - a) / DAY_MS);
  if (days <= 0) return "same_day";
  if (days <= 6) return "few_days";
  if (days <= 59) return "few_weeks";
  return "months";
}

const ageMs = (iso: string | null, now: Date): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : now.getTime() - t;
};

function threadOf(record: OpeningRecord, person: OpeningPerson, now: Date): { thread: OpeningThread; at: number } | null {
  if (record.scope !== "person" || record.person !== person.id) return null;
  if (record.deletedAt !== null || record.supersededBy !== null || record.sourceReplaced || record.alreadyOffered) return null;
  if (!threadOfferFloor({ category: record.category, text: record.text, sensitive: record.sensitive, offerWithheld: record.offerWithheld === true }).offerable) return null;
  const kind = record.category as OpeningThread["kind"];
  const window = THREAD_WINDOW_DAYS * DAY_MS;
  if (kind === "event") {
    // Only an event whose own end date passed qualifies; person, decay, edit, forgotten and unset reasons never do.
    // MEM-AUDIT-04: an event keeps EVENT_GRACE_DAYS past its date before maintenance archives it as "event_passed"
    // (memory.ts), so the morning-after thread reads an active event whose own end date is behind us the same way.
    const endedAt = record.validTo ?? record.expiredAt;
    const archivedOnEnd = record.status === "archived" && (record.archivedReason === "end_date" || record.archivedReason === "event_passed");
    const activePastEnd = record.status === "active" && record.validTo !== null && (ageMs(record.validTo, now) ?? -1) >= 0;
    if (!archivedOnEnd && !activePastEnd) return null;
    // The window runs from the event's own end date; the archive time only stands in when no end date was kept.
    const age = ageMs(endedAt, now);
    if (age === null || age < 0 || age > window) return null;
    return { thread: { record_id: record.id, kind, subject: record.text, when: endedAt!.slice(0, 10) }, at: now.getTime() - age };
  }
  if (record.status !== "active") return null;
  const age = ageMs(record.createdAt, now);
  if (age === null || age < 0 || age > window) return null;
  return { thread: { record_id: record.id, kind, subject: record.text, when: record.createdAt.slice(0, 10) }, at: now.getTime() - age };
}

function moodOf(record: OpeningRecord, person: OpeningPerson, now: Date): { mood: OpeningMood; at: number } | null {
  if (record.scope !== "person" || record.person !== person.id || record.category !== "state") return null;
  if (record.status !== "active" || record.deletedAt !== null || record.supersededBy !== null || record.sourceReplaced) return null;
  // The floor's kind check is for threads; a mood needs its sensitive, withheld and adult-to-tell checks, so it asks as an event.
  if (!threadOfferFloor({ category: "event", text: record.text, sensitive: record.sensitive, offerWithheld: record.offerWithheld === true }).offerable) return null;
  const age = ageMs(record.createdAt, now);
  if (age === null || age < 0 || age > MOOD_WINDOW_DAYS * DAY_MS) return null;
  if (record.validTo !== null) {
    const until = record.validTo.length === 10 ? `${record.validTo}T23:59:59` : record.validTo;
    const end = new Date(until).getTime();
    if (Number.isNaN(end) || end < now.getTime()) return null;
  }
  return { mood: { record_id: record.id, state: record.text, valid_until: record.validTo }, at: now.getTime() - age };
}

/** The opening item for a conversation's first turn, or null. Gates, in order: Incognito neither reads nor offers;
 * a shared or ambient surface or an unidentified speaker gets nothing; only a first turn that carries no task opens
 * anything. A child never gets a thread or a mood, a teen only with their own switch on. */
export function conversationOpening(person: OpeningPerson, now: Date, turns: OpeningTurns, records: readonly OpeningRecord[]): ConversationOpening | null {
  if (turns.incognito || turns.sharedOrUnidentified) return null;
  if (!turns.firstTurn || !turns.noTask || turns.lastTurnAt === null) return null;
  const since = sinceLastAt(turns.lastTurnAt, now);
  if (since === null) return null;
  const opening: ConversationOpening = { since_last: since, day_part: dayPartAt(now) };
  if (person.band === "child" || !person.pickUpThreads) return opening;
  let best: { thread: OpeningThread; at: number } | null = null;
  let mood: { mood: OpeningMood; at: number } | null = null;
  for (const record of records) {
    const t = threadOf(record, person, now);
    if (t && (best === null || t.at > best.at)) best = t;
    const m = moodOf(record, person, now);
    if (m && (mood === null || m.at > mood.at)) mood = m;
  }
  if (best) opening.thread = best.thread;
  if (mood) opening.mood = mood.mood;
  return opening;
}

const GAP_WORDS: Record<SinceLast, string> = {
  same_day: "earlier today",
  few_days: "a few days ago",
  few_weeks: "a few weeks ago",
  months: "months ago",
};

const KIND_WORDS: Record<OpeningThread["kind"], string> = { event: "an event", goal: "a goal", project: "a project" };

/** The labelled block's text. The mood line is added only when the reply plan already requires the care move. */
export function renderConversationOpening(opening: ConversationOpening, options: { care: boolean }): string {
  const lines = [`It is ${opening.day_part}. You last talked with this person ${GAP_WORDS[opening.since_last]}.`];
  if (opening.thread) {
    const subject = sanitizeForPrompt(opening.thread.subject).slice(0, MAX_SUBJECT_CHARS);
    lines.push(`Last time they told you about ${KIND_WORDS[opening.thread.kind]} (${opening.thread.when}): ${subject}. You may ask how it went, once, lightly, in your own words, and only if it fits; do not repeat it if they move on.`);
  }
  if (opening.mood && options.care) {
    lines.push(`Last time they mentioned feeling: ${sanitizeForPrompt(opening.mood.state).slice(0, MAX_SUBJECT_CHARS)}. Do not bring it up unless they do.`);
  }
  return lines.join("\n");
}

type CandidateRow = typeof memoryRecords.$inferSelect;

/** The bounded read: this person's own event, goal, project and state rows from the last 14 days, newest first, at most 40:
 * a row archived in the window, a row created in the window, or an active event whose own end date lies in the window
 * (an event told about three weeks before it happened is still "last time they told you about an event" the morning
 * after; `threadOf` reads the same end date). Reads nothing in Incognito (the caller does not call it). */
export function readOpeningRecords(personId: string, now: Date): OpeningRecord[] {
  const cutoff = new Date(now.getTime() - THREAD_WINDOW_DAYS * DAY_MS).toISOString();
  // `valid_to` is a bare date or a timestamp; the date part of the cutoff compares with both as text.
  const dayCutoff = cutoff.slice(0, 10);
  const rows: CandidateRow[] = db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.scope, "person"),
        eq(memoryRecords.person, personId),
        isNull(memoryRecords.deletedAt),
        isNull(memoryRecords.supersededBy),
        inArray(memoryRecords.category, ["event", "goal", "project", "state"]),
        or(
          gte(memoryRecords.expiredAt, cutoff),
          and(eq(memoryRecords.status, "active"), gte(memoryRecords.createdAt, cutoff)),
          and(eq(memoryRecords.status, "active"), eq(memoryRecords.category, "event"), gte(memoryRecords.validTo, dayCutoff)),
        ),
      ),
    )
    .orderBy(desc(memoryRecords.createdAt))
    .limit(40)
    .all();
  if (rows.length === 0) return [];
  const offered = new Set(
    db
      .select({ subjectId: openQuestions.subjectId })
      .from(openQuestions)
      .where(and(eq(openQuestions.person, personId), eq(openQuestions.kind, "thread")))
      .all()
      .map((r) => r.subjectId),
  );
  const sources = [...new Set(rows.map((r) => r.source))];
  const replaced = new Set(
    sources.length === 0
      ? []
      : db
          .select({ supersedes: conversationTurns.supersedes })
          .from(conversationTurns)
          .where(inArray(conversationTurns.supersedes, sources))
          .all()
          .map((r) => r.supersedes),
  );
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    person: r.person,
    category: r.category,
    text: r.text,
    status: r.status,
    archivedReason: r.archivedReason ?? null,
    deletedAt: r.deletedAt ?? null,
    expiredAt: r.expiredAt ?? null,
    createdAt: r.createdAt,
    validTo: r.validTo ?? null,
    supersededBy: r.supersededBy ?? null,
    sensitive: r.sensitive,
    offerWithheld: r.offerWithheld ?? null,
    sourceReplaced: replaced.has(r.source),
    alreadyOffered: offered.has(r.id),
  }));
}

/** The person's last turn in any other conversation, or null. */
export function lastTurnBefore(personId: string, conversationId: string): string | null {
  const row = db
    .select({ createdAt: conversationTurns.createdAt })
    .from(conversationTurns)
    .where(and(eq(conversationTurns.personId, personId), or(isNull(conversationTurns.conversationId), ne(conversationTurns.conversationId, conversationId))))
    .orderBy(desc(conversationTurns.createdAt))
    .limit(1)
    .all()[0];
  return row?.createdAt ?? null;
}

/** Records that a thread was put in the prompt, so it is never offered again (any status counts as offered).
 * Counts and ids only: the row holds the record id and a fixed label, never the record's text (rule 6a). */
export function recordThreadOffer(personId: string, conversationId: string, recordId: string, turnId: string): void {
  const row = queueOpenQuestion({ person: personId, conversationId, kind: "thread", text: "pick-up thread offered", subjectId: recordId, source: turnId });
  markOpenQuestionAsked(row.id);
}
