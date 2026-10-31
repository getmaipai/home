// MEDIA-PROGRESS-01 (design section 10): where a person is in each title, on every device. `mergeProgress` is the ONE definition of
// how two states of one row become one: the online write, the offline batch, the robot and Go all call it, and nothing else decides.
//
//   - Newest wins by the server stamp after skew correction (the write's own clock reading, moved by how far the sender's clock was
//     from ours when it sent). A rewind applies when it is newer; there is no "furthest position wins".
//   - `completed` is a latch: a title reaching its kind's threshold sets it (video, episode, film 90 percent; podcast episode,
//     audiobook and its parts 95; a book when the person says so or at the end; a track never latches, it counts finishes), and only
//     the person clears it, with a clear that is newer than the row.
//   - `marks` union by `at_s`; counters take the larger value, plus any events this write reports.
//   - A child's row, or a teen's, is written only from that person's own signed-in session on a screen that is theirs.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaProgress } from "@/db/schema";
import { getDeviceById } from "@/lib/devices";
import { nextHlc } from "@/lib/hlc";
import { newMediaProgressId } from "@/lib/id";
import { meterProgress, type MediaBudget } from "./watchTime";
import { mediaBandOf } from "./band";
import { progressFromRow, MediaProgress, type MediaItem } from "./model";

export type Position = MediaProgress["position"];
export type Mark = MediaProgress["marks"][number];
export type ProgressKind = MediaItem["kind"];

export const LATCH_PERCENT: Record<ProgressKind, number | null> = {
  video: 90, episode: 90, film: 90, podcast_episode: 95, audiobook: 95, chapter: 95, book: null, track: null,
};
/** A book is "at the end" from here (percent of the text). */
export const BOOK_END_PERCENT = 99;

export interface ProgressState {
  position: Position;
  duration_s: number | null;
  completed: boolean;
  plays: number;
  skips: number;
  finishes: number;
  marks: Mark[];
  device_id: string | null;
  /** The server stamp (ISO, after skew correction) of the write that set the position. */
  updated_at: string;
}

export interface ProgressWrite {
  position: Position;
  playing?: boolean;
  seeking?: boolean;
  duration_s?: number | null;
  /** The person says it is done (a book) or not done (`false` clears the latch, if newer than the row). */
  completed?: boolean;
  /** Absolute counts as the sending device knows them (an offline batch); merged by taking the larger. */
  counts?: { plays?: number; skips?: number; finishes?: number };
  /** Events this write reports (online): each adds one. */
  events?: { play?: boolean; skip?: boolean; finish?: boolean };
  marks?: Mark[];
  device_id?: string | null;
  /** The server stamp of this write, already skew-corrected (see `correctedStamp`). */
  stamp: string;
}

/** The sender's clock reading of the moment it sampled the position, moved by the sender's clock error at the moment it sent. A
 * stamp never lands in the future, and a write with no clock readings is stamped when it arrived. */
export function correctedStamp(input: { sampledAt?: string | null; clientNow?: string | null; serverNow: Date }): string {
  const serverMs = input.serverNow.getTime();
  const sampled = input.sampledAt ? Date.parse(input.sampledAt) : Number.NaN;
  const sent = input.clientNow ? Date.parse(input.clientNow) : Number.NaN;
  if (Number.isNaN(sampled) || Number.isNaN(sent)) return input.serverNow.toISOString();
  return new Date(Math.min(sampled + (serverMs - sent), serverMs)).toISOString();
}

export function percentOf(position: Position, duration: number | null): number | null {
  if ("seconds" in position) return duration && duration > 0 ? Math.min(100, (position.seconds / duration) * 100) : null;
  return position.percent;
}

/** Whether this position finishes a title of this kind. */
export function reachesLatch(kind: ProgressKind, position: Position, duration: number | null): boolean {
  if (kind === "track") return false;
  if (kind === "book") return "locator" in position && position.percent >= BOOK_END_PERCENT;
  const need = LATCH_PERCENT[kind];
  const percent = percentOf(position, duration);
  return need !== null && percent !== null && percent >= need;
}

