// STACK-LORAS-01 slice 4: what an owner or admin may change on a style, now done AT THE STACK. Each function re-checks the admin (a route is not the only gate),
// sends one change to `/stack/v1/loras`, writes the audit row Home keeps (`adult_mark_log`, no content), then reads the library again so the answer is what the
// Stack now says. Home stores nothing about the style: the named adults of `availability.people` go to Home's small `lora_people` table (E5), and nothing else.
// Replaces lib/loras/admin.ts for every new flow (that file goes in slice 6).
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { isOwnerOrAdmin } from "@/lib/access";
import { issueTicket, lockItemOfProvenance, peekTicket } from "@/lib/adultLock";
import { logMark, setItemLock } from "@/lib/adultMarks";
import { isAdult } from "@/lib/loras/access";
import { getLoraRecord, callStack, LorasStackError, refreshLoras, setLoraPeople, type Lora } from "@/lib/loras/stackLibrary";
import { clipsUsingStyle } from "@/lib/loras/usage";
import type { PersonRow } from "@/types";

export const NOT_ADMIN_LINE = "Only an owner or admin can change styles.";
export const NOT_HERE_LINE = "That style isn't in the library.";
export const MINOR_IN_PEOPLE_LINE = "Only adults can be chosen. Pick adults, or choose all adults.";
export const NOT_EDITABLE_LINE = "The model a style is made for is read from its file and can't be changed here.";
export const TRASH_DAYS = 30;

const stackRefusal = (status: number, code: string, message: string) => new LorasStackError(status, code, message);

function must(admin: PersonRow): void {
  if (!isOwnerOrAdmin(admin)) throw stackRefusal(403, "not_admin", NOT_ADMIN_LINE);
}
function present(id: string): Lora {
  const lora = getLoraRecord(id);
  if (!lora) throw stackRefusal(404, "unknown_lora", NOT_HERE_LINE);
  return lora;
}
/** The people ids that are not adults (a minor, or nobody by that id). */
function notAdults(ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  const rows = db.select().from(people).where(inArray(people.id, [...ids])).all() as PersonRow[];
  const adults = new Set(rows.filter(isAdult).map((p) => p.id));
  return ids.filter((id) => !adults.has(id));
}
const patchStack = async (id: string, body: Record<string, unknown>): Promise<void> => { await callStack("PATCH", `/stack/v1/loras/${encodeURIComponent(id)}`, body); };
async function after(id: string): Promise<Lora> {
  await refreshLoras(true);
  return getLoraRecord(id) ?? present(id);
}

export interface LoraPatch {
  name?: string; description?: string; kind?: Lora["kind"];
  availability?: { who: "admins" | "adults" | "people"; people?: string[] };
  strength?: { default?: number; min?: number; max?: number };
  trigger_words?: string[]; source_url?: string | null;
  /** Home-only fields: the Stack keeps them in the record's `home` part (`home_patch`). `base_model` is the Stack's own fact and is not editable from here. */
  allow_suggesting?: boolean; trigger_position?: "start" | "end"; positive_addins?: string[]; negative_addins?: string[]; avoid_as_positive?: string[]; base_model?: Lora["base_model"];
}

/** Change what an admin may edit. Audience is not here (`markAdultOnly` / `markAllAges`). */
export async function patchLoraOnStack(admin: PersonRow, id: string, patch: LoraPatch): Promise<Lora> {
  must(admin);
  const lora = present(id);
  if (patch.base_model !== undefined) throw stackRefusal(422, "not_editable", NOT_EDITABLE_LINE);
  const named = patch.availability?.who === "people" ? [...new Set(patch.availability.people ?? [])] : [];
  const fresh = named.filter((p) => !lora.availability.people.includes(p));
  if (notAdults(fresh).length > 0) throw stackRefusal(422, "minor_in_people", MINOR_IN_PEOPLE_LINE);
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name.trim();
  if (patch.description !== undefined) body.description = patch.description.trim();
  if (patch.kind !== undefined) body.kind = patch.kind;
  if (patch.strength?.default !== undefined) body.strength_default = patch.strength.default;
  // The fields only Home reads (add-ins, where the trigger words go, whether chat may suggest it, the strength range) ride in the Stack's `home_patch`.
  const clean = (words: string[] | undefined): string[] | undefined => words?.map((w) => w.trim()).filter(Boolean);
  const homePatch: Record<string, unknown> = {};
  if (patch.allow_suggesting !== undefined) homePatch.allow_suggesting = patch.allow_suggesting;
  if (patch.trigger_position !== undefined) homePatch.trigger_position = patch.trigger_position;
  for (const key of ["positive_addins", "negative_addins", "avoid_as_positive"] as const) if (patch[key]) homePatch[key] = clean(patch[key]);
  if (patch.strength && (patch.strength.min !== undefined || patch.strength.max !== undefined)) {
    homePatch.strength = { min: patch.strength.min ?? lora.strength.min, max: patch.strength.max ?? lora.strength.max, default: patch.strength.default ?? lora.strength.default };
  }
  if (Object.keys(homePatch).length > 0) body.home_patch = homePatch;
  if (patch.trigger_words) body.trigger_words = patch.trigger_words.map((w) => w.trim()).filter(Boolean);
  if (patch.source_url !== undefined) body.source_url = patch.source_url;
  if (patch.availability) body.availability_who = patch.availability.who;
  if (Object.keys(body).length > 0) await patchStack(id, body);
  if (patch.availability) setLoraPeople(id, named, admin.id);
  return after(id);
}

