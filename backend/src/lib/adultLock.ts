// ADULT-LOCK-02 (docs/design/video-loras-2026-11-02.md section 3, docs/dev/adult-lock.md): the Adult lock. One definition of "is this item locked for this
// viewer right now", used by every route and internal producer that turns an adult-only item into text, a URL or a count. There is no per-route copy
// of the rule: a route asks `lockState`, and answers a locked item with `lockedView` (a single tile, no title, prompt, picture, count or id).
//
// Unrelated to SAFETY.md's "adult unlock" (a parent opening a child's feature). This lock keeps an adult's own adult items from a casual glance
// (a minor, or someone beside them); the minor ceiling itself stays `canReadFileAudience` (rule 0).
//
// The unlock proof is an opaque random token held in this process's memory only (never the database, gone on restart), bound to the person and the
// browser session, with a sliding 2 minute idle and an absolute 15 minute lifetime. The page holds it in a JavaScript variable and sends it as
// `X-Adult-Unlock`. `adultLockContext` reads that header once per request into an AsyncLocalStorage store, so deep producers (the Library query, the
// feed) ask `requestProof()` without every function growing a parameter; with no request around (a background job, a test without the middleware) the
// answer is "no proof", which is the locked answer.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, sessions } from "@/db/schema";
import { fileAudience } from "@/lib/access";
import { speakerAgeBand } from "@/lib/ageBand";
import { libraryProvenance } from "@/lib/libraryProvenance";
import { hashSessionToken } from "@/lib/session";
import type { AppEnv, PersonRow } from "@/types";

/** Sliding idle lifetime and absolute lifetime of an unlock proof. */
export const PROOF_IDLE_MS = 2 * 60 * 1000;
export const PROOF_ABSOLUTE_MS = 15 * 60 * 1000;
/** A confirm ticket (creator unmark, ADULT-LOCK-06) lives 30 seconds and is single use. */
export const TICKET_MS = 30 * 1000;

/** The request header the page sends the proof in. */
export const PROOF_HEADER = "x-adult-unlock";

/** The writers whose file items the lock covers. Pictures join the video writers in ADULT-LOCK-07 slice 1; songs follow later. */
export const LOCKED_WRITERS: readonly string[] = ["video-gen", "video-edit", "video-poster", "picture-gen", "image-edit", "music-gen"];

let clock: () => number = () => Date.now();
/** Test-only: a movable clock for the idle and absolute lifetimes. */
export function __setAdultLockClockForTests(fn: (() => number) | null): void { clock = fn ?? (() => Date.now()); }

interface Proof { personId: string; sessionKey: string; visit: string; createdAt: number; lastSeen: number }
const proofs = new Map<string, Proof>();
interface Ticket { personId: string; sessionKey: string; item: string; expiresAt: number }
const tickets = new Map<string, Ticket>();

const newToken = (): string => randomBytes(32).toString("base64url");

function expired(proof: Proof, at: number): boolean {
  return at - proof.lastSeen > PROOF_IDLE_MS || at - proof.createdAt > PROOF_ABSOLUTE_MS;
}

function sweep(at: number): void {
  for (const [token, proof] of proofs) if (expired(proof, at)) proofs.delete(token);
  for (const [token, ticket] of tickets) if (ticket.expiresAt <= at) tickets.delete(token);
}

/** Mint a proof for a person's browser session after their credential checked out. */
export function issueProof(personId: string, sessionKey: string, visit: string): { proof: string; idle_seconds: number } {
  const at = clock();
  sweep(at);
  const proof = newToken();
  proofs.set(proof, { personId, sessionKey, visit: visit.slice(0, 80), createdAt: at, lastSeen: at });
  return { proof, idle_seconds: PROOF_IDLE_MS / 1000 };
}

/** Whether `token` is a live proof for this person on this session. A valid check slides the idle window; an expired proof is removed on the spot. */
export function proofIsValid(token: string | null | undefined, personId: string, sessionKey: string | null | undefined, touch = true): boolean {
  if (!token || !sessionKey) return false;
  const proof = proofs.get(token);
  if (!proof) return false;
  const at = clock();
  if (expired(proof, at)) { proofs.delete(token); return false; }
  if (proof.personId !== personId || proof.sessionKey !== sessionKey) return false;
  if (touch) proof.lastSeen = at;
  return true;
}