function unionMarks(a: readonly Mark[], b: readonly Mark[], bWins: boolean): Mark[] {
  const byTime = new Map<number, Mark>();
  for (const mark of [...(bWins ? a : b), ...(bWins ? b : a)]) {
    const prior = byTime.get(mark.at_s);
    if (bWins && mark.label?.startsWith("podcast-snip:deleted:") && prior?.label?.startsWith("podcast-snip:") && !prior.label.startsWith("podcast-snip:deleted:")) {
      byTime.set(mark.at_s, mark);
    } else if (!(bWins && mark.label === null && prior?.label?.startsWith("podcast-snip:"))) {
      byTime.set(mark.at_s, mark);
    }
  }
  return [...byTime.values()].sort((x, y) => x.at_s - y.at_s);
}

export interface MergeResult {
  state: ProgressState;
  /** Whether the write's position became the row's position (false: an older write, only its other facts merged). */
  positionApplied: boolean;
}

export function mergeProgress(kind: ProgressKind, existing: ProgressState | null, write: ProgressWrite): MergeResult {
  const events = write.events ?? {};
  const bump = (value: number, flag: boolean | undefined) => value + (flag ? 1 : 0);
  if (!existing) {
    const duration = write.duration_s ?? null;
    const latched = write.completed === true || reachesLatch(kind, write.position, duration);
    return {
      positionApplied: true,
      state: {
        position: write.position, duration_s: duration, completed: write.completed === false ? false : latched,
        plays: bump(write.counts?.plays ?? 0, events.play), skips: bump(write.counts?.skips ?? 0, events.skip),
        finishes: bump(write.counts?.finishes ?? 0, events.finish), marks: unionMarks([], write.marks ?? [], true), device_id: write.device_id ?? null, updated_at: write.stamp,
      },
    };
  }
  const newer = Date.parse(write.stamp) >= Date.parse(existing.updated_at);
  const position = newer ? write.position : existing.position;
  const duration = newer ? (write.duration_s ?? existing.duration_s) : (existing.duration_s ?? write.duration_s ?? null);
  // The latch: set by any write that reaches the threshold (a finish is a fact whenever it is reported), cleared only by the person,
  // with a clear newer than the row.
  let completed = existing.completed || write.completed === true || reachesLatch(kind, write.position, write.duration_s ?? duration);
  if (write.completed === false && newer) completed = false;
  return {
    positionApplied: newer,
    state: {
      position, duration_s: duration, completed,
      plays: bump(Math.max(existing.plays, write.counts?.plays ?? 0), events.play),
      skips: bump(Math.max(existing.skips, write.counts?.skips ?? 0), events.skip),
      finishes: bump(Math.max(existing.finishes, write.counts?.finishes ?? 0), events.finish),
      marks: unionMarks(existing.marks, write.marks ?? [], newer),
      device_id: newer ? (write.device_id ?? existing.device_id) : existing.device_id,
      updated_at: newer ? write.stamp : existing.updated_at,
    },
  };
}

export function stateOf(record: MediaProgress): ProgressState {
  return {
    position: record.position, duration_s: record.duration_s, completed: record.completed, plays: record.plays, skips: record.skips,
    finishes: record.finishes, marks: record.marks, device_id: record.device_id, updated_at: record.updated_at,
  };
}

// ---- storage, coalescing and the write rule ----

export type WriteRefusal = "other_persons_device" | "no_such_title" | "wrong_position_shape";
export type WriteOutcome = { ok: true; progress: MediaProgress; positionApplied: boolean; budget?: MediaBudget } | { ok: false; refusal: WriteRefusal };

function personIsMinor(person: Parameters<typeof mediaBandOf>[0]): boolean {
  return mediaBandOf(person) !== "adult";
}

