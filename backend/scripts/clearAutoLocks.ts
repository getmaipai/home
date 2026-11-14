#!/usr/bin/env bun
// One-time, reversible cleanup for the pictures the app auto-locked wrongly (owner principle, 2026-11-13: locking is a manual
// user action, or automatic only when the app DETECTS an NSFW image, which it does not do yet). Pictures made from an unlabeled
// source were stored adult-only with the lock on at creation (a `picture-gen` note with `lock: "on"` and an adult-only audience,
// an `adult_mark_log` row of `action = 'mark'` and `via = 'auto'`), and sit invisible in the Library. This script finds exactly
// those and clears them; nothing else moves.
//
// It is a script a person runs on purpose, never a migration: it must not run at install or start, and its default is a DRY RUN
// that prints counts only and writes nothing (no prompt, title, name or file content, only counts, and item ids only with --ids).
//
// A candidate is a stored `picture-gen` file (video-gen, video-poster, songs and every other writer are left alone, but counted
// by kind in the dry run) that is adult-only with the lock on, whose only `adult_mark_log` rows are the auto mark, whose owner is
// an adult (child, teen and guest owners are skipped entirely), whose job record shows no adult-only style or LoRA and whose
// recorded source files carry no adult label and no lock item. Any fact the record cannot show (a missing job row, a missing lora
// record, a missing source) skips the item as "not sure, left alone".
//
// --apply first copies the database file (`<db>.before-clearAutoLocks-<timestamp>`, a consistent snapshot), then clears each
// candidate the way a person's own clear writes (the note's audience and lock keys rewritten in place, the image-edit
// descendants of a picture root following it as for a person's clear, the creation record synced, and an audit row with
// `via = 'cleanup'` and a fresh HLC), one transaction per item, and writes `<out>/clearAutoLocks-<timestamp>.json` with
// `{ changed, skipped_counts }` so `--revert <that json>` puts every changed item's previous marks back.
//
//   cd backend && bun run scripts/clearAutoLocks.ts --db <path> [--apply] [--ids] [--out <dir>]
//   cd backend && bun run scripts/clearAutoLocks.ts --db <path> --revert <report.json>
//
// `--db` is the household's own database file (`hub.db` inside its data folder). The app's modules read `MAIPAI_DATA_DIR` when
// the module is evaluated, so this file holds them all behind one dynamic import that runs only after main() has pointed that
// variable at the --db folder; under `bun test` the preload has already opened the throwaway database and the import returns it.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, like, or } from "drizzle-orm";

interface Deps {
  db: typeof import("@/db").db;
  sqlite: typeof import("@/db").sqlite;
  dbPath: string;
  attachments: typeof import("@/db/schema").attachments;
  people: typeof import("@/db/schema").people;
  pictureJobs: typeof import("@/db/schema").pictureJobs;
  loras: typeof import("@/db/schema").loras;
  adultMarkLog: typeof import("@/db/schema").adultMarkLog;
  LOCKED_WRITERS: readonly string[];
  lockItemOfProvenance: typeof import("@/lib/adultLock").lockItemOfProvenance;
  libraryProvenance: typeof import("@/lib/libraryProvenance").libraryProvenance;
  fileAudience: typeof import("@/lib/access").fileAudience;
  speakerAgeBand: typeof import("@/lib/ageBand").speakerAgeBand;
  nextHlc: () => string;
  newAdultMarkLogId: () => string;
  syncCreationMarkForFile: (fileId: string) => void;
}
let mods: Deps | null = null;
async function deps(): Promise<Deps> {
  if (!mods) {
    const [dbMod, schema, adultLock, provenance, access, ageBand, hlc, id, creations] = await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("@/lib/adultLock"),
      import("@/lib/libraryProvenance"),
      import("@/lib/access"),
      import("@/lib/ageBand"),
      import("@/lib/hlc"),
      import("@/lib/id"),
      import("@/lib/creations/store"),
    ]);
    mods = {
      db: dbMod.db, sqlite: dbMod.sqlite, dbPath: dbMod.dbPath,
      attachments: schema.attachments, people: schema.people, pictureJobs: schema.pictureJobs, loras: schema.loras, adultMarkLog: schema.adultMarkLog,
      LOCKED_WRITERS: adultLock.LOCKED_WRITERS,
      lockItemOfProvenance: adultLock.lockItemOfProvenance,
      libraryProvenance: provenance.libraryProvenance,
      fileAudience: access.fileAudience,
      speakerAgeBand: ageBand.speakerAgeBand,
      nextHlc: hlc.nextHlc,
      newAdultMarkLogId: id.newAdultMarkLogId,
      syncCreationMarkForFile: creations.syncCreationMarkForFile,
    };
  }
  return mods;
}

