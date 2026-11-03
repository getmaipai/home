// VIDEO-STUDIO-07: the Studio's Export. The page posts `{ clip, plan }`; this reads the plan, checks it against what the person may use (their own finished,
// unlocked clips, their own songs, the voice lines they made this session), marks the new clip never lower than any source, and starts ONE edit job
// (`startVideoEditJob`, the function trim, join and mix use) whose run is a short chain of Stack `media.edit` steps: each piece alone, the joins, then every
// voice line and song laid over in one step. The source clips are never touched; the result is a NEW clip next to the old one.
import { lockItemOfProvenance, lockState, newItemMark, type MarkSource } from "@/lib/adultLock";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { makeAudienceOf } from "./make";
import { startVideoEditJob, type EditedClip, type EditRun, type VideoJob, type VideoRequest } from "./jobs";
import { clipFileOf, clipMarkOf, editRefusal, lineMark, ownTrackFile } from "./editGate";
import { runStackEdit, type EditFile, type EditOp } from "./stackEdit";
import { songSeconds, studioClip, STUDIO_LOCKED_LINE, STUDIO_NO_CLIP_LINE, STUDIO_NO_SONG_LINE } from "./studio";
import { compileStudioPlan, planRefs, studioPlanSchema, STUDIO_NOTHING_LINE, STUDIO_PLAN_LINE, type CompiledStudio, type StudioPlan } from "./studioPlan";
import { getStudioVoice, VOICE_REF_PREFIX } from "./studioVoices";
import type { PersonRow } from "@/types";

export const STUDIO_VOICE_GONE_LINE = "A voice line is gone (it is kept for two hours). Add it again, then export.";
export const STUDIO_EXPORT_LINE = "I couldn't change that video.";

export type StudioExportResult = { ok: true; job: VideoJob } | { ok: false; status: 403 | 404 | 409 | 422; line: string; code: string };
const no = (status: 403 | 404 | 409 | 422, code: string, line: string): StudioExportResult => ({ ok: false, status, code, line });

interface Resolved {
  plan: StudioPlan;
  jobs: VideoJob[];
  videoFiles: EditFile[];
  voiceFiles: EditFile[];
  musicFiles: EditFile[];
  marks: MarkSource[];
  compiled: CompiledStudio;
}

/** Reads the posted body into a checked plan and every file it names. A refusal is one plain line; nothing has started and nothing is read for a plan that
 * names something the person may not use. */
async function resolvePlan(person: PersonRow, body: Record<string, unknown>): Promise<{ ok: true; value: Resolved } | { ok: false; status: 403 | 404 | 422; line: string; code: string }> {
  const parsed = studioPlanSchema.safeParse(body.plan);
  if (!parsed.success) return { ok: false, status: 422, code: "bad_plan", line: STUDIO_PLAN_LINE };
  const plan = parsed.data;
  const refs = planRefs(plan);
  const marks: MarkSource[] = [];

  // Voice lines first: the typed words are screened again here, before anything is read or made (the add action screened them once).
  const voices = [];
  for (const ref of refs.voice) {
    const voice = ref.startsWith(VOICE_REF_PREFIX) ? getStudioVoice(person.id, ref.slice(VOICE_REF_PREFIX.length)) : null;
    if (!voice) return { ok: false, status: 404, code: "no_voice", line: STUDIO_VOICE_GONE_LINE };
    voices.push(voice);
  }
  const audience = makeAudienceOf(person);
  const refusal = editRefusal(audience, voices.map((voice) => voice.line).join(" "));
  if (refusal) return { ok: false, status: 403, code: refusal.kind === "minor" ? "minor" : "refused", line: refusal.line };
  for (const voice of voices) { const mark = await lineMark(voice.line); if (mark) marks.push(mark); }

  // The clips: the person's own finished clips, open, whose file is still in their Library.
  const jobs: VideoJob[] = [];
  const videoFiles: EditFile[] = [];
  const cache = new Map<string, { job: VideoJob; file: EditFile }>();
  for (const ref of refs.video) {
    let known = cache.get(ref);
    if (!known) {
      const found = studioClip(person, ref);
      if (!found) return { ok: false, status: 404, code: "no_clip", line: STUDIO_NO_CLIP_LINE };
      if ("locked" in found) return { ok: false, status: 403, code: "locked", line: STUDIO_LOCKED_LINE };
      const file = clipFileOf(person, found.job);
      if (!file) return { ok: false, status: 404, code: "no_clip", line: STUDIO_NO_CLIP_LINE };
      known = { job: found.job, file };
      cache.set(ref, known);
      marks.push(await clipMarkOf(found.job));
    }
    jobs.push(known.job);
    videoFiles.push(known.file);
  }

  // The songs: the person's own audio files, not locked.
  const musicFiles: EditFile[] = [];
  const musicSeconds: Array<number | null> = [];
  for (const ref of refs.music) {
    if (ref.startsWith(VOICE_REF_PREFIX) || ref.startsWith("say:")) return { ok: false, status: 422, code: "bad_plan", line: STUDIO_PLAN_LINE };
    const track = ownTrackFile(person, ref, false, null);
    if (!track || !track.fileId) return { ok: false, status: 404, code: "no_track", line: STUDIO_NO_SONG_LINE };
    const row = db.select().from(attachments).where(eq(attachments.id, track.fileId)).get();
    if (lockState(row ? lockItemOfProvenance(row.ownerPersonId, row.provenance) : null, person) !== "open") return { ok: false, status: 403, code: "locked", line: STUDIO_LOCKED_LINE };
    if (track.mark.madeAudience === "adult-only") marks.push(track.mark);
    musicFiles.push(track.file);
    musicSeconds.push(songSeconds(person, track.fileId, track.file.bytes));
  }

  const compiled = compileStudioPlan(plan, {
    video: jobs.map((job) => job.files[0]?.seconds ?? null),
    voice: voices.map((voice) => voice.seconds),
    music: musicSeconds,
  });
  if (!compiled.ok) return { ok: false, status: 422, code: compiled.code, line: compiled.line };
  if (!compiled.value.changed) return { ok: false, status: 422, code: "nothing_to_export", line: STUDIO_NOTHING_LINE };
  const voiceFiles = voices.map((voice): EditFile => ({ bytes: voice.bytes, ext: voice.ext }));
  return { ok: true, value: { plan, jobs, videoFiles, voiceFiles, musicFiles, marks, compiled: compiled.value } };
}

