import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull, like, or } from "drizzle-orm";
import { db, dbPath, sqlite } from "@/db";
import { attachments, adultMarkLog, people, pictureJobs } from "@/db/schema";
import { getLoraRecord, refreshLoras } from "@/lib/loras/stackLibrary";
import { LOCKED_WRITERS, lockItemOfProvenance } from "@/lib/adultLock";
import { libraryProvenance } from "@/lib/libraryProvenance";
import { fileAudience } from "@/lib/access";
import { speakerAgeBand } from "@/lib/ageBand";
import { nextHlc } from "@/lib/hlc";
import { newAdultMarkLogId } from "@/lib/id";
import { syncCreationMarkForFile } from "@/lib/creations/store";
import { dataDir } from "@/lib/paths";

export interface CandidateItem { id: string; ownerPersonId: string; provenance: string }
export interface ScanCounts { notLocked: number; otherKind: number; minorOwner: number; personSet: number; adultStyle: number; labelledSource: number; notSure: number }
export interface ScanResult { candidates: CandidateItem[]; counts: ScanCounts; byKind: Record<string, number> }
export interface PreviousMarks { audience: string; made_audience: string; lock: string }
export interface ChangedItem { item_id: string; previous_provenance_marks: PreviousMarks }
export interface ClearReport { id: string; at: string; by_person_id: string; changed: ChangedItem[]; skipped_counts: ScanCounts; undone?: boolean; undone_at?: string }
export interface CliClearReport { changed: ChangedItem[]; skipped_counts: ScanCounts }
interface JobRequest { loras?: unknown; source_file_id?: unknown; edit?: { source_id?: unknown } }