export function revokeProof(token: string | null | undefined): void { if (token) proofs.delete(token); }
/** Sign-out and the session lock: every proof of one browser session. */
export function revokeProofsForSession(sessionKey: string): void { for (const [token, proof] of proofs) if (proof.sessionKey === sessionKey) proofs.delete(token); }
/** Profile switch, role or age change, a household setting that restricts adult-only items, a changed secret: every proof of one person. */
export function revokeProofsForPerson(personId: string): void {
  for (const [token, proof] of proofs) if (proof.personId === personId) proofs.delete(token);
  for (const [token, ticket] of tickets) if (ticket.personId === personId) tickets.delete(token);
}
/** Test-only. */
export function __resetAdultLockForTests(): void { proofs.clear(); tickets.clear(); for (const k of Object.keys(unlockCounts) as UnlockOutcome[]) unlockCounts[k] = 0; }

/** RULES 6a: unlock attempts are counted by outcome and tied to nobody (no person, no item, no address). The set is closed. */
export type UnlockOutcome = "ok" | "wrong" | "locked_out";
const unlockCounts: Record<UnlockOutcome, number> = { ok: 0, wrong: 0, locked_out: 0 };
export function countUnlock(outcome: UnlockOutcome): void { unlockCounts[outcome] += 1; }
export function adultLockCounters(): Readonly<Record<UnlockOutcome, number>> { return { ...unlockCounts }; }

/** A single-use ticket bound to one item and one session, for the creator's "remove the adult lock" confirm (a live proof is not accepted for it). */
export function issueTicket(personId: string, sessionKey: string, item: string): { ticket: string; expires_in: number } {
  const at = clock();
  sweep(at);
  const ticket = newToken();
  tickets.set(ticket, { personId, sessionKey, item, expiresAt: at + TICKET_MS });
  return { ticket, expires_in: TICKET_MS / 1000 };
}

export function consumeTicket(ticket: string | null | undefined, personId: string, sessionKey: string | null | undefined, item: string): boolean {
  if (!ticket || !sessionKey) return false;
  const held = tickets.get(ticket);
  if (!held) return false;
  tickets.delete(ticket);
  return held.expiresAt > clock() && held.personId === personId && held.sessionKey === sessionKey && held.item === item;
}

// ---- The request's proof -------------------------------------------------------------------------------------------------------------------------

/** What a request carries: the proof header and the browser session key (a hash of the session cookie). A paired device, a bearer token or an API key
 * has no session key, so it can never hold a proof. */
export interface AdultProof { token: string | null; sessionKey: string | null }
const NO_PROOF: AdultProof = { token: null, sessionKey: null };
const store = new AsyncLocalStorage<AdultProof>();

/** The session key of a human browser session on this request, or null (no cookie, or a paired device's session). */
export function sessionKeyOf(token: string | undefined): string | null {
  if (!token) return null;
  const key = hashSessionToken(token);
  const row = db.select({ deviceId: sessions.deviceId }).from(sessions).where(eq(sessions.tokenHash, key)).get();
  return row && row.deviceId === null ? key : null;
}

/** Mounted once on /api/*: reads the proof header and the session cookie into the request's store. */
export const adultLockContext = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.header(PROOF_HEADER) ?? null;
  const cookie = getCookie(c, "session");
  const proof: AdultProof = token || cookie ? { token, sessionKey: token ? sessionKeyOf(cookie) : null } : NO_PROOF;
  await store.run(proof, () => next());
});

export function requestProof(): AdultProof { return store.getStore() ?? NO_PROOF; }
/** Run `fn` as a request carrying `proof` (tests, and internal producers that act for a request). */
export function withProof<T>(proof: AdultProof, fn: () => T): T { return store.run(proof, fn); }

/** Test-only: run `fn` as `personId`'s own page with a live unlock proof (no request, no route), the way the page would hold one. */
export function __unlockedForTests<T>(personId: string, fn: () => T): T {
  const { proof } = issueProof(personId, "test-session", "test");
  return store.run({ token: proof, sessionKey: "test-session" }, fn);
}

/** Test-only: the same, for the rest of the current test's async context (a test whose whole body acts as an unlocked page). */
export function __unlockRestOfTest(personId: string): void {
  const { proof } = issueProof(personId, "test-session", "test");
  store.enterWith({ token: proof, sessionKey: "test-session" });
}

/** Whether the current request holds a live proof for `actor`. */
export function unlockedFor(actor: PersonRow, proof: AdultProof = requestProof()): boolean {
  return proofIsValid(proof.token, actor.id, proof.sessionKey);
}

