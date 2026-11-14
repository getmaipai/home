// The one-time cleanup (owner principle 2026-11-13): the pictures the app auto-locked from an unlabeled source are found,
// cleared by --apply and put back exactly by --revert; every other locked item is left alone and counted.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db, dbPath } from "@/db";
import { attachments, conversationTurns, pictureJobs } from "@/db/schema";
import { createAttachment } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId, newCreationId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { __markRowsForTests, logAutoMark, logMark } from "@/lib/adultMarks";
import { lockItemOfProvenance, lockState } from "@/lib/adultLock";
import { listLibrary } from "@/lib/library";
import { testPng } from "./pictureFixture";
import { household } from "./fixtures/adultLock";
import { makePicture } from "./fixtures/adultLockPicture";
import { secretLora } from "./fixtures/lora";
import { applyClearAutoLocks, revertClearAutoLocks, scanAutoLocks, type ClearReport } from "../scripts/clearAutoLocks";
import type { PersonRow } from "@/types";

let outDir: string;
let jobSeq = 0;
beforeEach(() => { resetDb(); outDir = mkdtempSync(join(tmpdir(), "clearAutoLocks-")); });
afterEach(() => { rmSync(outDir, { recursive: true, force: true }); });

const rowOf = (id: string) => db.select().from(attachments).where(eq(attachments.id, id)).get()!;
const noteOf = (id: string) => rowOf(id).provenance;
const itemOf = (id: string) => { const row = rowOf(id); return lockItemOfProvenance(row.ownerPersonId, row.provenance); };
const stateOf = (actor: PersonRow, id: string) => lockState(itemOf(id), actor);
const inLibrary = (actor: PersonRow, id: string) => listLibrary(actor, {}).items.some((item) => item.id === id);
/** The database as stored on disk (the main file and whatever the WAL still holds), one digest. */
const dbHash = () => {
  const hash = createHash("sha256");
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(file)) hash.update(readFileSync(file));
  return hash.digest("hex");
};
/** A picture stored exactly as the pipeline stores a wrongly auto-locked one: an adult-only note with the lock on, a job row, an auto mark row. */
async function autoLocked(actor: PersonRow, source: { id: string; conversationId: string; turnId: string } | null, opts: { loras?: string[] } = {}): Promise<string> {
  let conversationId: string;
  if (source) conversationId = source.conversationId;
  else { const conversation = resolveOrCreateConversation(actor, "chat"); if (!conversation.ok) throw new Error(conversation.error); conversationId = conversation.value.id; }
  const turnId = newConversationTurnId();
  const now = new Date().toISOString();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId, userText: "a landscape", replyText: "saved", source: "model", safetyAction: "allow", createdAt: now, hlc: nextHlc() }).run();
  const jobId = `auto-lock-job-${++jobSeq}`;
  db.insert(pictureJobs).values({ id: jobId, personId: actor.id, conversationId, turnId, kind: "generate", state: "done", stackJob: null, percent: 100, phase: null, position: null, prompt: "a landscape", request: JSON.stringify({ size: "1024x1024", n: 1, seed: null, loras: opts.loras ?? [], source_file_id: source?.id ?? null, audience: "adult" }), error: null, files: "[]", createdAt: now, updatedAt: now, hlc: nextHlc() }).run();
  const provenance = `picture-gen:${JSON.stringify({ v: 1, audience: "adult-only", made_audience: "adult-only", lock: "on", creation: newCreationId(), job: jobId, index: 0, width: 1, height: 1 })}`;
  const created = createAttachment(actor, { conversationId, turnId, mediaType: "image/png", bytes: await testPng(), deduplicate: false, provenance });
  if (!created.ok) throw new Error(created.error);
  logAutoMark(created.value.id, actor.id);
  return created.value.id;
}
/** One stored file with a hand-written locked-writer note (a locked clip, for the "another kind" case). */
async function lockedNote(actor: PersonRow, writer: string, note: Record<string, unknown>): Promise<string> {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const turnId = newConversationTurnId();
  const now = new Date().toISOString();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId: conversation.value.id, userText: "a landscape", replyText: "saved", source: "model", safetyAction: "allow", createdAt: now, hlc: nextHlc() }).run();
  const created = createAttachment(actor, { conversationId: conversation.value.id, turnId, mediaType: "image/png", bytes: await testPng(), deduplicate: false, provenance: `${writer}:${JSON.stringify(note)}` });
  if (!created.ok) throw new Error(created.error);
  return created.value.id;
}
/** The report file the apply wrote into the out dir (exactly one). */
function reportFile(): string {
  const files = readdirSync(outDir).filter((name) => name.startsWith("clearAutoLocks-") && name.endsWith(".json"));
  if (files.length !== 1) throw new Error(`expected one report in ${outDir}, found ${files.length}`);
  return join(outDir, files[0]!);
}