export interface CandidateItem { id: string; ownerPersonId: string; provenance: string }
/** Why a locked adult-only picture was left alone; a candidate is one with none of these. */
export interface ScanCounts {
  /** Not an adult-only item with the lock on (the lock does not cover it, or the creator already cleared it). */
  notLocked: number;
  /** An adult-only locked item of another writer (video-gen, video-poster, a song, ...): counted by kind, never touched. */
  otherKind: number;
  /** The owner is a child, teen or guest: skipped entirely. */
  minorOwner: number;
  /** The mark log holds a row that is not the auto mark (a person or the household set or changed the state). */
  personSet: number;
  /** The job's record names an adult-only style or LoRA. */
  adultStyle: number;
  /** A recorded source file carries an adult label or a lock item. */
  labelledSource: number;
  /** A fact the record cannot show (a missing job, lora or source): left alone. */
  notSure: number;
}
export interface ScanResult { candidates: CandidateItem[]; counts: ScanCounts; byKind: Record<string, number> }

interface JobRequest { loras?: unknown; source_file_id?: unknown; edit?: { source_id?: unknown } }

/** The one scan: every stored locked-writer file, classified. Read-only. */
export async function scanAutoLocks(): Promise<ScanResult> {
  const m = await deps();
  const counts: ScanCounts = { notLocked: 0, otherKind: 0, minorOwner: 0, personSet: 0, adultStyle: 0, labelledSource: 0, notSure: 0 };
  const byKind: Record<string, number> = {};
  const candidates: CandidateItem[] = [];
  const files = m.db
    .select({ id: m.attachments.id, owner: m.attachments.ownerPersonId, provenance: m.attachments.provenance })
    .from(m.attachments)
    .where(and(isNull(m.attachments.deletedAt), or(...m.LOCKED_WRITERS.map((w) => like(m.attachments.provenance, `${w}:%`)))))
    .all();
  for (const file of files) {
    const meta = m.libraryProvenance(file.provenance);
    const writer = meta.writer ?? "unknown";
    byKind[writer] = (byKind[writer] ?? 0) + 1;
    const item = m.lockItemOfProvenance(file.owner, file.provenance);
    if (!item || item.madeAudience !== "adult-only" || item.lock !== "on") { counts.notLocked++; continue; }
    if (writer !== "picture-gen") { counts.otherKind++; continue; }
    const owner = m.db.select().from(m.people).where(eq(m.people.id, file.owner)).get();
    if (!owner) { counts.notSure++; continue; }
    if (m.speakerAgeBand(owner, new Date()) !== "adult") { counts.minorOwner++; continue; }
    // The auto mark, and nothing else: any other row is a person or the household deciding, and that decision stands.
    const rows = m.db.select({ action: m.adultMarkLog.action, via: m.adultMarkLog.via }).from(m.adultMarkLog).where(eq(m.adultMarkLog.itemId, file.id)).all();
    if (rows.length === 0) { counts.notSure++; continue; }
    if (rows.some((r) => r.action !== "mark" || r.via !== "auto")) { counts.personSet++; continue; }
    const jobId = typeof meta.job === "string" ? meta.job : null;
    if (!jobId) { counts.notSure++; continue; }
    const job = m.db.select().from(m.pictureJobs).where(eq(m.pictureJobs.id, jobId)).get();
    if (!job) { counts.notSure++; continue; }
    let request: JobRequest;
    try { request = JSON.parse(job.request) as JobRequest; } catch { counts.notSure++; continue; }
    if (!Array.isArray(request.loras)) { counts.notSure++; continue; }
    let styleState: "ok" | "adult" | "notSure" = "ok";
    for (const raw of request.loras) {
      if (typeof raw !== "string") { styleState = "notSure"; break; }
      const lora = m.db.select({ audience: m.loras.audience }).from(m.loras).where(eq(m.loras.id, raw)).get();
      if (!lora) { styleState = "notSure"; break; }
      if (lora.audience === "adult-only") { styleState = "adult"; break; }
    }
    if (styleState === "notSure") { counts.notSure++; continue; }
    if (styleState === "adult") { counts.adultStyle++; continue; }
    const sourceIds = [request.source_file_id, request.edit?.source_id].filter((s): s is string => typeof s === "string");
    let sourceState: "ok" | "labelled" | "notSure" = "ok";
    for (const sourceId of sourceIds) {
      const source = m.db.select({ owner: m.attachments.ownerPersonId, provenance: m.attachments.provenance }).from(m.attachments).where(eq(m.attachments.id, sourceId)).get();
      if (!source) { sourceState = "notSure"; break; }
      const sourceItem = m.lockItemOfProvenance(source.owner, source.provenance);
      if (sourceItem?.madeAudience === "adult-only" || m.fileAudience(source.provenance) === "adult-only") { sourceState = "labelled"; break; }
    }
    if (sourceState === "notSure") { counts.notSure++; continue; }
    if (sourceState === "labelled") { counts.labelledSource++; continue; }
    candidates.push({ id: file.id, ownerPersonId: file.owner, provenance: file.provenance });
  }
  return { candidates, counts, byKind };
}

