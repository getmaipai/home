// MUSIC-GEN-20c (slice d): word timing for a scanned Library track that has synced LRCLIB lyrics (design note 18.5a and 18.5b).
// LRCLIB times a recording that may differ from the file, so the Stack's forced aligner times the words and LRCLIB only repairs outlier lines
// (`reconcile`). Two passes: a quick one over the first sung lines (the card improves in seconds), then the whole track in the background.
// It never fails the song or the lyrics view (rule 6): every error is ignored. Logs carry counts and milliseconds only, never lyric text (rule 6a).
// Resource order: lowest priority, one track at a time.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems } from "@/db/schema";
import { readAttachment } from "@/lib/attachments";
import { readableIn } from "@/lib/media/appHost";
import { bandAllows } from "@/lib/media/band";
import type { MediaItem } from "@/lib/media/model";
import { resolveUnderRoot } from "@/lib/media/serve";
import { tryConsume } from "@/lib/rateLimiter";
import type { PersonRow } from "@/types";
import { buildLines, keepOrdered, reconcile, spaceUnanchored, type LrcLine } from "./lyricsAlign";
import { ALIGN_MAX_SECONDS, alignSong, musicStackConfigured, StackMusicError, type AlignWindow } from "./stack";
import { alignPaused, isAlignSkipCode, pauseAlign } from "./timedWords";

// The spec's generated type leaves `lyrics` as `any` (a union checked at runtime), so the stored shape is written out here: spec 0.1.322, strict.
interface TimedRow { t: number; line: string; section?: string | null; words?: { t: number; end: number; text: string }[] }
type Timed = TimedRow[];
interface Lyrics { source: string; text: string; timed?: Timed }

/** The quick pass covers about this much song, starting a few seconds before the first sung line. */
export const QUICK_WINDOW_S = 40;
export const QUICK_LEAD_S = 4;
/** LRCLIB's duration this close to the file's: its line times are shown at once. */
export const INSTANT_MATCH_S = 1;
/** A failed attempt is not repeated for this long (the receipt). */
export const RETRY_AFTER_MS = 24 * 60 * 60_000;
/** A larger file is not sent to the aligner. */
export const LIBRARY_ALIGN_MAX_BYTES = 60 * 1024 * 1024;
const REALIGN_BUCKET = { capacity: 1, refillPerSecond: 1 / 60 } as const;

let POLL_MS = 2000;
export function __setLibraryAlignPollMsForTests(ms: number | null): void { POLL_MS = ms ?? 2000; }

const running = new Set<string>();
const receipts = new Map<string, { version: string; at: number }>();
let chain: Promise<void> = Promise.resolve();
export function __resetLibraryAlignForTests(): void { running.clear(); receipts.clear(); chain = Promise.resolve(); }

const log = (stage: string, fields: Record<string, number | string>): void => {
  console.info(`[lyrics-align] ${stage} ${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(" ")}`);
};

/** Whether the track's lyrics carry line timing but no word timing yet. */
export function needsWords(lyrics: Lyrics | null | undefined): boolean {
  const timed = lyrics?.timed;
  return !!timed && timed.some((row) => row.line.trim() !== "") && !timed.some((row) => (row.words?.length ?? 0) > 0);
}

/** Instant check: LRCLIB timed a recording within a second of this file, so its line times fit and are shown as they are. */
export function lrclibMatchesFile(lrclibDurationS: number | null | undefined, fileDurationS: number | null | undefined): boolean {
  return typeof lrclibDurationS === "number" && typeof fileDurationS === "number" && Math.abs(lrclibDurationS - fileDurationS) <= INSTANT_MATCH_S;
}

/** The stretch the quick pass aligns: about 40 s from a few seconds before the first non-blank LRCLIB line, or null when there is none. */
export function quickWindow(timed: Timed): AlignWindow | null {
  const first = timed.find((row) => row.line.trim() !== "");
  if (!first) return null;
  const from = Math.max(0, Math.round((first.t - QUICK_LEAD_S) * 1000) / 1000);
  return { from_s: from, to_s: from + QUICK_WINDOW_S };
}

/** A version label for these lines (their text only: aligned times replace LRCLIB's, words are never part of it), so an attempt is remembered per version of the lyrics. */
export function lyricsVersion(timed: Timed): string {
  return createHash("sha256").update(JSON.stringify(timed.map((row) => row.line))).digest("hex").slice(0, 16);
}