// ---- The decision --------------------------------------------------------------------------------------------------------------------------------

/** What the lock needs to know about an item. `madeAudience` is the machine fact (the minor ceiling, never lowered); `lock` is whether the lock applies
 * and is what the creator can clear. Until the spec carries both fields (VIDEO-LORA-02, ADULT-LOCK-06) they are read from the provenance note:
 * `made_audience` falls back to `audience`, and `lock` to "on" for an adult-only item. */
export interface LockItem { ownerPersonId: string; madeAudience: "all-ages" | "adult-only" | null; lock: "on" | "off" }

export type LockResult = "open" | "locked" | "hidden";

/** Read duplicate top-level JSON keys the same way SQLite's json_each does in lockedFilterSql. JSON.parse keeps only the last duplicate. */
function hasTopLevelString(provenance: string, keys: readonly string[], wanted: string): boolean {
  const colon = provenance.indexOf(":");
  if (colon < 0) return false;
  const source = provenance.slice(colon + 1).trim();
  if (!source.startsWith("{")) return false;
  let i = 1;
  while (i < source.length) {
    while (i < source.length && /[\s,]/.test(source[i]!)) i++;
    if (source[i] === "}") return false;
    if (source[i] !== '"') return false;
    const keyStart = i;
    i++;
    let escaped = false;
    while (i < source.length) {
      const ch = source[i++]!;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') break;
    }
    let key: unknown;
    try { key = JSON.parse(source.slice(keyStart, i)); } catch { return false; }
    while (/\s/.test(source[i] ?? "")) i++;
    if (source[i] !== ":") return false;
    i++;
    while (/\s/.test(source[i] ?? "")) i++;
    const valueStart = i;
    let depth = 0;
    let inString = false;
    escaped = false;
    while (i < source.length) {
      const ch = source[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        if (depth === 0) break;
        depth--;
      } else if (ch === "," && depth === 0) break;
      i++;
    }
    if (keys.includes(String(key))) {
      try { if (JSON.parse(source.slice(valueStart, i)) === wanted) return true; } catch { return false; }
    }
    if (source[i] === ",") i++;
  }
  return false;
}

/** The lock item of a Library file's provenance note, or null when the lock does not cover it (not a locked writer). */
export function lockItemOfProvenance(ownerPersonId: string, provenance: string): LockItem | null {
  const meta = libraryProvenance(provenance);
  if (!meta.writer || !LOCKED_WRITERS.includes(meta.writer)) return null;
  // Either key saying adult-only counts (the same rule as lockedFilterSql): the machine fact is never lowered.
  // Fail closed: any one reading that says adult-only wins (the duplicate-key scan, the parsed made fact, the parsed audience), so a mistake in one of them cannot open an adult item.
  const adult = hasTopLevelString(provenance, ["audience", "made_audience"], "adult-only") || meta.made_audience === "adult-only" || fileAudience(provenance) === "adult-only";
  const made = adult ? "adult-only" : meta.made_audience === "all-ages" ? "all-ages" : fileAudience(provenance);
  return { ownerPersonId, madeAudience: made, lock: meta.lock === "off" ? "off" : "on" };
}

/**
 * The one decision. `hidden`: the viewer may not know the item exists (a minor). `locked`: the owner, or an adult it was shared with (the caller has
 * already checked the share), without a valid proof. `open`: not an adult-only item, the creator cleared the lock, or the viewer holds a proof.
 * A non-owner reaching a locked item is a recipient: they unlock with their own credential, never open without it.
 */
export function lockState(item: LockItem | null, actor: PersonRow, proof: AdultProof = requestProof()): LockResult {
  if (!item || item.madeAudience !== "adult-only") return "open";
  if (speakerAgeBand(actor, new Date()) !== "adult") return "hidden";
  if (item.lock === "off") return "open";
  return unlockedFor(actor, proof) ? "open" : "locked";
}

/** One source of a new item (an edited, joined or mixed clip, a continued frame): the flags it carries right now. A source with no flags counts as adult-only
 * with the lock off only when the caller says so; callers pass what `lockItemOfProvenance` or the job's request says. */
export interface MarkSource { madeAudience: "all-ages" | "adult-only" | null; lock: "on" | "off" }
export interface ItemMark { madeAudience: "all-ages" | "adult-only"; lock: "on" | "off" }