export interface PreviousMarks { audience: string; made_audience: string; lock: string }
export interface ChangedItem { item_id: string; previous_provenance_marks: PreviousMarks }
/** The report --revert reads back: the changed items with their previous marks, and what the run left alone and why. */
export interface ClearReport { changed: ChangedItem[]; skipped_counts: ScanCounts }

/** Rewrite one note's mark keys (the audience pair and the lock) in the note's own shape, as withMark does for the lock key. */
function noteWithMarks(m: Deps, provenance: string, marks: PreviousMarks): string | null {
  const meta = m.libraryProvenance(provenance);
  if (!meta.writer) return null;
  const { writer: _w, ...rest } = meta;
  return `${meta.writer}:${JSON.stringify({ ...rest, audience: marks.audience, made_audience: marks.made_audience, lock: marks.lock })}`;
}

/** The audit row of one cleanup change: the cleanup's own `via`, the item's person as actor, a fresh HLC, no content. */
function auditRow(m: Deps, itemId: string, action: "clear" | "mark", actorId: string): void {
  m.db.insert(m.adultMarkLog).values({
    id: m.newAdultMarkLogId(),
    itemId,
    action,
    actorId,
    via: "cleanup" as never,
    at: new Date().toISOString(),
    hlc: m.nextHlc(),
    provenance: `cleanup:clearAutoLocks:${action}`,
  }).run();
}

/** Clear one candidate the way a person's own clear writes: the root note, the root's image-edit descendants (the edit chain
 * follows the root picture, as a person's clear does), the audit row and the creation record, in one transaction. */
async function clearOne(m: Deps, candidate: CandidateItem): Promise<void> {
  const marks: PreviousMarks = { audience: "all-ages", made_audience: "all-ages", lock: "off" };
  m.sqlite.transaction(() => {
    const next = noteWithMarks(m, candidate.provenance, marks);
    if (next) m.db.update(m.attachments).set({ provenance: next }).where(eq(m.attachments.id, candidate.id)).run();
    // The picture's own edit versions carry its id as root; job ids and file ids are plain id characters, so the LIKE needs no escaping.
    const descendants = m.db
      .select({ id: m.attachments.id, provenance: m.attachments.provenance })
      .from(m.attachments)
      .where(and(eq(m.attachments.ownerPersonId, candidate.ownerPersonId), like(m.attachments.provenance, `image-edit:%"root":"${candidate.id}"%`)))
      .all();
    for (const descendant of descendants) {
      if (m.libraryProvenance(descendant.provenance).root !== candidate.id) continue;
      const nextDescendant = noteWithMarks(m, descendant.provenance, marks);
      if (nextDescendant) m.db.update(m.attachments).set({ provenance: nextDescendant }).where(eq(m.attachments.id, descendant.id)).run();
      m.syncCreationMarkForFile(descendant.id);
    }
    auditRow(m, candidate.id, "clear", candidate.ownerPersonId);
    m.syncCreationMarkForFile(candidate.id);
  })();
}

