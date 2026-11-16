import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, musicJobs, people } from "@/db/schema";
import { createAttachment } from "@/lib/attachments";
import { newMusicJobId } from "@/lib/id";
import { getMusicJobFor, musicVersions, openMusicFile } from "@/lib/music/jobs";
import { saveMusicJob, liveJobs } from "@/lib/music/store";
import type { MusicJob, MusicRequest } from "@/lib/music/types";
import type { PersonRow } from "@/types";
import { fetchScoreFile, getScore, scoreEngineReady, submitScore } from "@/lib/music/scoreStack";
export type ScoreStart = { ok: true; job: MusicJob } | { ok: false; status: 400 | 404 | 409 | 503; line: string };
function failed(job: MusicJob, line: string) { job.state = "failed"; job.stage = "failed"; job.errorCode = "score_failed"; job.errorLine = line; saveMusicJob(job); liveJobs.delete(job.id); }
const scoreState = (job: MusicJob): MusicJob["state"] => job.state;
async function run(job: MusicJob, actor: PersonRow) {
  const score = job.request.score!; job.state = "running"; job.stage = "transcribing"; job.progress = .1; saveMusicJob(job);
  try {
    let turnExists = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (scoreState(job) === "cancelled") return;
      turnExists = !!db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, job.turnId!), eq(conversationTurns.personId, actor.id))).get();
      if (turnExists) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    if (!turnExists) return failed(job, "The score did not finish. Ask for it again.");
    const sourceJob = db.select().from(musicJobs).where(and(eq(musicJobs.fileId, score.sourceFileId), eq(musicJobs.personId, actor.id))).get();
    if (!sourceJob) return failed(job, "That song version is no longer available. Choose another version and try again.");
    const source = openMusicFile(actor, { ...sourceJob, request: JSON.parse(sourceJob.request), task: sourceJob.task as MusicJob["task"], state: sourceJob.state as MusicJob["state"], temporary: false } as MusicJob, score.sourceFileId);
    if (!source) return failed(job, "Home could not open that song version. Choose another version and try again.");
    const bytes = source.read(0, source.size);
    const stackId = job.stackJob ?? await submitScore(bytes); job.stackJob = stackId; saveMusicJob(job);
    for (;;) {
      const state = await getScore(stackId); if (scoreState(job) === "cancelled") return;
      job.progress = Math.max(job.progress, Math.min(.95, (state.progress ?? 0) / 100)); job.stage = state.phase ?? "transcribing"; saveMusicJob(job);
      if (state.state === "failed") return failed(job, "Home could not get the score. Check the song and try again.");
      if (state.state === "done") {
        const [midi, noteBytes] = await Promise.all([fetchScoreFile(stackId, "midi"), fetchScoreFile(stackId, "notes")]);
        const parsed = JSON.parse(new TextDecoder().decode(noteBytes)) as { notes?: Array<{ start: number; end: number; pitch: number; velocity: number }>; tempo_bpm?: number };
        const notes = Array.isArray(parsed.notes) ? parsed.notes : [];
        const result = createAttachment(actor, { conversationId: job.conversationId!, turnId: job.turnId!, mediaType: "audio/midi", bytes: midi, retention: "kept", deduplicate: false, name: `Score for ${score.sourceTitle}`, provenance: `score:${JSON.stringify({ kind: "score", made_here: true, engine: "score-gen", source_file_id: score.sourceFileId })}` });
        if (!result.ok) return failed(job, "Home could not save the MIDI file. Check your Library storage and try again.");
        job.fileId = result.value.id; score.notes = notes; score.tempoBpm = parsed.tempo_bpm ?? state.result?.tempo_bpm ?? 120; score.noteCount = notes.length;
        job.state = "done"; job.stage = "ready"; job.progress = 1; job.errorCode = null; job.errorLine = null; saveMusicJob(job); liveJobs.delete(job.id); return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch { if (scoreState(job) !== "cancelled") failed(job, "Home could not get the score. Check the song and try again."); }
}
export async function startScoreJob(input: { actor: PersonRow; songId: string; fileId: string; conversationId: string; turnId: string }): Promise<ScoreStart> {
  const root = db.select().from(musicJobs).where(and(eq(musicJobs.id, input.songId), eq(musicJobs.personId, input.actor.id))).get();
  if (!root) return { ok: false, status: 404, line: "That song is not available. Choose a song in Music and try again." };
  const rootJob = getMusicJobFor(input.actor, input.songId);
  if (!rootJob || !musicVersions(input.actor, rootJob).some((version) => version.fileId === input.fileId)) return { ok: false, status: 400, line: "Choose a version of that song, then try again." };
  if (root.state !== "done") return { ok: false, status: 409, line: "That song is still being made. Wait until it is ready, then get the score." };
  const ready = await scoreEngineReady(); if (!ready) return { ok: false, status: 503, line: "Score transcription is not installed. Add it on the AI and models page, then try again." };
  const req = JSON.parse(root.request) as MusicRequest;
  const now = new Date().toISOString(); const request: MusicRequest = { description: "", instrumental: true, seconds: root.durationS ?? 1, score: { sourceFileId: input.fileId, sourceTitle: req.title ?? "song", notes: [], tempoBpm: 120, noteCount: 0 } };
  const job: MusicJob = { id: newMusicJobId(), personId: input.actor.id, conversationId: input.conversationId, turnId: input.turnId, companionId: null, task: "score", request, stackJob: null, state: "queued", stage: "queued", progress: 0, etaSeconds: null, position: null, errorCode: null, errorLine: null, fileId: null, parentFileId: input.fileId, coverJobId: null, coverFileId: null, seed: null, durationS: null, lrc: null, timedWords: null, chosenAt: null, createdAt: now, updatedAt: now, temporary: false };
  liveJobs.set(job.id, job); saveMusicJob(job); void run(job, input.actor); return { ok: true, job };
}
export async function resumeScoreJob(job: MusicJob) { if (!job.request.score) return; const actor = db.select().from(people).where(eq(people.id, job.personId)).get() as PersonRow | undefined; if (!actor) return failed(job, "The score did not finish. Ask for it again."); liveJobs.set(job.id, job); await run(job, actor); }