/**
 * Align `timed` lines whose index is in `indexes` against the file and return the rows with words filled in. A row the aligner placed takes the
 * reconciled time and its words; every other row keeps its LRCLIB time and has no words. Times never go backwards (a row that would keeps its own).
 */
async function alignRows(bytes: Uint8Array, sha256: string, timed: Timed, indexes: number[], window: AlignWindow | null): Promise<{ rows: Timed; wordCount: number } | null> {
  if (!indexes.length) return null;
  const sourceLines = indexes.map((i) => timed[i]!.line.trim());
  const data = await alignSong(Buffer.from(bytes).toString("base64"), sha256, sourceLines.join("\n"), { pollMs: POLL_MS, origin: "owned_file", ...(window ? { window } : {}) });
  if (!data || !data.words.length) return null;
  const aligned = spaceUnanchored(keepOrdered(buildLines(data.words, data.line_starts, sourceLines)));
  const lrc: LrcLine[] = indexes.map((i) => ({ t: timed[i]!.t, text: timed[i]!.line.trim() }));
  const fixed = reconcile(aligned, lrc).lines;
  const out: Timed = timed.map(({ words: _stored, ...rest }) => ({ ...rest }));
  let previous = -Infinity; let wordCount = 0;
  const byIndex = new Map(indexes.map((index, k) => [index, fixed[k]!] as const));
  for (let i = 0; i < out.length; i++) {
    const row = out[i]!; const placed = byIndex.get(i);
    if (placed && placed.words.length && placed.t >= previous) {
      row.t = placed.t; row.words = placed.words.map(({ t, end, text }) => ({ t, end, text })); wordCount += placed.words.length;
    }
    previous = Math.max(previous, row.t);
  }
  return wordCount ? { rows: out, wordCount } : null;
}

/** Store `rows` on the item when its lyrics are still the ones that were aligned (same lines, same count). Returns whether it was written. */
function storeWords(itemId: string, version: string, rows: Timed): boolean {
  const row = db.select({ lyrics: mediaItems.lyrics }).from(mediaItems).where(eq(mediaItems.id, itemId)).get();
  if (!row?.lyrics) return false;
  let current: Lyrics;
  try { current = JSON.parse(row.lyrics) as Lyrics; } catch { return false; }
  if (!current.timed || current.timed.length !== rows.length || lyricsVersion(current.timed) !== version) return false;
  db.update(mediaItems).set({ lyrics: JSON.stringify({ ...current, timed: rows }) }).where(eq(mediaItems.id, itemId)).run();
  return true;
}