/** The one write rule for a minor's row: the signed-in person must be that person (routes only ever write the signed-in person's own
 * rows) and the screen must be theirs. A device paired to someone else, a shared TV signed in as a parent, never writes their row. */
export function deviceMayWrite(person: Parameters<typeof mediaBandOf>[0], deviceId: string | null | undefined): boolean {
  if (!deviceId || !personIsMinor(person)) return true;
  const device = getDeviceById(deviceId);
  return device === null || device.personId === person.id;
}

interface Pending {
  personId: string;
  mediaId: string;
  kind: ProgressKind;
  writes: ProgressWrite[];
}
const pending = new Map<string, Pending>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const lastDbWrite = new Map<string, number>();
export const progressStats = { dbWrites: 0 };
export const COALESCE_MS = 2000;

function rowFor(personId: string, mediaId: string) {
  return db.select().from(mediaProgress).where(and(eq(mediaProgress.personId, personId), eq(mediaProgress.mediaId, mediaId))).get();
}

/** Folds writes, in order, into the stored state (or none). */
function foldWrites(kind: ProgressKind, start: ProgressState | null, writes: readonly ProgressWrite[]): MergeResult {
  let state = start;
  let positionApplied = false;
  for (const write of writes) {
    const merged = mergeProgress(kind, state, write);
    state = merged.state;
    positionApplied = positionApplied || merged.positionApplied;
  }
  return { state: state!, positionApplied };
}

/** Applies writes to the row as one database write, creating the row if needed. */
function store(personId: string, mediaId: string, kind: ProgressKind, writes: readonly ProgressWrite[], serverNow: Date): { progress: MediaProgress; positionApplied: boolean } {
  const row = rowFor(personId, mediaId);
  const merged = foldWrites(kind, row ? stateOf(progressFromRow(row)) : null, writes);
  const values = {
    position: JSON.stringify(merged.state.position), durationS: merged.state.duration_s, completed: merged.state.completed, plays: merged.state.plays, skips: merged.state.skips,
    finishes: merged.state.finishes, marks: JSON.stringify(merged.state.marks), deviceId: merged.state.device_id, updatedAt: merged.state.updated_at, hlc: nextHlc(),
  };
  progressStats.dbWrites++;
  lastDbWrite.set(`${personId}|${mediaId}`, serverNow.getTime());
  if (row) {
    db.update(mediaProgress).set(values).where(eq(mediaProgress.id, row.id)).run();
  } else {
    db.insert(mediaProgress).values({ id: newMediaProgressId(), personId, mediaId, provenance: `person:${personId}`, ...values }).run();
  }
  return { progress: progressFromRow(rowFor(personId, mediaId)!), positionApplied: merged.positionApplied };
}

/** Forget held ticks before an item is permanently removed, so the timer cannot recreate its progress. */
export function discardItemProgress(mediaIds: readonly string[]): void {
  const ids = new Set(mediaIds);
  for (const [key, held] of pending) if (ids.has(held.mediaId)) pending.delete(key);
  for (const key of lastDbWrite.keys()) if (ids.has(key.slice(key.indexOf("|") + 1))) lastDbWrite.delete(key);
  if (pending.size === 0 && flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}

/** Stores every held write now. A read calls this first, so it always sees the newest state. */
export function flushProgress(personId?: string): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  for (const [key, held] of [...pending]) {
    if (personId && held.personId !== personId) continue;
    pending.delete(key);
    store(held.personId, held.mediaId, held.kind, held.writes, new Date());
  }
  if (pending.size > 0) armTimer(COALESCE_MS);
}

function armTimer(ms: number): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushProgress(); }, ms);
  flushTimer.unref?.();
}

export interface WriteOptions {
  now?: Date;
  /** Store at once: a pause, a seek, an unload, a finish, an offline batch. The 10-second cadence of a playing title is coalesced. */
  immediate?: boolean;
  coalesceMs?: number;
  /** Server-derived identity of the authenticated session or device token; the metering cursor key. Never a request field. */
  meterKey?: string;
}