const fileOf = (bytes: Uint8Array): EditFile => ({ bytes, ext: "mp4" });
const NO_SOUND = /no sound/i;

/** The work of one export: each piece on its own, the joins in order, then everything laid over, as a chain of Stack steps. Never throws; a failure is one line. */
export function studioRun(resolved: Resolved): EditRun {
  const { compiled } = resolved;
  return async (signal) => {
    const started = Date.now();
    let last: Extract<Awaited<ReturnType<typeof runStackEdit>>, { ok: true }> | null = null;
    const step = async (inputs: EditFile[], ops: EditOp[], name = "step.mp4") => {
      let result = await runStackEdit({ inputs, ops, name, signal });
      // A clip with no sound of its own cannot be turned up or down: the same step without the level is what the person asked for.
      if (!result.ok && NO_SOUND.test(result.line) && ops.some((op) => op.op === "gain")) result = await runStackEdit({ inputs, ops: ops.filter((op) => op.op !== "gain"), name, signal });
      if (result.ok) last = result;
      return result;
    };
    // 1. Each piece on its own (a piece with no steps is its whole clip).
    const pieces: EditFile[] = [];
    for (const piece of compiled.pieces) {
      const source = resolved.videoFiles[piece.index]!;
      if (piece.ops.length === 0) { pieces.push(source); continue; }
      const made = await step([source], piece.ops);
      if (!made.ok) return { ok: false, line: made.line };
      pieces.push(fileOf(made.bytes));
    }
    // 2. The joins, left to right: the film so far, then the next pieces by a cut or a crossfade.
    let film = pieces[0]!;
    let next = 1;
    for (const join of compiled.joins) {
      const made = await step([film, ...pieces.slice(next, next + join.count)], join.ops);
      if (!made.ok) return { ok: false, line: made.line };
      film = fileOf(made.bytes);
      next += join.count;
    }
    // 3. Songs, then voice lines, over the film in one step. A piece that starts inside its sound is cut out of it first.
    if (compiled.overlays.length > 0) {
      const sounds: EditFile[] = [];
      for (const overlay of compiled.overlays) {
        const source = overlay.lane === "voice" ? resolved.voiceFiles[overlay.index]! : resolved.musicFiles[overlay.index]!;
        if (overlay.trim.length === 0) { sounds.push(source); continue; }
        const cut = await step([source], overlay.trim, "sound.mp4");
        if (!cut.ok) return { ok: false, line: cut.line };
        sounds.push(fileOf(cut.bytes));
      }
      const made = await step([film, ...sounds], compiled.overlays.map((overlay) => overlay.op));
      if (!made.ok) return { ok: false, line: made.line };
      film = fileOf(made.bytes);
    }
    const end = last as { bytes: Uint8Array; seconds: number | null; width: number | null; height: number | null; audio: boolean } | null;
    if (!end) return { ok: false, line: STUDIO_PLAN_LINE };
    const clip: EditedClip = { video: end.bytes, seconds: end.seconds, width: end.width, height: end.height, audio: end.audio, ms: Date.now() - started };
    return { ok: true, clip };
  };
}

/**
 * Export: the plan the page posted, as a new clip. The same gates `edit_video` runs (the surface and age gate, the screening of typed words, the lock check
 * of every source, the audience floor), then `startVideoEditJob` like trim, join and mix. The first clip of the plan is the job's source; the old clips stay.
 */
export async function startStudioExport(person: PersonRow, body: Record<string, unknown>): Promise<StudioExportResult> {
  const read = await resolvePlan(person, body);
  if (!read.ok) return no(read.status, read.code, read.line);
  const resolved = read.value;
  const first = resolved.jobs[0]!;
  const distinct = [...new Set(resolved.jobs.map((job) => job.id))];
  const hasOverlays = resolved.compiled.overlays.length > 0;
  const change: "trim" | "join" | "mix" = hasOverlays ? "mix" : distinct.length > 1 || resolved.jobs.length > 1 ? "join" : "trim";
  const edit: NonNullable<VideoRequest["edit"]> = { from: first.id, change, ...(distinct.length > 1 ? { with: distinct.slice(1) } : {}) };
  // Never lower than the sources: an adult-only clip, song or line makes the new clip adult-only (and locked while any source still is).
  const mark = newItemMark(resolved.marks, false);
  const started = startVideoEditJob({ actor: person, conversationId: null, turnId: null, temporary: false, source: first, edit, run: studioRun(resolved), adultOnly: mark.madeAudience === "adult-only", adultLock: mark.lock });
  if (!started.ok) return no(409, "already_making", started.line);
  return { ok: true, job: started.job };
}
