// CONS-01 (docs/dev.md section 16 part 9, rule 2): deterministic reply
// constraints, kept in the forget-command parser's family. Length asks use
// six characters per word as the schema's character-budget conversion.
import { and, eq, gte, not } from "drizzle-orm";
import { db } from "@/db";
import { replyConstraints, conversationTurns } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";

export type ReplyConstraintRow = typeof replyConstraints.$inferSelect;
type ReplyConstraintKind = "banned_phrase" | "shape" | "length";

const QUOTED_BAN = /\b(?:stop saying|don't say|do not say|no more|quit saying|stop with the|never say)\s+["'“”‘’]([^"'“”‘’]+)["'“”‘’](?:\s+again)?/i;
const TRAILING_BAN = /^\s*(?:please\s+)?(?:stop saying|don't say|do not say|no more|quit saying|stop with the|never say)\s+(.+?)\s*$/i;
const SHAPE_LIST = /\b(?:as a list|as bullets|bulleted list|bullet points|in a list|list them|list it)\b/i;
const SHAPE_NUMBER = /\b(?:just the number|just the numbers|the number only|numbers only)\b/i;
const SHAPE_LINE = /\b(?:one line|in one line|one liner|short answer|in a sentence|one sentence)\b/i;
const LENGTH_WORDS = /\b(?:keep it under|under|max)\s+(\d+)\s+words\b|\b(\d+)\s+words or less\b|\bno more than\s+(\d+)\s+words\b/i;

function cleanPhrase(value: string): string {
  return value.replace(/[.!?,;:]+$/g, "").replace(/\s+(?:again|please|to me|anymore|all the time)$/i, "").trim().toLowerCase();
}

export function parseReplyConstraint(text: string, lastReplies: readonly string[]): { kind: ReplyConstraintKind; value: string } | null {
  const quoted = QUOTED_BAN.exec(text);
  const trailing = TRAILING_BAN.exec(text);
  if (quoted || trailing) {
    const phrase = cleanPhrase((quoted?.[1] ?? trailing?.[1] ?? "").replace(/^["'“”‘’]|["'“”‘’]$/g, ""));
    if (phrase && lastReplies.some((reply) => reply.toLowerCase().includes(phrase))) return { kind: "banned_phrase", value: phrase };
  }
  if (SHAPE_LIST.test(text)) return { kind: "shape", value: "list" };
  if (SHAPE_NUMBER.test(text)) return { kind: "shape", value: "number" };
  if (SHAPE_LINE.test(text)) return { kind: "shape", value: "one_line" };
  const length = LENGTH_WORDS.exec(text);
  if (length) return { kind: "length", value: String(Number(length[1] ?? length[2] ?? length[3]) * 6) };
  if (/\b(?:keep it short|shorter|briefer)\b/i.test(text)) return { kind: "length", value: "120" };
  return null;
}

function newReplyConstraintId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 10; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `rc-${suffix}`;
}

export function setReplyConstraint(input: { conversationId: string; person: string | null; kind: ReplyConstraintKind; value: string; setByTurn: string | null }): ReplyConstraintRow {
  const existing = db.select().from(replyConstraints).where(and(eq(replyConstraints.conversationId, input.conversationId), eq(replyConstraints.kind, input.kind), eq(replyConstraints.value, input.value))).get();
  if (existing) return existing;
  const row: ReplyConstraintRow = { id: newReplyConstraintId(), conversationId: input.conversationId, person: input.person, kind: input.kind, value: input.value, setAt: new Date().toISOString(), setByTurn: input.setByTurn, hlc: nextHlc() };
  db.insert(replyConstraints).values(row).run();
  return row;
}

// U4/RESP-01, ARCH-AMEND-01's accepted design ("reply constraints decay
// by turn count"): a length or shape ask holds for the turn that set it
// and the next three done turns of that conversation, never longer - a
// banned phrase never decays. Optional and backward compatible: with no
// `currentTurnId` this returns every row exactly as before, which is
// what the frozen path's one call site (turnEngine.ts, no decay) keeps
// getting.
const LENGTH_SHAPE_TURN_WINDOW = 3;

/** Counts every OTHER done turn since the setting turn - the setting
 * turn's own row and the turn being evaluated right now are both
 * excluded by id, never by a timestamp comparison alone: the setting
 * turn's own `createdAt` is written at the end of its request, a few
 * lines after `setAt` is captured, so a strict "after setAt" test can
 * count the setting turn against its own window (caught writing the
 * test for this, not live). The current turn (not yet logged at
 * production's own read point, but already logged in a fixture that
 * inserts it first) is turn number `count + 1` after the setting one,
 * so the window holds while `count + 1 <= 3`, i.e. `count < 3`.
 *
 * Caller contract (a code review, 2026-09-22): `currentTurnId` must be
 * the conversation's own newest turn - there is no upper bound on the
 * count besides excluding that one id, so a caller evaluating an OLDER
 * turn out of order (a replay tool, a backfill, two turns raced) would
 * count every later turn too and expire the constraint early. No
 * caller does this today (turnNext.ts always evaluates the turn it is
 * currently producing), so this is a documented invariant, not a
 * defensive check against a reachable case. */
function stillWithinWindow(row: ReplyConstraintRow, currentTurnId: string): boolean {
  if (row.kind === "banned_phrase" || row.setByTurn === null) return true;
  const doneTurnsAfter = db
    .select({ id: conversationTurns.id })
    .from(conversationTurns)
    .where(and(eq(conversationTurns.conversationId, row.conversationId), eq(conversationTurns.status, "done"), gte(conversationTurns.createdAt, row.setAt), not(eq(conversationTurns.id, currentTurnId)), not(eq(conversationTurns.id, row.setByTurn))))
    .all();
  return doneTurnsAfter.length < LENGTH_SHAPE_TURN_WINDOW;
}

export function constraintsFor(conversationId: string, currentTurnId?: string): ReplyConstraintRow[] {
  const rows = db.select().from(replyConstraints).where(eq(replyConstraints.conversationId, conversationId)).all();
  if (currentTurnId === undefined) return rows;
  return rows.filter((row) => stillWithinWindow(row, currentTurnId));
}

export function bannedPhrasesFor(conversationId: string): string[] {
  return constraintsFor(conversationId).filter((row) => row.kind === "banned_phrase").map((row) => row.value);
}

export function clearReplyConstraints(conversationId: string): void {
  db.delete(replyConstraints).where(eq(replyConstraints.conversationId, conversationId)).run();
}