/** Put one changed item's previous marks back, with the audit row that says it was the cleanup's own undo. */
async function restoreOne(m: Deps, change: ChangedItem): Promise<void> {
  const row = m.db.select({ id: m.attachments.id, owner: m.attachments.ownerPersonId, provenance: m.attachments.provenance }).from(m.attachments).where(eq(m.attachments.id, change.item_id)).get();
  if (!row) return;
  m.sqlite.transaction(() => {
    const next = noteWithMarks(m, row.provenance, change.previous_provenance_marks);
    if (next) m.db.update(m.attachments).set({ provenance: next }).where(eq(m.attachments.id, row.id)).run();
    auditRow(m, row.id, "mark", row.owner);
    m.syncCreationMarkForFile(row.id);
  })();
}

/** Consistent snapshot copy of the open database, `<db>.before-clearAutoLocks-<timestamp>` (a plain file copy would miss the WAL). */
function backupDatabaseFile(m: Deps): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let copy = `${m.dbPath}.before-clearAutoLocks-${stamp}`;
  for (let i = 1; existsSync(copy); i++) copy = `${m.dbPath}.before-clearAutoLocks-${stamp}-${i}`;
  m.sqlite.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  return copy;
}

export interface ApplyOptions { outDir: string; /** Which file to snapshot first; the open database's own file by default. */ dbFile?: string }
export interface ApplyResult { backup: string | null; report: string; changed: number }

