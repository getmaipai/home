// MEM-AUDIT-01 (docs/design/memory-audit-and-redesign-2026-10-31.md,
// decision 1): the profile card. A deterministic list of the speaker's
// own standing facts, read straight from the store on every turn, in
// place of the weekly LLM-written profile paragraph (PROFILE_SOURCE
// rows in memory.ts, now archived by the consolidation pass).
//
// Why a card and not a paragraph: the live hub answered "Starting to
// get cold out" with "you and your daughter better wear jackets"
// because the paragraph named the child and the owner's "this week"
// state, and it was injected into the stable prefix on every turn
// with no relevance check. Small local models cannot ignore an
// in-topic distractor (TARG, arXiv 2511.09803; Shi et al., arXiv
// 2302.00093), so what is injected matters more than any wording
// beside it. The card holds only what is true of the person on every
// turn: who they are (`identity`), how they want the assistant to
// behave (`instruction`) and the preferences they pinned themselves.
// A relationship, state, event, project, goal, person, place, thing or
// plain fact never enters it; those reach the prompt only through
// recall, gated by the cosine floor, when the message is about them.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { memoryRecords } from "@/db/schema";
import { PROFILE_SOURCE, validAt } from "@/lib/memory";
import { detectCredential } from "@/lib/memoryContentPolicy";
import { sanitizeForPrompt } from "@/lib/promptSanitize";
import type { MemoryRecordRow } from "@/types";

/** At most this many fact lines on the card. */
export const PROFILE_CARD_MAX_LINES = 8;
/** The fact lines together (dated, newline-joined) never exceed this
 * many characters; the lowest-importance lines are dropped to fit. The
 * rule line is fixed text and is not counted. */
export const PROFILE_CARD_MAX_CHARS = 400;

export interface ProfileCardLine {
  /** The memory record's id (the trace names it: MEM-AUDIT-05). */
  id: string;
  text: string;
  /** The record's created_at, rendered as its date. */
  at: string;
  disclosure: "child_ok" | "teen_ok" | "adult_only";
}

export interface ProfileCard {
  /** The one usage rule that precedes the fact lines. */
  ruleLine: string;
  /** Most important first, then newest; empty when the person has no
   * standing fact (the card is then not rendered at all). */
  lines: ProfileCardLine[];
}

/** The rule line: the model is told what the lines are and that they
 * are background, never a topic. Measured on frontier models only
 * (PersistBench, arXiv 2602.01146), which is why the card is also kept
 * small: the selection does the work, the line only names it. */
export function profileCardRuleLine(displayName: string): string {
  return `Background about ${sanitizeForPrompt(displayName)}. Use it only when it changes your answer; never mention or allude to it otherwise.`;
}

/** Whether a record's category may stand on the card at all. `instruction`
 * is decision 2's new category (how the assistant should behave for this
 * person); the column is free text, so it is matched here whether or not
 * the pinned spec enum names it yet. A preference stands only when the
 * person pinned it. */
export function isProfileCardCategory(category: string, pinned: boolean): boolean {
  if (category === "identity") return true;
  if (category === "instruction") return true;
  if (category === "preference") return pinned;
  return false;
}

export function renderProfileCardLine(line: Pick<ProfileCardLine, "text" | "at">): string {
  return `(${line.at.slice(0, 10)}) ${line.text}`;
}

/** The card as the prompt shows it: the rule line, then one dated line
 * per fact. Exported for the tests and the bench; nodes/context.ts
 * pushes the same pieces as context items so messages.ts renders them
 * in the stable prefix. */
export function renderProfileCard(card: ProfileCard): string {
  return [card.ruleLine, ...card.lines.map(renderProfileCardLine)].join("\n");
}

function cardCandidate(row: MemoryRecordRow, now: Date, withholdSensitive: boolean): boolean {
  if (row.recordKind !== "memory") return false;
  // A legacy profile paragraph (the weekly rewrite this card replaces)
  // is never a card member: the consolidation pass archives those rows,
  // and until it runs they must not come back through this door.
  if (row.source === PROFILE_SOURCE) return false;
  if (!isProfileCardCategory(row.category, row.pinned)) return false;
  // A robot-scoped record belongs to one device's surface, not to the
  // person on every surface; the card is the person's standing
  // background wherever they speak.
  if (row.deviceId !== null) return false;
  if (withholdSensitive && row.sensitive) return false;
  if (!validAt(row, now)) return false;
  // CHAT-03, the read side: a credential stored before the policy
  // existed is withheld, not deleted.
  if (detectCredential(row.text).detected) return false;
  return true;
}

/** The speaker's profile card as of `now`: active, durable, person-scope
 * records of their own in the card categories, most important first,
 * then newest, cut to PROFILE_CARD_MAX_LINES and PROFILE_CARD_MAX_CHARS.
 * Deterministic: the same store gives the same card, so a trace that
 * names the line ids (MEM-AUDIT-05) can be re-read later. */
export function buildProfileCard(person: { id: string; displayName: string }, now: Date = new Date(), opts: { withholdSensitive?: boolean } = {}): ProfileCard {
  const rows = db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.status, "active"),
        eq(memoryRecords.scope, "person"),
        eq(memoryRecords.person, person.id),
        eq(memoryRecords.tier, "durable"),
        isNull(memoryRecords.deletedAt),
      ),
    )
    .all()
    .filter((row) => cardCandidate(row, now, opts.withholdSensitive === true));
  rows.sort((a, b) => b.importance - a.importance || (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines: ProfileCardLine[] = rows.slice(0, PROFILE_CARD_MAX_LINES).map((row) => ({ id: row.id, text: row.text, at: row.createdAt, disclosure: row.childDisclosure as ProfileCardLine["disclosure"] }));
  // Drop from the end (the least important, then the oldest) until the
  // rendered fact lines fit the character budget.
  while (lines.length > 0 && lines.map(renderProfileCardLine).join("\n").length > PROFILE_CARD_MAX_CHARS) lines.pop();
  return { ruleLine: profileCardRuleLine(person.displayName), lines };
}