const isPlainTick = (write: ProgressWrite): boolean => !write.events && write.completed === undefined && !write.counts && !write.marks;

/** One person's write for one title. The caller has already checked the title is one the person may read. */
export function writeProgress(person: Parameters<typeof mediaBandOf>[0] & { id: string }, item: Pick<MediaItem, "id" | "kind">, write: ProgressWrite, options: WriteOptions = {}): WriteOutcome {
  if (!deviceMayWrite(person, write.device_id)) return { ok: false, refusal: "other_persons_device" };
  if ((item.kind === "book") !== ("locator" in write.position)) return { ok: false, refusal: "wrong_position_shape" };
  const now = options.now ?? new Date();
  const budget = meterProgress(person, item, write, now, options.meterKey);
  const key = `${person.id}|${item.id}`;
  const window = options.coalesceMs ?? COALESCE_MS;
  const held = pending.get(key);
  const mustStore = budget.exhausted || options.immediate === true || write.events?.finish === true || write.completed !== undefined || window <= 0;
  if (!mustStore) {
    if (held) {
      // A flood from one tab: plain position ticks replace each other; anything with an event, a mark or a count is kept in order.
      const last = held.writes[held.writes.length - 1]!;
      if (isPlainTick(write) && isPlainTick(last)) held.writes[held.writes.length - 1] = write;
      else held.writes.push(write);
      return { ...viewOf(person.id, item, held.writes, now), budget };
    }
    if (now.getTime() - (lastDbWrite.get(key) ?? 0) < window) {
      pending.set(key, { personId: person.id, mediaId: item.id, kind: item.kind, writes: [write] });
      armTimer(window);
      return { ...viewOf(person.id, item, [write], now), budget };
    }
  }
  const writes = held ? [...held.writes, write] : [write];
  if (held) pending.delete(key);
  return { ok: true, ...store(person.id, item.id, item.kind, writes, now), budget };
}

/** What the row would be with the held writes applied: the answer a held write returns, without storing it. */
function viewOf(personId: string, item: Pick<MediaItem, "id" | "kind">, writes: readonly ProgressWrite[], now: Date): Extract<WriteOutcome, { ok: true }> {
  const row = rowFor(personId, item.id);
  const merged = foldWrites(item.kind, row ? stateOf(progressFromRow(row)) : null, writes);
  const base = row ? progressFromRow(row) : null;
  const progress = MediaProgress.parse({
    id: base?.id ?? "mprg-pending0000", person_id: personId, media_id: item.id, position: merged.state.position, duration_s: merged.state.duration_s, completed: merged.state.completed,
    plays: merged.state.plays, skips: merged.state.skips, finishes: merged.state.finishes, marks: merged.state.marks, device_id: merged.state.device_id,
    updated_at: merged.state.updated_at, hlc: base?.hlc ?? `${now.getTime()}:0:pending`, provenance: `person:${personId}`,
  });
  return { ok: true, progress, positionApplied: merged.positionApplied };
}

export function getProgress(personId: string, mediaId: string): MediaProgress | null {
  flushProgress(personId);
  const row = rowFor(personId, mediaId);
  return row ? progressFromRow(row) : null;
}

export function getProgressMany(personId: string, mediaIds: readonly string[]): MediaProgress[] {
  flushProgress(personId);
  if (mediaIds.length === 0) return [];
  return db.select().from(mediaProgress).where(and(eq(mediaProgress.personId, personId), inArray(mediaProgress.mediaId, [...mediaIds]))).all().map(progressFromRow);
}

/** A person's rows, newest first. */
export function recentProgress(personId: string, limit: number): MediaProgress[] {
  flushProgress(personId);
  return db.select().from(mediaProgress).where(eq(mediaProgress.personId, personId)).orderBy(desc(mediaProgress.updatedAt)).limit(limit).all().map(progressFromRow);
}


export function __resetProgressForTests(): void {
  pending.clear();
  lastDbWrite.clear();
  progressStats.dbWrites = 0;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}
