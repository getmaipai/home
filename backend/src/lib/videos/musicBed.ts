// AUDIO-PARITY-01 P2: "Add music to a clip". The instrumental is made first as an ordinary music job (fitted to the clip's length), and only
// when it is done does the one media.edit path (edit_video mix with that track) start. The edit is never started to wait for the music: the
// household queue ranks a running video job above music, so an edit that waited on its own song would block it until the wait timed out.
import type { PersonRow } from "@/types";
import { getMusicJobFor, startMusicJob } from "@/lib/music/jobs";
import { saveMusicJob } from "@/lib/music/store";
import { musicBody } from "@/lib/music/stack";
import type { MusicRequest } from "@/lib/music/types";

const WAIT_MS = 30 * 60 * 1000;
let pollMs = 1000;
export function __setMusicBedPollMsForTests(ms: number | null): void { pollMs = ms ?? 1000; }

export interface MusicBedInput {
  actor: PersonRow; conversationId: string; turnId: string; companionId?: string | null; temporary: boolean;
  description: string; seconds: number; maxSeconds: number;
}

/** Starts the instrumental; throws what startMusicJob throws (storage full, already making, and so on). */
export async function startMusicBed(input: MusicBedInput): Promise<string> {
  const request: MusicRequest = { description: input.description, instrumental: true, lyrics: "[Instrumental]", seconds: input.seconds, quality: "quick", max_seconds: input.maxSeconds };
  const body = musicBody(request, "text2music");
  const job = await startMusicJob({ actor: input.actor, conversationId: input.conversationId, turnId: input.turnId, companionId: input.companionId ?? null, temporary: input.temporary, task: "text2music", request, body, parentFileId: null });
  return job.id;
}

/** Calls `done(true)` once the song is finished, `done(false)` if it failed, was cancelled, vanished or took too long. Never throws. */
export function whenMusicDone(actor: PersonRow, id: string, done: (ok: boolean) => void | Promise<void>): void {
  const deadline = Date.now() + WAIT_MS;
  const tick = () => {
    const job = getMusicJobFor(actor, id);
    if (job?.state === "done") { void Promise.resolve(done(true)).catch(() => undefined); return; }
    if (!job || job.state === "failed" || job.state === "cancelled" || Date.now() > deadline) { void Promise.resolve(done(false)).catch(() => undefined); return; }
    setTimeout(tick, pollMs);
  };
  setTimeout(tick, pollMs);
}

/** Records the mix that waits on this song in the song's stored request, so it survives a restart. */
export function setPendingMix(actor: PersonRow, id: string, mix: NonNullable<MusicRequest["pendingMix"]>): void {
  const job = getMusicJobFor(actor, id);
  if (!job) return;
  job.request.pendingMix = mix;
  saveMusicJob(job);
}

/** Takes the waiting mix off the song. Returns true only for the caller that took it, so a mix starts once. */
export function takePendingMix(actor: PersonRow, id: string): boolean {
  const job = getMusicJobFor(actor, id);
  if (!job?.request.pendingMix) return false;
  delete job.request.pendingMix;
  saveMusicJob(job);
  return true;
}
