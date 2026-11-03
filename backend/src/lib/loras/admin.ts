// VIDEO-LORA-03 (docs/dev/loras.md): what an owner or admin may change on a LoRA record. Every function takes the admin, re-checks it (a route is not the only gate),
// writes through `saveLora` (validated, hlc and updated_at advanced) and, where the design note asks, writes an audit row with no content (`adult_mark_log`, item
// id = the LoRA id). A source can only RAISE the audience; lowering it is `markAllAges`, an admin's explicit act.
import { and, eq, like } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { attachments } from "@/db/schema";
import { isOwnerOrAdmin } from "@/lib/access";
import { lockItemOfProvenance } from "@/lib/adultLock";
import { logMark, setItemLock } from "@/lib/adultMarks";
import { getLoraRecord, saveLora, LoraWriteError, type Lora } from "@/lib/loras/store";
import { updateVideoLora } from "@/lib/videos/stack";
import type { PersonRow } from "@/types";

export const NOT_ADMIN_LINE = "Only an owner or admin can change styles.";
export const NOT_HERE_LINE = "That style isn't in the library.";
export const TRASH_DAYS = 30;

function must(admin: PersonRow): void {
  if (!isOwnerOrAdmin(admin)) throw new LoraWriteError("invalid", NOT_ADMIN_LINE);
}
function present(id: string): Lora {
  const lora = getLoraRecord(id);
  if (!lora) throw new LoraWriteError("invalid", NOT_HERE_LINE);
  return lora;
}

export interface LoraPatch {
  name?: string; description?: string; kind?: Lora["kind"];
  availability?: { who: "admins" | "adults" | "people"; people?: string[] };
  strength?: { default?: number; min?: number; max?: number };
  trigger_words?: string[]; trigger_position?: "start" | "end";
  positive_addins?: string[]; negative_addins?: string[]; avoid_as_positive?: string[];
  base_model?: Lora["base_model"];
}

/** Change what an admin may edit. Audience is not here (`markAdultOnly` / `markAllAges`). */
export function patchLora(admin: PersonRow, id: string, patch: LoraPatch): Lora {
  must(admin);
  const lora = present(id);
  const next: Lora = { ...lora };
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.description !== undefined) next.description = patch.description.trim();
  if (patch.kind !== undefined) next.kind = patch.kind;
  if (patch.availability) {
    const who = patch.availability.who;
    next.availability = { who, people: who === "people" ? [...new Set(patch.availability.people ?? [])] : [] };
  }
  if (patch.strength) {
    const s = { ...lora.strength, ...patch.strength };
    next.strength = { default: s.default, min: s.min, max: s.max };
  }
  if (patch.trigger_words) next.trigger_words = patch.trigger_words.map((w) => w.trim()).filter(Boolean);
  if (patch.trigger_position) next.trigger_position = patch.trigger_position;
  for (const key of ["positive_addins", "negative_addins", "avoid_as_positive"] as const) if (patch[key]) next[key] = patch[key]!.map((w) => w.trim()).filter(Boolean);
  if (patch.base_model) {
    next.base_model = patch.base_model;
    next.compatible_with = patch.base_model === "unknown" ? [] : [patch.base_model];
  }
  return saveLora(next, admin.id);
}

/** An admin has read the fingerprint and licence: the style stops being "added, not yet confirmed". */
export function confirmLora(admin: PersonRow, id: string): Lora {
  must(admin);
  const lora = present(id);
  if (lora.licence.acknowledged_by !== null) return lora;
  const now = new Date().toISOString();
  return saveLora({ ...lora, licence: { ...lora.licence, acknowledged_by: admin.id, acknowledged_at: now } }, admin.id);
}

export const needsConfirmation = (lora: Lora): boolean => lora.licence.acknowledged_by === null;

/** Mirror the audience to the Stack's second lock. A Stack that is down or does not know the file does not undo the record. */
async function mirror(id: string, audience: Lora["audience"]): Promise<void> {
  await updateVideoLora(id, { classification: audience }).catch(() => undefined);
}

/** Items already made with this LoRA that are not adult-only get the lock now (the creator's own cleared items are untouched, as the note says). */
function lockItemsMadeWith(admin: PersonRow, loraId: string): void {
  const rows = sqlite.query("SELECT files FROM video_jobs WHERE request LIKE ?").all(`%"${loraId}"%`) as Array<{ files: string }>;
  for (const row of rows) {
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

/** Mark NSFW: always allowed for an admin, no passcode, audited. */
export async function markAdultOnly(admin: PersonRow, id: string): Promise<Lora> {
  must(admin);
  const lora = present(id);
  if (lora.audience === "adult-only") return lora;
  const now = new Date().toISOString();
  const saved = saveLora({ ...lora, audience: "adult-only", audience_set_by: admin.id, audience_set_at: now }, admin.id);
  logMark({ itemId: id, action: "mark", actorId: admin.id, via: "admin" });
  lockItemsMadeWith(admin, id);
  await mirror(id, "adult-only");
  return saved;
}

/** Mark all-ages: only ever an admin's explicit choice (the route asks for the click), audited. Never called by import or sync. */
export async function markAllAges(admin: PersonRow, id: string): Promise<Lora> {
  must(admin);
  const lora = present(id);
  if (lora.audience === "all-ages") return lora;
  const now = new Date().toISOString();
  const saved = saveLora({ ...lora, audience: "all-ages", audience_set_by: admin.id, audience_set_at: now }, admin.id);
  logMark({ itemId: id, action: "clear", actorId: admin.id, via: "admin" });
  await mirror(id, "all-ages");
  return saved;
}

/** Remove to the 30-day trash: unusable and hidden from everyone but the admin's Recently removed. */
export function removeLora(admin: PersonRow, id: string): Lora {
  must(admin);
  const lora = present(id);
  if (lora.removed_at !== null) return lora;
  const now = new Date();
  return saveLora({ ...lora, removed_at: now.toISOString(), trash_until: new Date(now.getTime() + TRASH_DAYS * 86_400_000).toISOString() }, admin.id);
}

export function restoreLora(admin: PersonRow, id: string): Lora {
  must(admin);
  const lora = present(id);
  if (lora.removed_at === null) return lora;
  return saveLora({ ...lora, removed_at: null, trash_until: null }, admin.id);
}
