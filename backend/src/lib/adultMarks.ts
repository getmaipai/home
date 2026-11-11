// ADULT-LOCK-06 (docs/design/video-loras-2026-11-02.md 3.10, docs/dev/adult-lock.md): marking and unmarking an item's Adult lock, and the audit of it.
//
// Where the flags live: `made_audience` (the machine fact and the minor ceiling, never lowered) and `lock` (the clearable lock) are keys of the Library file's
// provenance note, written when the item is stored (`markFields`). That note is the one store the Library, the feed, search and every route already read
// through `lockItemOfProvenance` and `lockedFilterSql`, so this file changes it in place (the clip and its poster) and adds no second copy of the flag.
// `adult_mark_log` is the audit of every change: who, when, which item, how; no content.
//
// Who may do what:
//   clear (unmark)  the creator only, on their own written screen, with a fresh passcode ticket for this item (`/api/adult-lock/confirm`); a live unlock proof is
//                   not accepted in its place, and an admin cannot clear another person's item.
//   mark            the creator or an admin, no passcode; raises `made_audience` to adult-only if it was not, and turns the lock on. Never lowers anything.
import { and, desc, eq, like } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { adultMarkLog, attachments } from "@/db/schema";
import { isOwnerOrAdmin } from "@/lib/access";
import { speakerAgeBand } from "@/lib/ageBand";
import { LOCKED_WRITERS, consumeTicket, lockItemOfProvenance, withMark, type LockItem } from "@/lib/adultLock";
import { nextHlc } from "@/lib/hlc";
import { newAdultMarkLogId } from "@/lib/id";
import { libraryProvenance } from "@/lib/libraryProvenance";
import type { PersonRow } from "@/types";

export type MarkAction = "clear" | "mark";
export type MarkVia = "creator_passcode" | "creator" | "admin" | "auto";

export const SHARED_SCREEN_MARK_LINE = "Change this on your own screen. Open Home on your own phone or computer and try again.";
export const NEED_PASSCODE_LINE = "Enter your passcode again to remove the lock. It only works for the item you just chose.";
export const NOT_FOUND_LINE = "That item is not here.";
export const NOT_READY_LINE = "Wait until it is made, then try again.";
export const TEMPORARY_LINE = "A video made in a temporary chat is not saved, so it cannot be marked.";
export const NOT_MARKED_LINE = "This item is not locked.";
/** The plain words of an item's state, for the person who may see it (the item's menu). */
export const STATE_LINES = {
  locked: "Locked. It opens only with your passcode, and people under 18 never see it.",
  cleared: "Lock removed. It shows with its title and thumbnail in your feeds and lists. People under 18 never see it.",
} as const;

/** The audit write. `at` is when the change happened. */
export function logMark(input: { itemId: string; action: MarkAction; actorId: string; via: MarkVia }): void {
  db.insert(adultMarkLog).values({ id: newAdultMarkLogId(), itemId: input.itemId, action: input.action, actorId: input.actorId, via: input.via, at: new Date().toISOString(), hlc: nextHlc(), provenance: `person:${input.actorId}` }).run();
}

/** The creator's own rows for one item, newest first. Nobody else gets them (no admin page, Status page or log shows them). */
export function markHistory(actor: PersonRow, itemId: string, ownerPersonId: string): Array<{ action: MarkAction; via: MarkVia; at: string }> {
  if (actor.id !== ownerPersonId) return [];
  return db.select({ action: adultMarkLog.action, via: adultMarkLog.via, at: adultMarkLog.at }).from(adultMarkLog).where(eq(adultMarkLog.itemId, itemId)).orderBy(desc(adultMarkLog.at)).limit(20).all();
}

interface ItemRow { id: string; ownerPersonId: string; provenance: string; deletedAt: string | null }
function itemRow(fileId: string): ItemRow | null {
  const row = db.select({ id: attachments.id, ownerPersonId: attachments.ownerPersonId, provenance: attachments.provenance, deletedAt: attachments.deletedAt }).from(attachments).where(eq(attachments.id, fileId)).get();
  if (!row) return null;
  const writer = libraryProvenance(row.provenance).writer;
  return writer && LOCKED_WRITERS.includes(writer) && writer !== "video-poster" ? row : null;
}

/** What the item's menu needs to know about the item's state, for this person (null: nothing to show, a minor or an item the lock does not cover). */
export interface AdultStateView {
  made_audience: "all-ages" | "adult-only";
  lock: "on" | "off";
  can_clear: boolean;
  can_mark: boolean;
  /** The plain words of the state, only for an adult-only item. */
  line: string | null;
  history: Array<{ action: MarkAction; via: MarkVia; at: string }>;
}
export function adultStateOf(actor: PersonRow, fileId: string): AdultStateView | null {
  const row = itemRow(fileId);
  if (!row || row.ownerPersonId !== actor.id || speakerAgeBand(actor, new Date()) !== "adult") return null;
  const item = lockItemOfProvenance(row.ownerPersonId, row.provenance);
  if (!item || !item.madeAudience) return null;
  const adultOnly = item.madeAudience === "adult-only";
  return {
    made_audience: item.madeAudience,
    lock: adultOnly ? item.lock : "off",
    can_clear: adultOnly && item.lock === "on",
    can_mark: !adultOnly || item.lock === "off",
    line: adultOnly ? (item.lock === "on" ? STATE_LINES.locked : STATE_LINES.cleared) : null,
    history: adultOnly ? markHistory(actor, row.id, row.ownerPersonId) : [],
  };
}