describe("clearAutoLocks", () => {
  test("a dry run finds the auto-locked picture and changes nothing", async () => {
    const h = await household();
    const actor = h.row("Marlow");
    const source = await makePicture(actor, "all-ages", "source");
    const candidate = await autoLocked(actor, source);
    expect(stateOf(actor, candidate)).toBe("locked");
    const before = dbHash();
    const scan = await scanAutoLocks();
    expect(scan.candidates.map((c) => c.id)).toEqual([candidate]);
    expect(scan.counts).toEqual({ notLocked: 1, otherKind: 0, minorOwner: 0, personSet: 0, adultStyle: 0, labelledSource: 0, notSure: 0 });
    expect(scan.byKind).toEqual({ "picture-gen": 2 });
    expect(dbHash()).toBe(before);
    expect(readdirSync(outDir)).toEqual([]);
    expect(stateOf(actor, candidate)).toBe("locked");
  });

  test("apply clears the candidate, the owner sees it in the Library, and revert puts the lock back exactly", async () => {
    const h = await household();
    const actor = h.row("Marlow");
    const source = await makePicture(actor, "all-ages", "source");
    const candidate = await autoLocked(actor, source);
    const scan = await scanAutoLocks();
    const applied = await applyClearAutoLocks(scan, { outDir, dbFile: dbPath });
    expect(applied.changed).toBe(1);
    expect(applied.backup).toMatch(/^.*hub\.db\.before-clearAutoLocks-/);
    if (!applied.backup) throw new Error("no backup path");
    expect(existsSync(applied.backup)).toBe(true);
    expect(itemOf(candidate)).toMatchObject({ madeAudience: "all-ages", lock: "off" });
    expect(stateOf(actor, candidate)).toBe("open");
    expect(inLibrary(actor, candidate)).toBe(true);
    const report = JSON.parse(readFileSync(reportFile(), "utf8")) as ClearReport;
    expect(report.changed).toEqual([{ item_id: candidate, previous_provenance_marks: { audience: "adult-only", made_audience: "adult-only", lock: "on" } }]);
    expect(report.skipped_counts).toEqual(scan.counts);
    let rows = __markRowsForTests(candidate);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ action: "mark", via: "auto", actorId: actor.id });
    expect(rows).toContainEqual({ action: "clear", via: "cleanup", actorId: actor.id });
    const reverted = await revertClearAutoLocks(reportFile());
    expect(reverted.restored).toBe(1);
    expect(itemOf(candidate)).toMatchObject({ madeAudience: "adult-only", lock: "on" });
    expect(stateOf(actor, candidate)).toBe("locked");
    expect(inLibrary(actor, candidate)).toBe(false);
    rows = __markRowsForTests(candidate);
    expect(rows).toHaveLength(3);
    expect(rows).toContainEqual({ action: "mark", via: "auto", actorId: actor.id });
    expect(rows).toContainEqual({ action: "clear", via: "cleanup", actorId: actor.id });
    expect(rows).toContainEqual({ action: "mark", via: "cleanup", actorId: actor.id });
  });

  test("applying twice changes nothing on the second run", async () => {
    const h = await household();
    const actor = h.row("Marlow");
    const source = await makePicture(actor, "all-ages", "source");
    const candidate = await autoLocked(actor, source);
    const first = await applyClearAutoLocks(await scanAutoLocks(), { outDir });
    expect(first.changed).toBe(1);
    const againScan = await scanAutoLocks();
    expect(againScan.candidates).toEqual([]);
    const again = await applyClearAutoLocks(againScan, { outDir });
    expect(again.changed).toBe(0);
    expect((JSON.parse(readFileSync(again.report, "utf8")) as { changed: unknown[] }).changed).toEqual([]);
    expect(itemOf(candidate)).toMatchObject({ madeAudience: "all-ages", lock: "off" });
  });

  test("every exclusion is left alone and counted by its reason", async () => {
    const h = await household();
    const actor = h.row("Marlow");
    const source = await makePicture(actor, "all-ages", "source");
    const candidate = await autoLocked(actor, source);
    const personLocked = await autoLocked(actor, source);
    logMark({ itemId: personLocked, action: "mark", actorId: actor.id, via: "creator" });
    const lora = secretLora(actor.id);
    const adultStyle = await autoLocked(actor, source, { loras: [lora.id] });
    const teenItem = await autoLocked(h.row("Nova"), null);
    const childItem = await autoLocked(h.row("Sprout"), null);
    const clip = await lockedNote(actor, "video-gen", { v: 1, audience: "adult-only", made_audience: "adult-only", lock: "on", job: "video-job-1" });
    const labelledSource = await makePicture(actor, "adult-only", "labelled");
    const labelled = await autoLocked(actor, { id: labelledSource.id, conversationId: labelledSource.conversationId, turnId: labelledSource.turnId });
    const excluded = [personLocked, adultStyle, teenItem, childItem, clip, labelledSource.id, labelled];
    const notesBefore = excluded.map(noteOf);
    const scan = await scanAutoLocks();
    expect(scan.candidates.map((c) => c.id)).toEqual([candidate]);
    expect(scan.counts).toEqual({ notLocked: 1, otherKind: 1, minorOwner: 2, personSet: 1, adultStyle: 1, labelledSource: 1, notSure: 1 });
    expect(scan.byKind).toEqual({ "picture-gen": 8, "video-gen": 1 });
    const applied = await applyClearAutoLocks(scan, { outDir });
    expect(applied.changed).toBe(1);
    expect(itemOf(candidate)).toMatchObject({ madeAudience: "all-ages", lock: "off" });
    expect(excluded.map(noteOf)).toEqual(notesBefore);
    expect(stateOf(actor, personLocked)).toBe("locked");
  });
});
