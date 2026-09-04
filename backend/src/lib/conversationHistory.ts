// Conversation history (platform plan 4.14, split): "conversations are
// per person and per surface... retention defaults: conversations ninety
// days then summarised... each is a household setting with a floor for
// kid safety logs." This is the store: every real turnEngine.runTurn()
// path (safety refusals included) writes one row, kept per person,
// visible per the exact rule memory.ts and settings.ts already share
// (lib/access.ts's canAccessPerson, whose own comment names this file's
// rule as the reason it was extracted, before this file existed).
//
// Full 4.14 is bigger than this: household search across content types
// (needs the shell palette, chapter 6, and content types like notes/media
// that don't exist), 90-day summarization instead of a hard delete (needs
// an LLM, 4.11's other roles), an audit of who viewed what, and a synced
// spec-shaped record for robot parity (needs the link, 7.3, and `bot` to
// exist as real content) are all out of scope, most documented at the
// point they matter below. Not a spec 3.1 record type today: chapter 3's
// own record table has no Conversation entry, the same "hub-internal,
// revisit for robot parity later" call lib/scheduler.ts's Job made.
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { conversationTurns } from "@/db/schema";
import { newConversationTurnId } from "@/lib/id";
import { canAccessPerson } from "@/lib/access";
import { isMinorRole } from "@/lib/safety";
import { getHouseholdSettingValue } from "@/lib/settings";
import type { Role } from "@/middleware/auth";
import type { TurnValue, Surface } from "@/lib/turnEngine";
import type { PersonRow } from "@/types";

export type ConversationTurnRow = typeof conversationTurns.$inferSelect;

export type ConversationOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 403; error: string };

/** Writes one row for a completed turn, any source, refusals included: a
 * parent reviewing a child's history should be able to see that a request
 * was made and refused, the same oversight motive `notify_parent` serves.
 * Called once per real runTurn() call; never for a TurnOpResult that
 * failed before producing a reply (unsupported_surface, invalid_input,
 * the model being unavailable) since nothing was actually said. */
export function logTurn(actor: PersonRow, surface: Surface, userText: string, value: TurnValue): ConversationTurnRow {
  // Built and returned directly from the caller's own values, not
  // re-selected after the insert: a review (2026-09-04) pointed out every
  // field is already known here, the same "don't round-trip the database
  // to read back what you just validated and wrote" precedent
  // lib/memory.ts's remember() already set. This runs once per completed
  // turn, the app's hottest path.
  const row: ConversationTurnRow = {
    id: newConversationTurnId(),
    personId: actor.id,
    surface,
    userText,
    replyText: value.reply.text,
    source: value.source,
    skillId: value.skill_id ?? null,
    safetyFlagged: value.safety.flagged,
    safetyAction: value.safety.action,
    minorSpeaker: isMinorRole(actor.role as Role),
    createdAt: value.safety.checked_at,
  };
  db.insert(conversationTurns).values(row).run();
  return row;
}

const LIST_CAP = 200;

/** A person's own turns, or (owner/admin only) a child's: the exact same
 * visibility rule memory.ts and settings.ts already apply. Nothing of a
 * teen's or an adult's is visible to anyone but themself: 4.14 asks for "a
 * summary and safety flags for a teen's," but there's no summarization
 * mechanism to safely implement that yet, the identical judgment call
 * memory.ts's scope:person visibility already made and documented (and
 * canAccessPerson's own comment already named as this file's rule),
 * applied here for the same reason. An actor with no access gets an empty
 * list, not an error: matches how a caller would ask "show me this
 * person's conversations" and simply see nothing, not be told why. */
export function list(actor: PersonRow, personId?: string): ConversationTurnRow[] {
  const target = personId ?? actor.id;
  if (!canAccessPerson(actor, target)) return [];
  const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, target)).all();
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows.slice(0, LIST_CAP);
}

/** The full per-person archive (4.14: "export per person is one
 * archive"), no cap, same visibility rule as list(). Unlike list()'s
 * silent empty-list-on-denial (browsing), export is a privileged,
 * single-target action, the same distinction memory.ts's list() vs
 * exportPerson() already draws: a real 403, matching memory's
 * exportPerson() precedent, not a result indistinguishable from "this
 * person just has no history yet." */
export function exportPerson(actor: PersonRow, personId: string): ConversationOpResult<ConversationTurnRow[]> {
  if (!canAccessPerson(actor, personId)) {
    return { ok: false, status: 403, error: "cannot export another person's conversation history" };
  }
  const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, personId)).all();
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { ok: true, value: rows };
}

const DEFAULT_RETENTION_DAYS = 90;
// 4.14: "a household setting with a floor for kid safety logs." No exact
// number is given in the plan; 90 days is this pass's own judgment call,
// matching the retention default itself so a household that never touches
// the setting sees no floor effect at all (the floor only ever binds when
// someone shortens retention below it).
const SAFETY_FLAGGED_MINOR_FLOOR_DAYS = 90;
const DAY_MS = 86_400_000;

/** Hard-deletes turns past the household's retention window (4.6's
 * `household.conversation_retention_days`, default 90). A safety-flagged
 * turn from a minor speaker is never deleted before it's at least
 * `SAFETY_FLAGGED_MINOR_FLOOR_DAYS` old, regardless of how short the
 * household sets retention: the floor only ever *extends* the effective
 * window (a household that sets retention longer than the floor is
 * unaffected; the general rule already keeps those turns longer). No
 * summarize-then-purge: 4.14 describes turning old conversations into a
 * summary rather than deleting them outright, but that needs an LLM
 * (4.11's other roles) that doesn't exist, so this is a real hard delete,
 * stricter than the plan's design but the privacy-safer default (nothing
 * kept indefinitely past its stated window) until summarization lands.
 * Wired as a real daily core job (lib/scheduler.ts), not a manual-only
 * trigger: unlike memory.ts's runMaintenance() when it first shipped, the
 * scheduler (4.7) already exists by the time this was built. */
export function runRetention(): { deleted: number } {
  const retentionDays = getHouseholdSettingValue("household.conversation_retention_days") as number | undefined;
  const days = typeof retentionDays === "number" && retentionDays > 0 ? retentionDays : DEFAULT_RETENTION_DAYS;
  const now = Date.now();
  const generalCutoff = new Date(now - days * DAY_MS).toISOString();
  // The effective cutoff for a flagged-minor row is whichever of the two
  // dates is *older* (requires more age before deletion is allowed): if
  // the household's own retention is already longer than the floor, the
  // general cutoff alone is already stricter and the floor never binds.
  const floorCutoff = new Date(now - SAFETY_FLAGGED_MINOR_FLOOR_DAYS * DAY_MS).toISOString();
  const flaggedMinorCutoff = generalCutoff < floorCutoff ? generalCutoff : floorCutoff;

  // Raw sqlite for a real affected-row count, not db.delete().run(): the
  // same escape hatch lib/memory.ts's forget() uses (Drizzle's bun-sqlite
  // .run() types its result void even though it returns {changes} at
  // runtime). Two statements, not one with an OR, so each cutoff date
  // only ever applies to the rows it's meant for.
  const normal = sqlite
    .query("DELETE FROM conversation_turns WHERE NOT (safety_flagged = 1 AND minor_speaker = 1) AND created_at < ?")
    .run(generalCutoff);
  const flaggedMinor = sqlite
    .query("DELETE FROM conversation_turns WHERE safety_flagged = 1 AND minor_speaker = 1 AND created_at < ?")
    .run(flaggedMinorCutoff);

  return { deleted: normal.changes + flaggedMinor.changes };
}