/** An admin has read the fingerprint and licence: the one global accept at the Stack covers it now, so there is nothing to record. */
export function confirmLora(admin: PersonRow, id: string): Lora {
  must(admin);
  return present(id);
}

/** Items already made with this LoRA that are not adult-only get the lock now (the creator's own cleared items are untouched, as the note says). */
function lockItemsMadeWith(admin: PersonRow, loraId: string): void {
  for (const row of clipsUsingStyle(loraId)) {
    let files: Array<{ id?: unknown }> = [];
    try { files = JSON.parse(row.files) as Array<{ id?: unknown }>; } catch { continue; }
    for (const file of files) {
      if (typeof file.id !== "string") continue;
      const stored = db.select({ owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(and(eq(attachments.id, file.id), like(attachments.provenance, "video-%"))).get();
      if (!stored) continue;
      const item = lockItemOfProvenance(stored.owner, stored.provenance);
      if (item && item.madeAudience !== "adult-only") setItemLock({ actor: admin, fileId: file.id, action: "mark", sessionKey: null });
    }
  }
}

/** Mark adult-only: always allowed for an admin, no passcode, audited. Raising needs no ticket at the Stack. */
export async function markAdultOnly(admin: PersonRow, id: string): Promise<Lora> {
  must(admin);
  const lora = present(id);
  if (lora.audience === "adult-only") return lora;
  await patchStack(id, { classification: "adult-only" });
  logMark({ itemId: id, action: "mark", actorId: admin.id, via: "admin" });
  lockItemsMadeWith(admin, id);
  return after(id);
}

/** Mark all-ages: only ever an admin's explicit choice, audited. `ticket` is Home's fresh single-use adult-lock ticket; the Stack uses it up through Home. */
export async function markAllAges(admin: PersonRow, id: string, ticket: string): Promise<Lora> {
  must(admin);
  const lora = present(id);
  if (lora.audience === "all-ages") return lora;
  await patchStack(id, { classification: "all-ages", ticket });
  logMark({ itemId: id, action: "clear", actorId: admin.id, via: "admin" });
  return after(id);
}

/** Remove to the 30-day trash: unusable and hidden from everyone but the admin's Recently removed. */
export async function removeLora(admin: PersonRow, id: string): Promise<Lora> {
  must(admin);
  const lora = present(id);
  if (lora.removed_at !== null) return lora;
  await callStack("DELETE", `/stack/v1/loras/${encodeURIComponent(id)}`);
  return after(id);
}

export async function restoreLora(admin: PersonRow, id: string): Promise<Lora> {
  must(admin);
  const lora = present(id);
  if (lora.removed_at === null) return lora;
  await callStack("POST", `/stack/v1/loras/${encodeURIComponent(id)}/restore`);
  return after(id);
}

/** Lowering a style the source called adult needs a fresh passcode ticket for this style (`POST /api/adult-lock/confirm { action: "unmark", item: <style id> }`, design 15.1). */
export const LOWER_ADULT_LINE = "This style was marked adult by its source. Enter your passcode again to make it all ages.";
export const LOWER_SESSION_LINE = "Open the adult lock on your own screen to make a style all ages.";

/**
 * Make an adult-only style all-ages for this admin. The Stack refuses every lowering without Home's single-use ticket, so Home hands one over: the one the admin
 * just made with their passcode (checked here for this person, session and style, not used up), or, when the source did not call it adult, one Home issues now
 * because the admin's own unlock (which the caller already required) is enough. The Stack then asks Home to use the ticket up.
 */
export async function lowerToAllAges(admin: PersonRow, id: string, sessionKey: string | null, ticket?: string): Promise<Lora> {
  must(admin);
  const lora = present(id);
  if (lora.audience === "all-ages") return lora;
  let use = ticket;
  if (lora.adult_check?.state === "adult") {
    if (!peekTicket(ticket, admin.id, sessionKey, id)) throw stackRefusal(422, "ticket_required", LOWER_ADULT_LINE);
  } else {
    if (!sessionKey) throw stackRefusal(422, "session_required", LOWER_SESSION_LINE);
    use = issueTicket(admin.id, sessionKey, id).ticket;
  }
  return markAllAges(admin, id, use as string);
}

/** Delete a style and its file for good (the trash page's "empty" action). */
export async function purgeLora(admin: PersonRow, id: string): Promise<void> {
  must(admin);
  present(id);
  await callStack("DELETE", `/stack/v1/loras/${encodeURIComponent(id)}?purge=true`);
  await refreshLoras(true);
}
