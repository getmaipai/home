// CONS-01 (docs/dev.md section 16 part 9, rule 2): deterministic reply
// constraints, kept in the forget-command parser's family. Length asks use
// six characters per word as the schema's character-budget conversion.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { replyConstraints } from "@/db/schema";
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

export function constraintsFor(conversationId: string): ReplyConstraintRow[] {
  return db.select().from(replyConstraints).where(eq(replyConstraints.conversationId, conversationId)).all();
}

export function bannedPhrasesFor(conversationId: string): string[] {
  return constraintsFor(conversationId).filter((row) => row.kind === "banned_phrase").map((row) => row.value);
}

export function clearReplyConstraints(conversationId: string): void {
  db.delete(replyConstraints).where(eq(replyConstraints.conversationId, conversationId)).run();
}
