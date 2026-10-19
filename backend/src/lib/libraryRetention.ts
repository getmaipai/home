// Library storage rules are independent of chat age. No migration or Trash
// provider here: only generated, unpinned File records can be reclaimed.
import { and, eq, asc, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachments, settingsValues } from "@/db/schema";
import { getHouseholdSettingValue } from "@/lib/settings";
import { householdCapBytes, householdUsageBytes } from "@/lib/storage/usage";
import { companionsOf, parentOf, dropLibraryReference } from "@/lib/libraryTrash";
import { generationOf } from "@/lib/music/types";
import { nextHlc } from "@/lib/hlc";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { trigger } from "@/lib/notifications";
import { LIBRARY_RETENTION_TYPES, retentionKeys, type LibraryRetentionType } from "@/settings/libraryRetentionKeys";
const DAY = 86400000;
const SOURCE = "library_retention";
type FileRow = typeof attachments.$inferSelect;
// Music uses File.origin's parser; other made files use their reserved provenance markers.
function typeFor(row: FileRow): LibraryRetentionType | null {
  const generated = row.origin === "made" || generationOf(row.provenance) || ["picture-gen:", "video-gen:", "video-poster:", "image-edit:"].some((prefix) => row.provenance.startsWith(prefix));
  if (!generated) return null;
  if (row.mediaType.startsWith("image/")) return "pictures";
  if (row.mediaType.startsWith("video/")) return "videos";
  if (row.mediaType.startsWith("audio/")) return "songs";
  if (row.mediaType.startsWith("text/") || row.mediaType === "application/pdf" || /officedocument|opendocument/.test(row.mediaType)) return "documents";
  return "generated";
}
function rule(type: LibraryRetentionType) {
  const keys = retentionKeys(type);
  return { mode: getHouseholdSettingValue(keys.mode), threshold_percent: Number(getHouseholdSettingValue(keys.threshold)) };
}
// Internal settings state is deliberately absent from the editable registry.
const stateKey = (type: LibraryRetentionType) => `internal.library_retention.${type}`;
function readState(type: LibraryRetentionType): { warnedAt: number; lastDay: string; signature: string } | null {
  const row = db.select().from(settingsValues).where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, stateKey(type)))).get();
  if (!row) return null;
  try {
    const state = JSON.parse(row.value);
    return Number.isFinite(state.warnedAt) && typeof state.lastDay === "string" && typeof state.signature === "string" ? state : null;
  } catch { return null; }
}
function clearState(type: LibraryRetentionType) {
  const state = readState(type);
  // Keep the daily dedupe stamp even if space recovers and fills again.
  if (state && state.signature !== "") db.update(settingsValues).set({ value: JSON.stringify({ ...state, warnedAt: 0, signature: "" }), hlc: nextHlc() }).where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, stateKey(type)))).run();
  resolveIssue(SOURCE, type);
}
function signature(type: LibraryRetentionType, cap: number): string { return JSON.stringify([rule(type), rule("generated"), cap]); }
function candidates() {
  return db.select().from(attachments).where(and(eq(attachments.retention, "conversation"), isNull(attachments.deletedAt))).orderBy(asc(attachments.createdAt), asc(attachments.id)).all()
    // A file a live chat still shows keeps its bytes whatever the Library does, so removing its Library reference would free
    // nothing: it becomes a candidate when its chat is gone (LIBRARY-REVAMP-02 detaches it then).
    .filter((row) => typeFor(row) !== null && (row.turnId === null || row.conversationId === null) && !parentOf(row));
}
/** LIBRARY-RETENTION-PREVIEW-01: this person's own items the storage rules have warned about and will remove at the next
 * nightly run once the 24-hour warning has passed. `expiresAt` is the end of that warning. Cheap when nothing is over a
 * threshold (the Library page asks on every load). */
export function expiringLibraryFiles(ownerId: string, now = Date.now()): Map<string, { expiresAt: string; size: number; sha256: string }> {
  const out = new Map<string, { expiresAt: string; size: number; sha256: string }>();
  const cap = householdCapBytes();
  if (cap <= 0) return out;
  const percent = householdUsageBytes() / cap * 100;
  const lowest = Math.min(...LIBRARY_RETENTION_TYPES.filter((type) => type !== "trash" && rule(type).mode === "until_storage_threshold").map((type) => rule(type).threshold_percent));
  if (!Number.isFinite(lowest) || percent <= lowest) return out;
  const plan = previewLibraryRetention(now);
  const mine = new Map((plan.files.length ? db.select({ id: attachments.id, sha256: attachments.sha256 }).from(attachments).where(and(eq(attachments.ownerPersonId, ownerId), inArray(attachments.id, plan.files.map((file) => file.id)))).all() : []).map((row) => [row.id, row.sha256] as const));
  for (const file of plan.files) {
    const sha256 = mine.get(file.id);
    if (sha256 === undefined) continue;
    const t = plan.types.find((entry) => entry.type === file.type);
    const state = t ? readState(t.type) : null;
    // Only a warned type is expiring; an unwarned one has not been told yet and shows nothing.
    if (!t || !t.over || !state || state.signature !== signature(t.type, plan.budgetBytes)) continue;
    out.set(file.id, { expiresAt: new Date(state.warnedAt + DAY).toISOString(), size: file.size, sha256 });
  }
  return out;
}

