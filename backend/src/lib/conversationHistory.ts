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
// that don't exist), an audit of who viewed what, and a synced
// spec-shaped record for robot parity (needs the link, 7.3, and `bot` to
// exist as real content) are all out of scope, most documented at the
// point they matter below. Not a spec 3.1 record type today: chapter 3's
// own record table has no Conversation entry, the same "hub-internal,
// revisit for robot parity later" call lib/scheduler.ts's Job made.
//
// 90-day summarization instead of a hard delete (2026-09-04) is real
// now: runRetention() best-effort summarizes each person's about-to-
// expire turns into one real `record_kind: "episode"` memory record
// (3.1's shape has always had this kind; nothing had ever created one
// until now) via the `chat` role, before deleting the raw turns. Never
// gates the actual deletion on it succeeding - a household's retention
// promise ("gone after N days") is the hard guarantee; a summary is a
// best-effort upgrade on top of it, not a precondition. See
// summarizeBeforeDelete()'s own comment for exactly what that means
// when no real model is running yet.
import { eq, or, and, not, lt, isNull } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { newConversationTurnId } from "@/lib/id";
import { canAccessPerson } from "@/lib/access";
import { isMinorRole } from "@/lib/safety";
import { getHouseholdSettingValue } from "@/lib/settings";
import { complete } from "@/lib/llm";
import { getEngineStatus } from "@/lib/llmSupervisor";
import { remember } from "@/lib/memory";
import type { Role } from "@/middleware/auth";
import type { TurnValue, Surface } from "@/lib/turnEngine";
import type { PersonRow } from "@/types";

// Defined in @/wire (alias-free, typeof conversationTurns.$inferSelect
// via a relative import) so a frontend client can import the real row
// shape through the @maipai/home-backend workspace dependency; re-exported
// here since this is where callers already look for it.
import type { ConversationTurnRow } from "@/wire";
export type { ConversationTurnRow } from "@/wire";

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
    pluginId: value.plugin_id ?? null,
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

const MAX_SUMMARY_INPUT_CHARS = 8_000;

/** Turns a batch of one person's about-to-expire turns into one real
 * `record_kind: "episode"` memory record (household 3.1's shape already
 * had this kind; nothing had ever created one before this). Best effort,
 * on purpose: skipped entirely (returns without writing anything, and
 * without throwing) whenever there's no REAL model to ask - storing the
 * stub's own canned "[stub model: no real model loaded]" text as a
 * permanent memory record would be worse than no summary at all. Checked
 * both BEFORE calling complete() (a cheap bulk skip once a process
 * already knows it's on the stub, the common case on every retention
 * tick after the first) and AFTER each call (the only way to know for a
 * process's very first completion ever, since getChatClient() resolves
 * lazily - `getEngineStatus()` only reports "none" beforehand, and
 * complete() itself is what decides real-vs-stub). A real model that's
 * merely slow, or a completion that fails for any other reason, is
 * treated the same way: logged, not thrown, since runRetention()'s own
 * deletion must never wait on or be blocked by this. The most recent
 * `MAX_SUMMARY_INPUT_CHARS` of transcript (not the oldest) is what gets
 * summarized when a person's batch is large - recency is more useful to
 * a future reader than completeness, and this keeps the prompt well
 * inside even a modest context window. */
// Exported for a real test (a real completion round trip against a real
// stub-shaped server, not a mock of complete()) - the same "prove the
// real mechanism, not a simulation of it" standard this session's other
// supervisor tests already hold to. runRetention() calls this the same
// way, fire-and-forget.
export async function summarizeBeforeDelete(rows: ConversationTurnRow[]): Promise<void> {
  const byPerson = new Map<string, ConversationTurnRow[]>();
  for (const row of rows) {
    if (!byPerson.has(row.personId)) byPerson.set(row.personId, []);
    byPerson.get(row.personId)!.push(row);
  }
  if (byPerson.size === 0) return;
  if (getEngineStatus().kind === "stub") return;

  for (const [personId, personRows] of byPerson) {
    // isNull(deletedAt), not a bare id match: a code review (2026-09-04)
    // found the original version still found a SOFT-deleted person (the
    // household removed them since these turns were written) and wrote
    // them a brand-new episode memory anyway - the same pattern
    // scheduler.ts's own core-job person lookup already guards against
    // for the identical reason.
    const person = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).get();
    if (!person) continue; // deleted since these turns were written; nothing to attribute a summary to

    personRows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let transcript = personRows.map((r) => `User: ${r.userText}\nReply: ${r.replyText}`).join("\n\n");
    if (transcript.length > MAX_SUMMARY_INPUT_CHARS) {
      transcript = transcript.slice(transcript.length - MAX_SUMMARY_INPUT_CHARS);
    }

    try {
      const result = await complete("chat", [
        {
          role: "user",
          content:
            "Summarize the key facts, requests, and events from this conversation history in 2-4 sentences, " +
            "for future reference. Do not quote exact wording, just the substance.\n\n" +
            transcript,
        },
      ]);
      if (!result.ok) {
        console.log(`[conversationHistory] retention summary skipped for ${personId}: ${result.error}`);
        continue;
      }
      if (getEngineStatus().kind === "stub") {
        // Resolved to the stub for the first time just now (this
        // process's very first completion ever) - a canned reply is
        // worse than no summary; skip the rest of this batch too.
        return;
      }
      const written = remember(person, {
        record_kind: "episode",
        text: result.value.text,
        category: "event",
        tier: "durable",
        scope: "person",
        person: personId,
        source: "conversation-retention-summary",
        importance: 0.3,
      });
      if (!written.ok) {
        console.log(`[conversationHistory] retention summary for ${personId} failed to save: ${written.error}`);
      }
    } catch (err) {
      console.log(`[conversationHistory] retention summary failed for ${personId}: ${(err as Error).message}`);
    }
  }
}

