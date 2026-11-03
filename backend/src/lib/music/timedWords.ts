// MUSIC-GEN-20b: word timing for a made song (design note 18.5a). One background alignment per finished song version: it never blocks the card,
// never fails the song, and every error is ignored (the engine's own `lrc` stays the fallback). Lyric words and file bytes are never logged.
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { musicJobs } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { ALIGN_MAX_SECONDS, alignSong, StackMusicError } from "./stack";
import { buildLines, keepOrdered, reconcile, spaceUnanchored, type AlignedLine } from "./lyricsAlign";
import { sungLyricsFromLrc, type TimedLyric } from "./sections";
import type { MusicJob } from "./types";

let POLL_MS = 2000;
export function __setAlignPollMsForTests(ms: number | null): void { POLL_MS = ms ?? 2000; }
const running = new Set<string>();
/** The Stack said the aligner is not installed: do not send another song for a while. */
let skipUntil = 0;
const SKIP_MS = 5 * 60_000;
export function __resetWordTimingForTests(): void { skipUntil = 0; running.clear(); }

export interface TimedWordLine { t: number; line: string; section: string | null; words?: { t: number; end: number; text: string }[] }

/** The sung lines of this version, or null when it has none to time. */
export function sungLinesForTiming(job: MusicJob): TimedLyric[] | null {
  if (!job.lrc || job.request.instrumental || job.durationS === null || job.durationS > ALIGN_MAX_SECONDS) return null;
  const sung = sungLyricsFromLrc(job.lrc, job.durationS);
  return sung.length ? sung : null;
}

function save(job: MusicJob, lines: AlignedLine[]): void {
  const json = JSON.stringify(lines);
  job.timedWords = json;
  if (job.temporary) return; // the in-memory job is the stored one
  db.update(musicJobs).set({ timedWords: json, hlc: nextHlc() }).where(eq(musicJobs.id, job.id)).run();
}

/** Start the one background alignment for a finished text2music, remake or variation song. Returns the promise for tests; callers ignore it. */
export function startWordTiming(job: MusicJob, bytes: Uint8Array): Promise<void> {
  if (!["text2music", "remake", "variation"].includes(job.task) || Date.now() < skipUntil || running.has(job.id)) return Promise.resolve();
  const sung = sungLinesForTiming(job);
  if (!sung) return Promise.resolve();
  running.add(job.id);
  return (async () => {
    try {
      const sourceLines = sung.map((row) => row.line);
      const data = await alignSong(Buffer.from(bytes).toString("base64"), createHash("sha256").update(bytes).digest("hex"), sourceLines.join("\n"), { pollMs: POLL_MS });
      if (!data || !data.words.length) return;
      const aligned = spaceUnanchored(keepOrdered(buildLines(data.words, data.line_starts, sourceLines)));
      const lrcLines = sung.map((row) => ({ t: row.t, text: row.line }));
      save(job, reconcile(aligned, lrcLines).lines);
    } catch (error) {
      if (error instanceof StackMusicError && ["not_installed", "unsupported"].includes(error.code)) skipUntil = Date.now() + SKIP_MS;
    } finally { running.delete(job.id); }
  })();
}

/** The card's timed lines for a version: the engine's sung lines, with each line's words (and the aligner's start time) when the stored timing matches. */
export function timedLyricsFor(job: MusicJob): TimedWordLine[] | null {
  if (!job.lrc || job.request.instrumental) return null;
  const sung = sungLyricsFromLrc(job.lrc, job.durationS);
  const plain = sung.map(({ t, line, section }): TimedWordLine => ({ t, line, section }));
  if (!job.timedWords) return plain;
  let stored: AlignedLine[];
  try { stored = JSON.parse(job.timedWords) as AlignedLine[]; } catch { return plain; }
  if (!Array.isArray(stored) || stored.length !== sung.length) return plain;
  const valid = stored.every((row, i) => row && typeof row.t === "number" && Array.isArray(row.words) && row.text === sung[i]!.line);
  if (!valid) return plain;
  return sung.map(({ line, section }, i): TimedWordLine => {
    const row = stored[i]!;
    return { t: row.t as number, line, section, ...(row.words.length ? { words: row.words.map(({ t, end, text }) => ({ t, end, text })) } : {}) };
  });
}