/** `executable` plans only what the next run can remove (types whose warning period has ended); the default also shows what is coming. */
export function previewLibraryRetention(now = Date.now(), executable = false) {
  const usageBytes = householdUsageBytes(), budgetBytes = householdCapBytes();
  const generatedRule = rule("generated");
  const percent = budgetBytes > 0 ? usageBytes / budgetBytes * 100 : 0;
  let projected = usageBytes;
  const selected: { row: FileRow; type: LibraryRetentionType }[] = [];
  const types = LIBRARY_RETENTION_TYPES.map((type) => {
    const r = rule(type);
    // A made item follows both the generated rule and its display type.
    // Keep in either rule wins; both thresholds must be exceeded.
    const threshold = Math.max(r.threshold_percent, generatedRule.threshold_percent);
    const over = type !== "trash" && budgetBytes > 0 && r.mode === "until_storage_threshold" && generatedRule.mode === "until_storage_threshold" && percent > threshold;
    const state = readState(type);
    const ready = over && state !== null && state.signature === signature(type, budgetBytes) && now - state.warnedAt >= DAY;
    return { type, ...r, effectiveThreshold: threshold, over, ready, count: 0, bytes: 0 };
  });
  // LIBRARY-DEDUP-01: identical bytes are one stored file, so removing a record frees its bytes only when it is the
  // last record holding them (or the other holders are removed in the same run).
  const holders = new Map<string, number>(db.select({ sha256: attachments.sha256, n: sql<number>`count(*)` }).from(attachments).groupBy(attachments.sha256).all().map((r) => [r.sha256, Number(r.n)]));
  const removedPerHash = new Map<string, number>();
  for (const row of candidates()) {
    const t = types.find((entry) => entry.type === typeFor(row))!;
    // Each file is counted once under its display type; generated covers other made files.
    if (!t.over || (executable && !t.ready) || projected / budgetBytes * 100 <= t.effectiveThreshold) continue;
    // Required companions have no independent storage lifetime. The parent's type and warning govern the whole
    // family, including a cover generated years after its song. A kept family member protects the family.
    const family = [row, ...companionsOf(row).filter(member => member.deletedAt === null)];
    if (family.some(member => member.retention === "kept")) continue;
    for (const member of family) {
      const removed = (removedPerHash.get(member.sha256) ?? 0) + 1;
      // A live chat retains its copy even when the Library reference goes.
      const chatHeld = member.turnId !== null && member.conversationId !== null;
      if (!chatHeld) removedPerHash.set(member.sha256, removed);
      const frees = !chatHeld && removed === (holders.get(member.sha256) ?? 1) ? member.size : 0;
      selected.push({ row: member, type: t.type }); t.count++; t.bytes += frees; projected -= frees;
    }
  }
  return { usageBytes, budgetBytes, budgetSource: "storage.household.cap_bytes" as const, configured: budgetBytes > 0, percent, count: selected.length, bytes: types.reduce((n, entry) => n + entry.bytes, 0), types, files: selected.map(({ row, type }) => ({ id: row.id, type, size: row.size })) };
}
let running: Promise<{ deleted: number; bytes: number }> | null = null;
export function runLibraryRetention(now = Date.now()): Promise<{ deleted: number; bytes: number }> {
  if (running) return running;
  running = run(now).finally(() => { running = null; });
  return running;
}
async function run(now: number) {
  const initial = previewLibraryRetention(now);
  for (const t of initial.types) {
    if (!t.over) { clearState(t.type); continue; }
    const sig = signature(t.type, initial.budgetBytes);
    const previous = readState(t.type);
    const state = previous?.signature === sig ? previous : null;
    const day = new Date(now).toISOString().slice(0, 10);
    if (previous?.lastDay === day) continue;
    const title = `Household storage is above ${t.effectiveThreshold}% for ${t.type}.`;
    const noun = t.type === "generated" ? "items Home made" : `${t.type} Home made`;
    const detail = `${title} From ${new Date((state?.warnedAt ?? now) + DAY).toISOString().slice(0, 10)}, the next nightly run may remove the oldest unpinned ${noun} first. Set ${t.type} retention to Keep until deleted in Settings, Storage to keep these items. Pinned items always stay. Delete files or raise the household storage cap to make room.`;
    await raiseIssue({ source: SOURCE, key: t.type, severity: "warning", title, detail, suppressNotification: true });
    // Existing admin notification, including the full actionable warning.
    await trigger("repairs.new", { title: detail });
    const values = { value: JSON.stringify({ warnedAt: state?.warnedAt ?? now, lastDay: day, signature: sig }), source: "system", updatedAt: new Date(now).toISOString(), hlc: nextHlc() };
    db.insert(settingsValues).values({ scope: "household", key: stateKey(t.type), ...values }).onConflictDoUpdate({ target: [settingsValues.scope, settingsValues.key], set: values }).run();
  }
  // Re-read after asynchronous warning delivery: pins, rules and usage may change.
  const plan = previewLibraryRetention(now, true);
  const ready = new Set(plan.types.filter((t) => t.ready).map((t) => t.type));
  let deleted = 0, bytes = 0;
  const rows = plan.files.filter((file) => ready.has(file.type)).map((file) =>
    db.select().from(attachments).where(eq(attachments.id, file.id)).get(),
  ).filter((row): row is FileRow => row !== undefined && row.retention !== "kept");
  // The Library's reference goes; a file a chat still shows stays as that chat's copy (LIBRARY-REVAMP-10), and bytes are
  // freed only when the last record of them goes.
  for (const dropped of dropLibraryReference(rows)) { deleted++; if (dropped.freed) bytes += dropped.size; }
  for (const t of previewLibraryRetention(now).types) if (!t.over) clearState(t.type);
  return { deleted, bytes };
}
