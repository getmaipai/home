// Shared role/person-access predicates. Extracted from lib/memory.ts
// (2026-09-04) the moment a second consumer (lib/settings.ts) needed the
// identical "can this actor touch this person's own scoped data" rule,
// per CLAUDE.md principle 4 ("one definition, one place... a second copy
// of anything is wrong even when it is faster") and the lesson from a
// code review that same day (memory.ts's own isOwnerOrAdmin() duplicated
// an equivalent inline check elsewhere).
import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { people, shares } from "@/db/schema";
import type { PersonRow } from "@/types";
import { isOwnerOrAdminRole, canHaveTemporaryChatRole } from "@/wire";

// The role-string check itself now lives in @/wire (alias-free) so a
// frontend client can share it too (a code review, 2026-09-04, found a
// third hand-copy of this exact expression); this wrapper is what every
// existing PersonRow-based call site here keeps using.
export function isOwnerOrAdmin(actor: PersonRow): boolean {
  return isOwnerOrAdminRole(actor.role);
}

// TEMP-CHAT-01: the PersonRow-taking wrapper isOwnerOrAdmin() already is
// for isOwnerOrAdminRole() - conversationHistory.ts's createConversation()
// and resolveOrCreateConversation() both gate on this, one definition
// shared between the old create-first entry point and the new
// zero-footprint one instead of two copies of "owner, admin, or adult".
export function canHaveTemporaryChat(actor: PersonRow): boolean {
  return canHaveTemporaryChatRole(actor.role);
}

// Batch form, for a caller filtering many records against many different
// target people in one pass (memory.ts's list()/recall(), one query
// instead of one per record).
export function rolesById(): Map<string, string> {
  const rows = db.select({ id: people.id, role: people.role }).from(people).all();
  return new Map(rows.map((r) => [r.id, r.role]));
}

// Single-target form, for a caller that only ever needs one person's
// role (settings' person-scope authorization). A review (2026-09-04)
// found the extraction into this module had settings call rolesById()
// (a full table scan) to resolve exactly one row; this is the targeted
// query that case actually needs.
export function getPersonRole(personId: string): string | undefined {
  return db.select({ role: people.role }).from(people).where(eq(people.id, personId)).get()?.role;
}

// Whether `actor` may access (read, write, export, or forget) `personId`'s
// own person-scoped data: themself, or owner/admin ONLY when the target
// is a child (parity with 4.14's conversation-visibility rule: a parent
// sees a child's, nothing of an adult's; teen support needs a summary
// mechanism that doesn't exist yet, so teens are treated like adults
// here, a deliberately conservative judgment call recorded in
// docs/dev.md). Used identically by memory (list/recall/forget/export)
// and settings (person-scope values) so the two can't drift apart the
// way memory's read and forget/export rules once did.
//
// `roleOf`, when supplied, is a pre-built batch map (memory's per-record
// filtering loop); omitted, this looks the one role up directly
// (settings' single-target case) rather than forcing every caller to pay
// for a full table scan.
export function canAccessPerson(actor: PersonRow, personId: string, roleOf?: Map<string, string>): boolean {
  if (actor.id === personId) return true;
  if (!isOwnerOrAdmin(actor)) return false;
  const role = roleOf ? roleOf.get(personId) : getPersonRole(personId);
  return role === "child";
}

// Every active (non-deleted) person in the household - turnEngine.ts's
// household block (session-a-intelligence.md step 1, platform plan 4.5's
// "who lives here" volatile-zone content) needs the whole roster, not one
// row. Sorted by createdAt then id so the prompt's household list is
// deterministic turn to turn, never dependent on SQLite's own row order.
export function listActivePeople(): PersonRow[] {
  return db.select().from(people).where(isNull(people.deletedAt)).orderBy(people.createdAt, people.id).all();
}

// STORE-SHARE-01: the file-visibility predicate, mirroring canRead()'s
// own role in memory.ts (RULES-AND-LEARNED-COMPONENTS.md: household
// privacy and disclosure stay in one place, never reimplemented per
// caller) but living here instead, because a file's readers span more
// than one module (lib/attachments.ts's own read boundary, lib/
// shares.ts's CRUD, the files routes) the way lib/settings.ts and
// memory.ts both needed canAccessPerson() above. A file is visible to
// its owner always, and to anyone a live share.schema.json pointer
// names - by person id, or by the literal "household" (every active
// person in it, since a household has no membership list of its own
// beyond "every active person" today).
export function canAccessFile(actor: PersonRow, ownerPersonId: string, fileId: string): boolean {
  if (actor.id === ownerPersonId) return true;
  const rows = db.select({ to: shares.to }).from(shares).where(eq(shares.fileId, fileId)).all();
  return rows.some((row) => row.to === "household" || row.to === actor.id);
}

// STORE-SHARE-01 (household-storage-2026-09-23.md, "Sharing, and its
// bounds"): "the disclosure filter in the turn pipeline treats a shared
// file as context with the owner's disclosure" - keyed on whoever owns
// the file, never on whichever person's turn is currently reading it
// (the same file, shared with both a child and an adult, must read the
// same way for both). Files carry no disclosure field of their own
// (unlike a memory record, which gets one from childDisclosure.ts's own
// vocabulary-cue heuristic over its text) and a file's bytes aren't
// text to run that heuristic over, so this is a coarser, conservative
// stand-in: a minor's own file defaults open (their own photo is
// ordinary content for another child to see), anyone else's defaults
// closed, matching childDisclosure.ts's own "adult_only unless clearly
// fine" default. Not yet called from turnMachine/nodes/context.ts -
// that node has no file/document context source at all today (checked
// directly: only utterance/window/memory/profile/clock/roster), so
// wiring this in has no real caller yet; it is exported and tested now
// so the day a file enters context, this is the one function to call,
// not a second disclosure rule invented at that call site.
export function fileDisclosure(ownerPersonId: string): "child_ok" | "adult_only" {
  const role = getPersonRole(ownerPersonId);
  return role === "child" || role === "teen" ? "child_ok" : "adult_only";
}
