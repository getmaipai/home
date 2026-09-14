// Lane 14 item 2 (docs/plans/session-b-lane-14-2026-09-14.md): EVAL-07's
// memory replay. The pure half: mapping a dataset session's own
// alternating turns into the rows the real turn store gets. Ingestion
// is the memory path, not the chat path (the design, fixed): the
// household member's own turn becomes the row's user text, and every
// turn immediately following it by someone else becomes the row's
// reply text, stored as-is, never generated. No file I/O, no engine,
// no database here - replay.ts calls logTurn() with what this produces.
import type { DatasetSession, DatasetTurn } from "./types";

export interface IngestRow {
  userText: string;
  replyText: string;
  /** The turnId of the household member's own turn, then every reply
   * turn's own id in order - the dataset's own references, kept so a
   * later recall check can compare against what was actually asked
   * about, never re-derived from an index. */
  turnIds: (string | null)[];
  /** True when the household member's own turn or any turn folded into
   * the reply carries the dataset's own evidence flag (LongMemEval's
   * has_answer, or a LoCoMo dia_id a question actually cited). */
  isEvidence: boolean;
}

/** Pairs a session's turns: `isHouseholdMember(turn)` marks whose lines
 * become the seeded person's own turns; every immediately following
 * turn by someone else, consecutively, joins into that row's own reply
 * text (joined by a blank line, the same way more than one assistant
 * line in a row reads as one reply). A household-member turn with
 * nothing following it (the session's last turn, or two of the
 * household member's own turns back to back) gets an empty reply text
 * - a row with something said and nothing answered, faithfully, never
 * invented to fill the gap. */
export function sessionToIngestRows(session: DatasetSession, isHouseholdMember: (turn: DatasetTurn) => boolean): IngestRow[] {
  const rows: IngestRow[] = [];
  const turns = session.turns;
  let i = 0;
  while (i < turns.length) {
    const turn = turns[i]!;
    if (!isHouseholdMember(turn)) {
      i++;
      continue;
    }
    const replyParts: string[] = [];
    const turnIds: (string | null)[] = [turn.turnId];
    let isEvidence = turn.isEvidence;
    let j = i + 1;
    while (j < turns.length && !isHouseholdMember(turns[j]!)) {
      const reply = turns[j]!;
      replyParts.push(reply.text);
      turnIds.push(reply.turnId);
      if (reply.isEvidence) isEvidence = true;
      j++;
    }
    rows.push({ userText: turn.text, replyText: replyParts.join("\n\n"), turnIds, isEvidence });
    i = j;
  }
  return rows;
}

/** LongMemEval's own convention: `role === "user"` is the household
 * member; every other role (the paper's "assistant") is the reply
 * side. Matches longmemeval.ts's own DatasetTurn.speaker, which keeps
 * the raw `role` string unchanged. */
export function isLongMemEvalHouseholdMember(turn: DatasetTurn): boolean {
  return turn.speaker === "user";
}

/** LoCoMo casts one of its own two named speakers as the household
 * member and the other's lines as reported speech in that person's own
 * turns (the coherence review's own rule, dev.md "Coherence review,
 * 2026-09-14", question 5) - the first speaker to appear in the
 * session, so the choice is the same for every session in one
 * conversation rather than picked per session. */
export function locomoHouseholdMemberSpeaker(sessions: readonly DatasetSession[]): string | null {
  for (const session of sessions) {
    const first = session.turns[0];
    if (first) return first.speaker;
  }
  return null;
}
