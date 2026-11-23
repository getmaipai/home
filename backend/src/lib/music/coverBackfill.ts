// COVER-BACKFILL-01: songs and sounds finished before covers existed get a title (songs) and a cover, lazily, on their owner's read.
// Backfill is gentle: it runs for the person who reads, touches only their own finished jobs, starts at most two low priority
// covers a run, and never retries a refused or failed attempt within a day.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { musicJobs } from "@/db/schema";
import { getPictureJob } from "@/lib/pictures/jobs";
import { pictureEngineReady, pictureEngineStatus } from "@/lib/pictures/ready";
import { musicJobLockState } from "./lock";
import { getMusicJobFor, saveMusicJob } from "./store";
import { fallbackSongTitle } from "./songTitle";
import { startSongCover } from "./cover";
import type { MusicJob, MusicRequest } from "./types";
import type { PersonRow } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 20;
const MAX_IN_FLIGHT = 2;
/** Reads at most once every 10 minutes per person and read. */
const TRIGGER_MS = 10 * 60 * 1000;

/** Job id to the time a start was refused (no cover made), kept out of the start loop for a day. */
const refusedAttempts = new Map<string, number>();
const lastTrigger = new Map<string, number>();

function jobFromRow(row: typeof musicJobs.$inferSelect): MusicJob | null {
  try {
    const request = JSON.parse(row.request) as MusicRequest;
    return { ...row, request, task: row.task as MusicJob["task"], state: row.state as MusicJob["state"], temporary: false };
  } catch { return null; }
}

/** The actor's finished jobs that a backfill may touch: not stem splits, speech or later takes, with a file and an open lock. */
function ownFinishedJobs(actor: PersonRow): MusicJob[] {
  const rows = db.select().from(musicJobs).where(and(eq(musicJobs.personId, actor.id), eq(musicJobs.state, "done"))).all();
  return rows
    .map(jobFromRow)
    .filter((job): job is MusicJob => !!job)
    .filter((job) => job.task !== "stems" && !job.request.speech && !(job.request.takes && job.request.takes.index > 0) && !!job.fileId && musicJobLockState(job, actor) === "open")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function backfillMissingCovers(actor: PersonRow, options: { now?: number } = {}): Promise<{ titled: number; started: number; considered: number }> {
  const counts = { titled: 0, started: 0, considered: 0 };
  try {
    const now = options.now ?? Date.now();
    const jobs = ownFinishedJobs(actor);
    // Titles need no engine, so an untitled song is fixed even when no picture can start at all.
    for (const job of jobs) {
      if (!job.request.sound && !job.request.title?.trim()) {
        job.request.title = fallbackSongTitle(job.request);
        saveMusicJob(job);
        counts.titled++;
      }
    }
    let inFlight = 0;
    const candidates: MusicJob[] = [];
    for (const job of jobs) {
      if (job.coverFileId) continue;
      const picture = job.coverJobId ? getPictureJob(actor, job.coverJobId) : null;
      if (picture && (picture.state === "queued" || picture.state === "running")) { inFlight++; continue; }
      // A picture job of any other state (failed, cancelled) is only tried again once it is a day old.
      if (picture && now - Date.parse(picture.createdAt) < DAY_MS) continue;
      const refusedAt = refusedAttempts.get(job.id);
      if (refusedAt !== undefined && now - refusedAt < DAY_MS) continue;
      candidates.push(job);
    }
    const eligible = candidates.slice(0, MAX_CANDIDATES);
    counts.considered = eligible.length;
    if (!eligible.length) return counts;
    if (!(await pictureEngineReady())) return counts;
    if ((await pictureEngineStatus())?.state !== "idle") return counts;
    let slots = MAX_IN_FLIGHT - inFlight;
    for (const job of eligible) {
      if (slots <= 0) break;
      const before = job.coverJobId;
      await startSongCover(actor, job, { lowPriority: true });
      const current = getMusicJobFor(actor, job.id);
      if (current?.coverJobId && current.coverJobId !== before) { counts.started++; slots--; }
      else refusedAttempts.set(job.id, now);
    }
    return counts;
  } catch {
    // A backfill never fails the read that asked for it.
    return counts;
  }
}

/** Fire and forget, at most once every 10 minutes per person and read (songs or sounds). Never throws, never awaited by callers. */
export function maybeBackfillCovers(actor: PersonRow, scope: "songs" | "sounds"): void {
  const key = `${actor.id}:${scope}`;
  const now = Date.now();
  const last = lastTrigger.get(key);
  if (last !== undefined && now - last < TRIGGER_MS) return;
  lastTrigger.set(key, now);
  void backfillMissingCovers(actor).catch(() => {});
}

export function __resetCoverBackfillForTests(): void {
  refusedAttempts.clear();
  lastTrigger.clear();
}