/**
 * ADULT-LOCK-06: the audience table of the design note (3.10), one function for every new item (job start, edit, join, mix, continue; pictures and songs
 * call it in ADULT-LOCK-07). `madeAudience` is never lower than any source's and rises when the new item adds an adult-only style. `lock` is on when a
 * source is still locked on or the item adds an adult-only style; an item whose adult sources the creator all cleared follows them (off), and an
 * all-ages item with no adult style starts off.
 */
export function newItemMark(sources: readonly MarkSource[], addsAdultStyle: boolean): ItemMark {
  const adult = addsAdultStyle || sources.some((s) => s.madeAudience !== "all-ages");
  const locked = addsAdultStyle || sources.some((s) => s.madeAudience !== "all-ages" && s.lock === "on");
  return { madeAudience: adult ? "adult-only" : "all-ages", lock: locked ? "on" : "off" };
}

/** The provenance note keys of a mark. `audience` is the minor ceiling the Library already reads; `made_audience` says the same in the spec's word. */
export function markFields(mark: ItemMark): { audience: ItemMark["madeAudience"]; made_audience: ItemMark["madeAudience"]; lock: ItemMark["lock"] } {
  return { audience: mark.madeAudience, made_audience: mark.madeAudience, lock: mark.lock };
}

/** A provenance note with `lock` (and, when raising, the audience keys) rewritten. `raise` only ever raises the audience, never lowers it. */
export function withMark(provenance: string, change: { lock: "on" | "off"; raiseToAdult?: boolean }): string | null {
  const meta = libraryProvenance(provenance);
  const writer = meta.writer;
  if (!writer) return null;
  const { writer: _w, ...rest } = meta;
  const next: Record<string, unknown> = { ...rest, lock: change.lock };
  if (change.raiseToAdult) { next.audience = "adult-only"; next.made_audience = "adult-only"; }
  return `${writer}:${JSON.stringify(next)}`;
}

/** What a locked item is drawn as: one flag the tile needs, never a title, description, picture, tag, count, date, id or owner. */
export function lockedView(making = false): { locked: true; making: boolean } { return { locked: true, making }; }

/** The lock state of a stored Library file (by id) for a viewer. A missing file is "open": the caller's own "not found" answer applies. */
export function fileLockState(actor: PersonRow, fileId: string, proof: AdultProof = requestProof()): LockResult {
  const row = db.select({ owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, fileId)).get();
  return row ? lockState(lockItemOfProvenance(row.owner, row.provenance), actor, proof) : "open";
}

/** A promoted media row inherits the lock of the Library file it points to. */
export function mediaItemLocked(actor: PersonRow, item: { loc_file_id?: string | null; location?: { file_id?: string | null } | null }, proof: AdultProof = requestProof()): boolean {
  const id = item.loc_file_id ?? item.location?.file_id;
  return id ? fileLockState(actor, id, proof) !== "open" : false;
}

/** Whether a stored Library file is adult-only (the machine fact, whatever the creator's lock setting): playback of it keeps no place, history or mark. */
export function fileIsAdultOnly(fileId: string): boolean {
  const row = db.select({ owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, fileId)).get();
  if (!row) return false;
  // The same fact the rows' `adult_only` flag is read from (`audience`, or `made_audience`, whatever the writer): one definition for the flag and for what is not kept.
  return lockItemOfProvenance(row.owner, row.provenance)?.madeAudience === "adult-only" || fileAudience(row.provenance) === "adult-only";
}

/** The SQL predicate "this attachment row is a locked item the viewer has no proof for", for the Library's queries (counts, lists, search). `provenance` is
 * the SQL expression of the provenance JSON (libraryProvenanceSql). With a live proof for the viewer it is "0" (nothing is locked); the minor ceiling is
 * the Library's own audience gate and is unchanged. Written so any `audience` or `made_audience` of adult-only counts and only an explicit `lock` of off
 * clears it. */
export function lockedFilterSql(actor: PersonRow, provenanceJson: string, proof: AdultProof = requestProof()): string {
  if (unlockedFor(actor, proof)) return "0";
  const writers = LOCKED_WRITERS.map((w) => `'${w}'`).join(",");
  return `(json_extract(${provenanceJson},'$.writer') IN (${writers}) AND EXISTS(SELECT 1 FROM json_each(${provenanceJson}) WHERE key IN ('audience','made_audience') AND value = 'adult-only') AND coalesce(json_extract(${provenanceJson},'$.lock'),'on') != 'off')`;
}