/** Best-effort summarizes (see summarizeBeforeDelete()), then hard-
 * deletes, turns past the household's retention window (4.6's
 * `household.conversation_retention_days`, default 90). A safety-flagged
 * turn from a minor speaker is never deleted before it's at least
 * `SAFETY_FLAGGED_MINOR_FLOOR_DAYS` old, regardless of how short the
 * household sets retention: the floor only ever *extends* the effective
 * window (a household that sets retention longer than the floor is
 * unaffected; the general rule already keeps those turns longer). The
 * summary step never gates or delays the delete: retention's "gone
 * after N days" is the hard privacy guarantee this function exists to
 * keep, a summary is a best-effort upgrade on top of it, never a
 * precondition - so the delete always proceeds this same tick whether
 * or not summarization succeeded, and callers don't need to await the
 * summarization to get an accurate `deleted` count back. Wired as a
 * real daily core job (lib/scheduler.ts), not a manual-only trigger:
 * unlike memory.ts's runMaintenance() when it first shipped, the
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

  // Read what's about to be deleted BEFORE deleting it, so there's real
  // text left to summarize - the exact same two cohorts the DELETE
  // statements below select, combined. Fired without awaiting: see
  // runRetention()'s own doc comment for why the delete must never wait
  // on this.
  const isFlaggedMinor = and(eq(conversationTurns.safetyFlagged, true), eq(conversationTurns.minorSpeaker, true));
  const expiring = db
    .select()
    .from(conversationTurns)
    .where(
      or(
        and(not(isFlaggedMinor!), lt(conversationTurns.createdAt, generalCutoff))!,
        and(isFlaggedMinor!, lt(conversationTurns.createdAt, flaggedMinorCutoff))!,
      ),
    )
    .all();
  void summarizeBeforeDelete(expiring).catch((err: Error) =>
    console.log(`[conversationHistory] retention summarization batch failed: ${err.message}`),
  );

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

export interface RoutingStats {
  total: number;
  plugin: number;
  pluginError: number;
  model: number;
  safetyRefuse: number;
  /** model / (plugin + pluginError + model) - the exact number 4.5's own
   * plan names as the decision input ("count fall-throughs... and decide
   * on tier 2 from the eval number"). `safety_refuse` never reaches
   * routing at all (prepareTurn() checks safety before the deterministic
   * floor even runs), so it's excluded from both sides of this ratio -
   * counting it would understate the real fall-through rate against
   * everything routing actually had a chance to match. Null with zero
   * routable turns, never a division by zero silently reading as 0%. */
  fallthroughRate: number | null;
  /** Which plugins are actually firing, most first - the plan's own "add
   * a row before it is fixed" eval-set idea needs to know not just THAT
   * routing falls through, but which utterances it should have matched
   * and didn't; this is the "did match" half of that picture. */
  byPlugin: { pluginId: string; count: number }[];
}

/** Household-wide, not per-person (unlike list()/exportPerson() above):
 * aggregate counts carry no turn text and no per-person breakdown, the
 * same "a systems metric, not personal history" posture engine status
 * and hardware detection already take - gated by the route's own
 * requireRole("owner", "admin"), not an actor param here, matching
 * lib/hardware.ts's detectHardware() precedent for the identical shape. */
export function routingStats(): RoutingStats {
  const rows = db.select({ source: conversationTurns.source, pluginId: conversationTurns.pluginId }).from(conversationTurns).all();

  let plugin = 0;
  let pluginError = 0;
  let model = 0;
  let safetyRefuse = 0;
  const pluginCounts = new Map<string, number>();

  for (const row of rows) {
    switch (row.source) {
      case "plugin":
        plugin++;
        if (row.pluginId) pluginCounts.set(row.pluginId, (pluginCounts.get(row.pluginId) ?? 0) + 1);
        break;
      case "plugin_error":
        pluginError++;
        break;
      case "model":
        model++;
        break;
      case "safety_refuse":
        safetyRefuse++;
        break;
    }
  }

  const routable = plugin + pluginError + model;
  const byPlugin = [...pluginCounts.entries()]
    .map(([pluginId, count]) => ({ pluginId, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total: rows.length,
    plugin,
    pluginError,
    model,
    safetyRefuse,
    fallthroughRate: routable > 0 ? model / routable : null,
    byPlugin,
  };
}