/** Apply the scan: snapshot the database, clear every candidate in one transaction each, write the revert report. */
export async function applyClearAutoLocks(scan: ScanResult, options: ApplyOptions): Promise<ApplyResult> {
  const m = await deps();
  const backup = existsSync(options.dbFile ?? m.dbPath) ? backupDatabaseFile(m) : null;
  const changed: ChangedItem[] = [];
  for (const candidate of scan.candidates) {
    const item = m.lockItemOfProvenance(candidate.ownerPersonId, candidate.provenance);
    if (!item || item.madeAudience !== "adult-only" || item.lock !== "on") continue;
    const meta = m.libraryProvenance(candidate.provenance);
    const previous: PreviousMarks = {
      audience: typeof meta.audience === "string" ? meta.audience : item.madeAudience,
      made_audience: typeof meta.made_audience === "string" ? meta.made_audience : item.madeAudience,
      lock: item.lock,
    };
    await clearOne(m, candidate);
    changed.push({ item_id: candidate.id, previous_provenance_marks: previous });
  }
  const report: ClearReport = { changed, skipped_counts: scan.counts };
  mkdirSync(options.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let path = join(options.outDir, `clearAutoLocks-${stamp}.json`);
  for (let i = 1; existsSync(path); i++) path = join(options.outDir, `clearAutoLocks-${stamp}-${i}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  return { backup, report: path, changed: changed.length };
}

export interface RevertOptions { /** Which file to snapshot first; the open database's own file by default. */ dbFile?: string }

/** Read a report and put every changed item's previous marks back (a fresh snapshot first, the same way apply took one). */
export async function revertClearAutoLocks(reportPath: string, options: RevertOptions = {}): Promise<{ backup: string | null; restored: number }> {
  const m = await deps();
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as ClearReport;
  const backup = existsSync(options.dbFile ?? m.dbPath) ? backupDatabaseFile(m) : null;
  let restored = 0;
  for (const change of report.changed) {
    const before = m.db.select({ provenance: m.attachments.provenance }).from(m.attachments).where(eq(m.attachments.id, change.item_id)).get();
    if (!before) continue;
    await restoreOne(m, change);
    const after = m.db.select({ provenance: m.attachments.provenance }).from(m.attachments).where(eq(m.attachments.id, change.item_id)).get();
    if (after && after.provenance !== before.provenance) restored++;
  }
  return { backup, restored };
}

// ---- the command line --------------------------------------------------------------------------------------------------------------------------------

interface ParsedArgs { db: string | null; apply: boolean; ids: boolean; outDir: string; revert: string | null }
function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { db: null, apply: false, ids: false, outDir: "clear-auto-locks-reports", revert: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--db") args.db = argv[++i] ?? null;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--ids") args.ids = true;
    else if (arg === "--out") args.outDir = argv[++i] ?? "";
    else if (arg === "--revert") args.revert = argv[++i] ?? null;
    else if (arg === "--help" || arg === "-h") { usage(); process.exit(0); }
    else { console.error(`unknown argument: ${arg}`); usage(); process.exit(2); }
  }
  return args;
}
function usage(): void {
  console.error("usage: bun run scripts/clearAutoLocks.ts --db <path> [--apply] [--ids] [--out <dir>]");
  console.error("       bun run scripts/clearAutoLocks.ts --db <path> --revert <report.json>");
}

function isMainModule(): boolean {
  try { return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.revert && !args.db) { usage(); process.exit(2); }
  if (args.db) {
    const dbPath = resolve(args.db);
    if (basename(dbPath) !== "hub.db") { console.error(`--db must be the household's own database file (the hub.db inside its data folder), not ${args.db}`); process.exit(2); }
    if (!existsSync(dbPath)) { console.error(`no database file at ${args.db}`); process.exit(2); }
    if (!process.env.MAIPAI_DATA_DIR) process.env.MAIPAI_DATA_DIR = dirname(dbPath);
  } else if (!process.env.MAIPAI_DATA_DIR) { console.error("no --db given and MAIPAI_DATA_DIR is not set"); process.exit(2); }
  await deps();
  if (args.revert) {
    const result = await revertClearAutoLocks(resolve(args.revert));
    console.log(`reverted ${result.restored} item${result.restored === 1 ? "" : "s"} from ${args.revert}`);
    if (result.backup) console.log(`database copied to ${result.backup} first`);
    return;
  }
  const scan = await scanAutoLocks();
  printScan(scan, args.ids);
  if (!args.apply) {
    console.log("dry run: nothing was written. Re-run with --apply to clear the candidates.");
    return;
  }
  const result = await applyClearAutoLocks(scan, { outDir: resolve(args.outDir) });
  console.log(`cleared ${result.changed} item${result.changed === 1 ? "" : "s"}`);
  if (result.backup) console.log(`database copied to ${result.backup} first`);
  console.log(`report written to ${result.report}`);
}

function printScan(scan: ScanResult, ids: boolean): void {
  console.log("auto-locked pictures, one-time cleanup scan");
  for (const [kind, count] of Object.entries(scan.byKind).sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  kind ${kind}: ${count}`);
  console.log(`candidates (cleared with --apply): ${scan.candidates.length}`);
  if (ids) for (const candidate of scan.candidates) console.log(`  ${candidate.id}`);
  console.log(`left alone:`);
  console.log(`  not an adult-only locked item: ${scan.counts.notLocked}`);
  console.log(`  another kind of item (video, poster, song, ...): ${scan.counts.otherKind}`);
  console.log(`  a child's, teen's or guest's item: ${scan.counts.minorOwner}`);
  console.log(`  set or changed by a person, not the auto mark alone: ${scan.counts.personSet}`);
  console.log(`  made with an adult-only style or LoRA: ${scan.counts.adultStyle}`);
  console.log(`  made from an adult-labelled or locked source: ${scan.counts.labelledSource}`);
  console.log(`  not sure, left alone: ${scan.counts.notSure}`);
}

if (isMainModule()) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