export type SetLockResult = { ok: true; made_audience: "all-ages" | "adult-only"; lock: "on" | "off"; changed: boolean } | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/** Rewrite the lock keys of the clip and of its poster (and any continued frame of it: they carry the clip's job id). Raising never lowers the audience. */
function writeLock(row: ItemRow, lock: "on" | "off", raise: boolean): void {
  const meta = libraryProvenance(row.provenance);
  const jobId = typeof meta.job === "string" ? meta.job : null;
  const apply = (id: string, provenance: string) => { const next = withMark(provenance, { lock, raiseToAdult: raise }); if (next) db.update(attachments).set({ provenance: next }).where(eq(attachments.id, id)).run(); };
  apply(row.id, row.provenance);
  if (meta.writer === "picture-gen") {
    const descendants = db.select({ id: attachments.id, provenance: attachments.provenance }).from(attachments).where(and(eq(attachments.ownerPersonId, row.ownerPersonId), like(attachments.provenance, `image-edit:%"root":"${row.id}"%`))).all();
    for (const descendant of descendants) if (libraryProvenance(descendant.provenance).root === row.id) apply(descendant.id, descendant.provenance);
    return;
  }
  if (!jobId) return;
  // The clip's poster and any frame continued from it carry its job id in the note; job ids are plain id characters, so the LIKE needs no escaping.
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) return;
  const posters = db.select({ id: attachments.id, provenance: attachments.provenance }).from(attachments).where(and(eq(attachments.ownerPersonId, row.ownerPersonId), like(attachments.provenance, `video-poster:%"job":"${jobId}"%`))).all();
  for (const poster of posters) if (libraryProvenance(poster.provenance).job === jobId) apply(poster.id, poster.provenance);
}

/**
 * Clear or set the Adult lock of one stored picture or clip. `ticket` is the single-use fresh-passcode ticket (clear only), `ticketItem` the id it was issued for (the job
 * id the page named to `/api/adult-lock/confirm`), `sessionKey` the browser session of this request (null on a paired device or a bearer token).
 */
export function setItemLock(input: { actor: PersonRow; fileId: string; action: MarkAction; ticket?: string | null; ticketItem?: string; sessionKey: string | null }): SetLockResult {
  const { actor, action } = input;
  const row = itemRow(input.fileId);
  if (!row || row.deletedAt !== null) return { ok: false, status: 404, error: NOT_FOUND_LINE };
  const owner = row.ownerPersonId === actor.id;
  const item: LockItem | null = lockItemOfProvenance(row.ownerPersonId, row.provenance);
  if (!item) return { ok: false, status: 404, error: NOT_FOUND_LINE };
  const adultActor = speakerAgeBand(actor, new Date()) === "adult";
  if (action === "clear") {
    // Only the creator. Anyone else gets the answer a missing item gets (an admin cannot see another person's item, so it is not theirs to unmark).
    if (!owner) return { ok: false, status: 404, error: NOT_FOUND_LINE };
    if (!adultActor || !input.sessionKey) return { ok: false, status: 403, error: SHARED_SCREEN_MARK_LINE };
    if (item.madeAudience !== "adult-only") return { ok: false, status: 409, error: NOT_MARKED_LINE };
    if (item.lock === "off") return { ok: true, made_audience: "adult-only", lock: "off", changed: false };
    // Last check, so a ticket is spent only by a request that could succeed: a fresh passcode, for this item, once.
    if (!consumeTicket(input.ticket, actor.id, input.sessionKey, input.ticketItem ?? row.id)) return { ok: false, status: 403, error: NEED_PASSCODE_LINE };
    // One transaction: the clip, its poster and the audit row change together or not at all.
    sqlite.transaction(() => { writeLock(row, "off", false); logMark({ itemId: row.id, action: "clear", actorId: actor.id, via: "creator_passcode" }); })();
    return { ok: true, made_audience: "adult-only", lock: "off", changed: true };
  }
  if (!owner && !isOwnerOrAdmin(actor)) return { ok: false, status: 404, error: NOT_FOUND_LINE };
  if (!adultActor) return { ok: false, status: owner ? 403 : 404, error: owner ? SHARED_SCREEN_MARK_LINE : NOT_FOUND_LINE };
  if (item.madeAudience === "adult-only" && item.lock === "on") return { ok: true, made_audience: "adult-only", lock: "on", changed: false };
  sqlite.transaction(() => { writeLock(row, "on", true); logMark({ itemId: row.id, action: "mark", actorId: actor.id, via: owner ? "creator" : "admin" }); })();
  return { ok: true, made_audience: "adult-only", lock: "on", changed: true };
}

/** The audit row of an item stored with its lock already on (an adult-only style or source, or the finished-clip check's verdict): who made it, by the pipeline. */
export function logAutoMark(itemId: string, ownerPersonId: string): void {
  logMark({ itemId, action: "mark", actorId: ownerPersonId, via: "auto" });
}

/** Test and diagnostics seam: the raw rows of one item (never served by a route). */
export function __markRowsForTests(itemId: string): Array<{ action: string; via: string; actorId: string }> {
  return sqlite.query("SELECT action, via, actor_id AS actorId FROM adult_mark_log WHERE item_id = ? ORDER BY at").all(itemId) as Array<{ action: string; via: string; actorId: string }>;
}