/** The track's bytes for the aligner, or null when the file cannot be read or is too big. */
function readTrack(person: PersonRow, item: MediaItem): { bytes: Uint8Array; sha256: string } | null {
  const location = item.location as { file_id?: string; root_id?: string; path?: string };
  try {
    let bytes: Uint8Array | null = null;
    if (location.file_id) {
      const read = readAttachment(person, location.file_id);
      bytes = read.ok ? read.value.bytes : null;
    } else if (location.root_id && location.path !== undefined) {
      const abs = resolveUnderRoot(item.source_id, location.path);
      if (abs) {
        const file = Bun.file(abs);
        bytes = file.size > 0 && file.size <= LIBRARY_ALIGN_MAX_BYTES ? new Uint8Array(readFileSync(abs)) : null;
      }
    }
    if (!bytes || bytes.length === 0 || bytes.length > LIBRARY_ALIGN_MAX_BYTES) return null;
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch { return null; }
}

export type AlignOutcome = "done" | "partial" | "too_long" | "paused" | "no_words" | "failed" | "skipped";

/** Both passes for one track. Never throws. */
async function run(person: PersonRow, itemId: string, opts: { lrclibDurationS?: number | null }): Promise<AlignOutcome> {
  const started = Date.now();
  try {
    const item = readableIn(person, "music", itemId);
    const lyrics = item?.lyrics as Lyrics | null | undefined;
    if (!item || !lyrics?.timed?.length || !bandAllows(person, item)) return "skipped";
    if (alignPaused() || !musicStackConfigured()) return "paused";
    const timed = lyrics.timed;
    const version = lyricsVersion(timed);
    const nonBlank = timed.map((row, i) => (row.line.trim() ? i : -1)).filter((i) => i >= 0);
    const track = readTrack(person, item);
    if (!track) { receipts.set(itemId, { version, at: Date.now() }); return "failed"; }
    log("start", { lines: timed.length, seconds: Math.round(item.duration_s ?? 0), lrclibMatch: lrclibMatchesFile(opts.lrclibDurationS, item.duration_s) ? 1 : 0 });
    let outcome: AlignOutcome = "no_words";
    try {
      // Quick pass: the first sung lines only, stored as soon as it returns.
      const window = quickWindow(timed);
      if (window) {
        const inWindow = nonBlank.filter((i) => timed[i]!.t >= window.from_s && timed[i]!.t <= window.to_s);
        const quick = await alignRows(track.bytes, track.sha256, timed, inWindow, window);
        if (quick && storeWords(itemId, version, quick.rows)) { outcome = "partial"; log("quick", { words: quick.wordCount, lines: inWindow.length, ms: Date.now() - started }); }
      }
      // Full pass: the whole track, replacing the stored words. A song over 4 minutes is a plain no-op.
      if ((item.duration_s ?? 0) > ALIGN_MAX_SECONDS) { log("too_long", { seconds: Math.round(item.duration_s ?? 0) }); return outcome === "partial" ? "partial" : "too_long"; }
      const full = await alignRows(track.bytes, track.sha256, timed, nonBlank, null);
      if (full && storeWords(itemId, version, full.rows)) { outcome = "done"; log("full", { words: full.wordCount, lines: nonBlank.length, ms: Date.now() - started }); }
    } catch (error) {
      if (error instanceof StackMusicError && isAlignSkipCode(error.code)) { pauseAlign(); return "paused"; }
      receipts.set(itemId, { version, at: Date.now() });
      log("failed", { code: error instanceof StackMusicError ? error.code : "error", ms: Date.now() - started });
      return outcome === "partial" ? "partial" : "failed";
    }
    if (outcome !== "done") receipts.set(itemId, { version, at: Date.now() });
    return outcome;
  } catch { return "failed"; }
}

/** Queue one track behind any other Library alignment; the returned promise is for tests, callers ignore it. */
function enqueue(person: PersonRow, itemId: string, opts: { lrclibDurationS?: number | null }): Promise<AlignOutcome> {
  running.add(itemId);
  const job = chain.then(() => run(person, itemId, opts)).finally(() => { running.delete(itemId); });
  chain = job.then(() => undefined, () => undefined);
  return job;
}

/**
 * Trigger: a Library track with timed lyrics and no words yet is aligned once per version of its lyrics (a failed try is not repeated for 24 h).
 * Cheap to call on every open of the track. Returns the background promise (tests), or null when nothing was started.
 */
export function startLibraryAlign(person: PersonRow, item: MediaItem, opts: { lrclibDurationS?: number | null; now?: number } = {}): Promise<AlignOutcome> | null {
  const lyrics = item.lyrics as Lyrics | null;
  if (!needsWords(lyrics) || running.has(item.id) || alignPaused(opts.now) || !musicStackConfigured()) return null;
  if (item.kind !== "track" || !bandAllows(person, item)) return null;
  const receipt = receipts.get(item.id);
  if (receipt && receipt.version === lyricsVersion(lyrics!.timed!) && (opts.now ?? Date.now()) - receipt.at < RETRY_AFTER_MS) return null;
  return enqueue(person, item.id, { lrclibDurationS: opts.lrclibDurationS });
}

export type RealignResult = { ok: true; status: 202 } | { ok: false; status: 404 | 422 | 429; error: string };

/** "Lyrics look off": ignore the stored words and run the quick then the full pass again. At most one request a minute per track. */
export function requestRealign(person: PersonRow, itemId: string, deps: { nowMs?: () => number } = {}): { result: RealignResult; done: Promise<AlignOutcome> | null } {
  const item = readableIn(person, "music", itemId);
  if (!item || item.kind !== "track" || !bandAllows(person, item)) return { result: { ok: false, status: 404, error: "That song is not in the library." }, done: null };
  if (!(item.lyrics as Lyrics | null)?.timed?.some((row) => row.line.trim() !== "")) return { result: { ok: false, status: 422, error: "These lyrics have no timing to line up. Open the song's lyrics first." }, done: null };
  if (!tryConsume(`lyrics-realign:${item.id}`, REALIGN_BUCKET, deps.nowMs?.())) return { result: { ok: false, status: 429, error: "Lyrics were just lined up again. Try again in a minute." }, done: null };
  if (running.has(item.id)) return { result: { ok: true, status: 202 }, done: null };
  receipts.delete(item.id);
  return { result: { ok: true, status: 202 }, done: enqueue(person, item.id, {}) };
}