export async function scanAutoLocks(): Promise<ScanResult> {
  const counts: ScanCounts = { notLocked: 0, otherKind: 0, minorOwner: 0, personSet: 0, adultStyle: 0, labelledSource: 0, notSure: 0 };
  const byKind: Record<string, number> = {};
  const candidates: CandidateItem[] = [];
  // A style's audience is the Stack's (STACK-LORAS-01): read it fresh; when the Stack cannot be read no style resolves and each picture counts as not sure.
  await refreshLoras(true);
  const files = db.select({ id: attachments.id, owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments)
    .where(and(isNull(attachments.deletedAt), or(...LOCKED_WRITERS.map((writer) => like(attachments.provenance, `${writer}:%`))))).all();
  for (const file of files) {
    const meta = libraryProvenance(file.provenance);
    const writer = meta.writer ?? "unknown";
    byKind[writer] = (byKind[writer] ?? 0) + 1;
    const item = lockItemOfProvenance(file.owner, file.provenance);
    if (!item || item.madeAudience !== "adult-only" || item.lock !== "on") { counts.notLocked++; continue; }
    if (writer !== "picture-gen") { counts.otherKind++; continue; }
    const owner = db.select().from(people).where(eq(people.id, file.owner)).get();
    if (!owner) { counts.notSure++; continue; }
    if (speakerAgeBand(owner, new Date()) !== "adult") { counts.minorOwner++; continue; }
    const rows = db.select({ action: adultMarkLog.action, via: adultMarkLog.via }).from(adultMarkLog).where(eq(adultMarkLog.itemId, file.id)).all();
    if (!rows.length) { counts.notSure++; continue; }
    if (rows.some((row) => row.action !== "mark" || row.via !== "auto")) { counts.personSet++; continue; }
    const jobId = typeof meta.job === "string" ? meta.job : null;
    const job = jobId ? db.select().from(pictureJobs).where(eq(pictureJobs.id, jobId)).get() : null;
    if (!job) { counts.notSure++; continue; }
    let request: JobRequest;
    try { request = JSON.parse(job.request) as JobRequest; } catch { counts.notSure++; continue; }
    if (!Array.isArray(request.loras)) { counts.notSure++; continue; }
    let style: "ok" | "adult" | "notSure" = "ok";
    for (const raw of request.loras) {
      if (typeof raw !== "string") { style = "notSure"; break; }
      const lora = getLoraRecord(raw);
      if (!lora) { style = "notSure"; break; }
      if (lora.audience === "adult-only") { style = "adult"; break; }
    }
    if (style === "notSure") { counts.notSure++; continue; }
    if (style === "adult") { counts.adultStyle++; continue; }
    const sourceIds = [request.source_file_id, request.edit?.source_id].filter((id): id is string => typeof id === "string");
    let sourceState: "ok" | "labelled" | "notSure" = "ok";
    for (const sourceId of sourceIds) {
      const source = db.select({ owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, sourceId)).get();
      if (!source) { sourceState = "notSure"; break; }
      const sourceItem = lockItemOfProvenance(source.owner, source.provenance);
      if (sourceItem?.madeAudience === "adult-only" || fileAudience(source.provenance) === "adult-only") { sourceState = "labelled"; break; }
    }
    if (sourceState === "notSure") { counts.notSure++; continue; }
    if (sourceState === "labelled") { counts.labelledSource++; continue; }
    candidates.push({ id: file.id, ownerPersonId: file.owner, provenance: file.provenance });
  }
  return { candidates, counts, byKind };
}

function noteWithMarks(provenance: string, marks: PreviousMarks): string | null {
  const meta = libraryProvenance(provenance);
  if (!meta.writer) return null;
  const { writer, ...rest } = meta;
  return `${writer}:${JSON.stringify({ ...rest, audience: marks.audience, made_audience: marks.made_audience, lock: marks.lock })}`;
}

function auditRow(itemId: string, action: "clear" | "mark", actorId: string): void {
  db.insert(adultMarkLog).values({ id: newAdultMarkLogId(), itemId, action, actorId, via: "cleanup", at: new Date().toISOString(), hlc: nextHlc(), provenance: `cleanup:clearAutoLocks:${action}` }).run();
}

function clearOne(candidate: CandidateItem): ChangedItem[] {
  const marks: PreviousMarks = { audience: "all-ages", made_audience: "all-ages", lock: "off" };
  const changed: ChangedItem[] = [];
  sqlite.transaction(() => {
    const previous = currentMarks({ ownerPersonId: candidate.ownerPersonId, provenance: candidate.provenance });
    const next = noteWithMarks(candidate.provenance, marks);
    if (next) db.update(attachments).set({ provenance: next }).where(eq(attachments.id, candidate.id)).run();
    if (previous) changed.push({ item_id: candidate.id, previous_provenance_marks: previous });
    auditRow(candidate.id, "clear", candidate.ownerPersonId);
    const descendants = db.select({ id: attachments.id, provenance: attachments.provenance }).from(attachments)
      .where(and(eq(attachments.ownerPersonId, candidate.ownerPersonId), like(attachments.provenance, `image-edit:%"root":"${candidate.id}"%`))).all();
    for (const descendant of descendants) {
      if (libraryProvenance(descendant.provenance).root !== candidate.id) continue;
      const prior = currentMarks({ ownerPersonId: candidate.ownerPersonId, provenance: descendant.provenance });
      if (!prior || (prior.audience === marks.audience && prior.made_audience === marks.made_audience && prior.lock === marks.lock)) continue;
      const nextDescendant = noteWithMarks(descendant.provenance, marks);
      if (nextDescendant) {
        db.update(attachments).set({ provenance: nextDescendant }).where(eq(attachments.id, descendant.id)).run();
        auditRow(descendant.id, "clear", candidate.ownerPersonId);
        changed.push({ item_id: descendant.id, previous_provenance_marks: prior });
      }
      syncCreationMarkForFile(descendant.id);
    }
    syncCreationMarkForFile(candidate.id);
  })();
  return changed;
}

function currentMarks(row: { ownerPersonId: string; provenance: string }): PreviousMarks | null {
  const item = lockItemOfProvenance(row.ownerPersonId, row.provenance);
  if (!item) return null;
  const meta = libraryProvenance(row.provenance);
  const fallback = item.madeAudience ?? "adult-only";
  return { audience: typeof meta.audience === "string" ? meta.audience : fallback, made_audience: typeof meta.made_audience === "string" ? meta.made_audience : fallback, lock: item.lock };
}

export async function clearAutoLocks(input: { runId: string; byPersonId: string; expected?: number }): Promise<{ changed: number; report: ClearReport }> {
  const scan = await scanAutoLocks();
  if (input.expected !== undefined && scan.candidates.length !== input.expected) throw Object.assign(new Error("The number changed. Look again and confirm."), { code: "count_changed", status: 409 });
  if (input.expected !== undefined && scan.candidates.length === 0) throw Object.assign(new Error("Nothing needs clearing. No picture was locked by the app on its own."), { code: "nothing_to_clear", status: 409 });
  const changed: ChangedItem[] = [];
  for (const candidate of scan.candidates) {
    const previous = currentMarks({ ownerPersonId: candidate.ownerPersonId, provenance: candidate.provenance });
    const current = db.select({ ownerPersonId: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, candidate.id)).get();
    if (!previous || !current || current.ownerPersonId !== candidate.ownerPersonId || currentMarks(current)?.lock !== "on") continue;
    changed.push(...clearOne({ ...candidate, provenance: current.provenance }));
  }
  const report: ClearReport = { id: input.runId, at: new Date().toISOString(), by_person_id: input.byPersonId, changed, skipped_counts: scan.counts, undone: false };
  const dir = join(dataDir, "adult-lock-cleanups");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${input.runId}.json`), JSON.stringify(report, null, 2));
  return { changed: changed.length, report };
}

function backupDatabaseFile(): string | null {
  if (!existsSync(dbPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let copy = `${dbPath}.before-clearAutoLocks-${stamp}`;
  for (let i = 1; existsSync(copy); i++) copy = `${dbPath}.before-clearAutoLocks-${stamp}-${i}`;
  sqlite.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  return copy;
}

export async function applyClearAutoLocks(scan: ScanResult, options: { outDir: string; dbFile?: string }): Promise<{ backup: string | null; report: string; changed: number }> {
  const backup = existsSync(options.dbFile ?? dbPath) ? backupDatabaseFile() : null;
  const changed: ChangedItem[] = [];
  for (const candidate of scan.candidates) {
    const previous = currentMarks({ ownerPersonId: candidate.ownerPersonId, provenance: candidate.provenance });
    if (!previous) continue;
    const current = db.select({ ownerPersonId: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, candidate.id)).get();
    if (!current || currentMarks(current)?.lock !== "on") continue;
    changed.push(...clearOne({ ...candidate, provenance: current.provenance }));
  }
  mkdirSync(options.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let path = join(options.outDir, `clearAutoLocks-${stamp}.json`);
  for (let i = 1; existsSync(path); i++) path = join(options.outDir, `clearAutoLocks-${stamp}-${i}.json`);
  writeFileSync(path, JSON.stringify({ changed, skipped_counts: scan.counts } satisfies CliClearReport, null, 2));
  return { backup, report: path, changed: changed.length };
}

export async function revertClearAutoLocks(reportPath: string): Promise<{ backup: string | null; restored: number }> {
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as CliClearReport;
  const backup = backupDatabaseFile();
  let restored = 0;
  for (const change of report.changed) {
    const row = db.select({ id: attachments.id, ownerPersonId: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, change.item_id)).get();
    if (!row) continue;
    sqlite.transaction(() => {
      const next = noteWithMarks(row.provenance, change.previous_provenance_marks);
      if (next) db.update(attachments).set({ provenance: next }).where(eq(attachments.id, row.id)).run();
      auditRow(row.id, "mark", row.ownerPersonId);
      syncCreationMarkForFile(row.id);
    })();
    restored++;
  }
  return { backup, restored };
}

export async function undoCleanup(runId: string): Promise<{ restored: number; changed_since: number; report: ClearReport }> {
  const path = join(dataDir, "adult-lock-cleanups", `${runId}.json`);
  if (!existsSync(path)) throw Object.assign(new Error("That cleanup is not here. Refresh the page and try again."), { code: "not_found", status: 404 });
  const report = JSON.parse(readFileSync(path, "utf8")) as ClearReport;
  if (report.undone) throw Object.assign(new Error("That cleanup was already undone."), { code: "already_undone", status: 409 });
  let restored = 0;
  let changed_since = 0;
  for (const change of report.changed) {
    const row = db.select({ id: attachments.id, ownerPersonId: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, change.item_id)).get();
    const current = row && currentMarks(row);
    const laterChange = db.select({ at: adultMarkLog.at, via: adultMarkLog.via }).from(adultMarkLog).where(eq(adultMarkLog.itemId, change.item_id)).all()
      .some((mark) => mark.at >= report.at && mark.via !== "cleanup");
    if (!row || !current || laterChange || current.lock !== "off" || current.audience !== "all-ages" || current.made_audience !== "all-ages") { changed_since++; continue; }
    sqlite.transaction(() => {
      const next = noteWithMarks(row.provenance, change.previous_provenance_marks);
      if (next) db.update(attachments).set({ provenance: next }).where(eq(attachments.id, row.id)).run();
      auditRow(row.id, "mark", row.ownerPersonId);
      syncCreationMarkForFile(row.id);
    })();
    restored++;
  }
  report.undone = true;
  report.undone_at = new Date().toISOString();
  writeFileSync(path, JSON.stringify(report, null, 2));
  return { restored, changed_since, report };
}

export function latestCleanup(): { id: string; at: string; changed: number; undone: boolean } | null {
  const dir = join(dataDir, "adult-lock-cleanups");
  if (!existsSync(dir)) return null;
  const paths = readdirSync(dir).filter((name) => name.endsWith(".json"));
  const reports = paths.map((name) => {
    try { return JSON.parse(readFileSync(join(dir, name), "utf8")) as ClearReport; } catch { return null; }
  }).filter((report): report is ClearReport => report !== null).sort((a, b) => b.at.localeCompare(a.at));
  const report = reports[0];
  return report ? { id: report.id, at: report.at, changed: report.changed.length, undone: report.undone === true } : null;
}
