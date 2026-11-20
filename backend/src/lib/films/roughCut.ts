// ROUGH-CUT (VF-ROUGHCUT-01 Home half, FILM-ANIMATIC-01, VOICED-ROUGH-CUT-HOME-01): the ONE builder of `media.rough_cut` requests in Home.
// The silent animatic (the film's stills held for their seconds with the plan's motion, each line as words) and the voiced preview (the
// same, with each line spoken in a voice Home already has) both come through `makeRoughCut`; the Stack does the work (E3), Home builds the
// request from the plan, waits for the job, checks the file and keeps it. Adults only, and only their own films (C10).
//   Voiced rules (architect ruling VOICED-ROUGH-CUT-HOME-01): the script passes the maker's text gate BEFORE anything is sent, a failing line is
//   dropped with a plain note; a speaker the cast flags minor, or whose age Home cannot tell, gets NO voice address (the Stack uses a starter
//   voice); then `media.verify` on the file (each line heard once, at its time) and `gateFinished` for the pictures, and a failure or an
//   unchecked result means the file is not shown. Logs carry counts and timings only.
import { existsSync, readFileSync, statSync } from "node:fs";
import type { PersonRow } from "@/types";
import { readAttachment, storeFile } from "@/lib/attachments";
import { checkImages } from "@/lib/pictures/ageCheck";
import { gateFinished, laneOfPerson } from "@/lib/pictures/laneGate";
import { extractKeyframes } from "@/lib/pictures/keyframes";
import { EDIT_REMOTE_LINE, plainStackLine, stageFilesForStack } from "@/lib/videos/stackEdit";
import { isRemoteStackSelected, isStackConfigured } from "@/lib/stackEngine";
import { createStackHttp } from "@/lib/stack/http";
import { fullViewForJob, type FullView } from "@/lib/stack/fullView";
import { getMediaProduction } from "@/lib/mediaProductions";
import { db } from "@/db";
import { people, attachments } from "@/db/schema";
import { and, desc, eq, like, isNull } from "drizzle-orm";
import { speakerAgeBand } from "@/lib/ageBand";
import { resolveCast, type CastEntry } from "@/lib/cast";
import { refuseVideoPrompt } from "@/lib/videos/policy";
import { voiceForSpeech, isPresetVoice } from "@/lib/voiceForSpeech";
import { voicePresetName } from "@/lib/voiceResolve";
import { VOICE_ENGINE_DEFAULT } from "@/settings/voiceKeys";
import { verifyRoughCutBytes } from "./verifyFinished";

import type { FilmPlan } from "./plan";


type PlanShot = FilmPlan["shots"][number];

/** The `media.rough_cut` request (commons spec `stack-rough-cut-request`, `caption` from 0.1.444): the only place Home builds one. Pure; `pictures` are the paths the Stack may read, one per shot.
 *  With no `voiced` it is the silent animatic: each shot's line becomes its caption. With `voiced`, each line is spoken (and shown as words by the Stack). */
export interface RoughCutRequest {
  audience: "adult";
  shots: Array<{ id: string; picture: string; seconds: number; motion?: string; caption?: string }>;
  lines?: Array<{ shot_id: string; line: { speaker: string; text: string } }>;
  voices?: Array<{ speaker: string; voice_address?: string; minor?: boolean }>;
}
/** `withheld`: shots whose line the text gate refused. That line is neither spoken nor shown as a caption. */
export interface VoicedScript { lines: NonNullable<RoughCutRequest["lines"]>; voices: NonNullable<RoughCutRequest["voices"]>; withheld?: string[] }
export function roughCutRequest(shots: PlanShot[], pictures: string[], voiced?: VoicedScript): RoughCutRequest {
  const spoken = new Set([...(voiced?.lines ?? []).map((entry) => entry.shot_id), ...(voiced?.withheld ?? [])]);
  return { audience: "adult", shots: shots.map((shot, index) => {
    // A shot whose line is spoken is captioned by the Stack from the line itself; every other shot shows its line (if any) as words, as the silent animatic always did.
    const caption = spoken.has(shot.id) ? undefined : shot.line?.trim().slice(0, 200);
    return { id: shot.id, picture: pictures[index]!, seconds: shot.seconds, ...(shot.motion ? { motion: shot.motion } : {}), ...(caption ? { caption } : {}) };
  }), ...(voiced && voiced.lines.length > 0 ? { lines: voiced.lines, voices: voiced.voices } : {}) };
}
/** The silent animatic's request. */
export const animaticRequest = (shots: PlanShot[], pictures: string[]): RoughCutRequest => roughCutRequest(shots, pictures);
export type AnimaticRequest = RoughCutRequest;

export const ANIMATIC_OLD_STACK_LINE = "The storyboard could not be made. The AI engine does not have the storyboard step yet. Update it, then try again.";
export const ANIMATIC_FAILED_LINE = "The storyboard could not be made. Try again.";
export const ANIMATIC_TIMEOUT_LINE = "The storyboard took longer than expected. Try again.";
export const ANIMATIC_MISSING_LINE = "The storyboard could not be read back. Try again.";

export interface RoughCutJobDeps {
  submit(input: Record<string, unknown>): Promise<{ id: string; state: string; reason?: string | null; result?: unknown }>;
  job(id: string): Promise<{ id: string; state: string; reason?: string | null; result?: unknown }>;
  cancel(id: string): Promise<unknown>;
  sleep(ms: number): Promise<void>;
  now(): number;
  readFile(path: string): Uint8Array | null;
}
const stack = createStackHttp({ makeError: (status, code, message) => Object.assign(new Error(message), { status, code }), noStackMessage: ANIMATIC_FAILED_LINE, unreachableMessage: ANIMATIC_FAILED_LINE });
type JobView = { id: string; state: string; reason?: string | null; result?: unknown };
/** The Stack's own sentence for a request it refused on the pictures or the plan (422 `bad_input`); anything else at submit means a Stack without this step. */
async function submitRoughCut(input: Record<string, unknown>, view?: FullView): Promise<JobView> {
  const res = await stack.request("/stack/v1/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "media.rough_cut", input }), timeoutMs: 30_000 }, view);
  const body = await res.json().catch(() => ({})) as { job?: JobView; reason?: unknown; error?: unknown; code?: unknown };
  if (res.ok && body.job) return body.job;
  if (res.status === 422 && body.code === "bad_input") return { id: "", state: "failed", reason: typeof body.reason === "string" ? body.reason : typeof body.error === "string" ? body.error : null };
  throw new Error("The Stack did not take the storyboard job.");
}
/** Test seam: answers the Stack's media routes (catalog check, job calls). */
export const __setStackHttpFetchForTests = stack.__setFetchForTests;
const realJobDeps = (view?: FullView): RoughCutJobDeps => ({
  submit: (input) => submitRoughCut(input, view),
  job: async (id) => { const res = await stack.request(`/stack/v1/jobs/${encodeURIComponent(id)}`, { method: "GET", timeoutMs: 8_000 }, view); const body = await res.json() as { job?: JobView }; if (!res.ok || !body.job) throw new Error("job"); return body.job; },
  cancel: (id) => stack.request(`/stack/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE", timeoutMs: 8_000 }, view),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  now: () => Date.now(),
  readFile: (path) => { try { if (!existsSync(path)) return null; const size = statSync(path).size; return size > 0 && size <= 1024 ** 3 ? new Uint8Array(readFileSync(path)) : null; } catch { return null; } },
});
const ACTIVE = new Set(["queued", "running", "paused", "stalled", "waiting_for_you"]);
const POLL_MS = 500, DEADLINE_MS = 20 * 60_000;

/** Runs one `media.rough_cut` job and reads its file. One plain line on any failure; a Stack older than the op answers its submit with an error, which is the `ANIMATIC_OLD_STACK_LINE`. `ms` is the wall time from submit to done. */
export async function runRoughCutJob(request: AnimaticRequest, signal: AbortSignal | undefined, deps: RoughCutJobDeps): Promise<{ ok: true; bytes: Uint8Array; seconds: number; ms: number; result: unknown; readFile(path: string): Uint8Array | null } | { ok: false; line: string }> {
  const started = deps.now();
  let job: Awaited<ReturnType<RoughCutJobDeps["submit"]>>;
  try { job = await deps.submit({ ...request }); } catch { return { ok: false, line: ANIMATIC_OLD_STACK_LINE }; }
  try {
    const deadline = started + DEADLINE_MS;
    while (ACTIVE.has(job.state)) {
      if (signal?.aborted) { void deps.cancel(job.id).catch(() => undefined); return { ok: false, line: ANIMATIC_FAILED_LINE }; }
      if (deps.now() > deadline) { void deps.cancel(job.id).catch(() => undefined); return { ok: false, line: ANIMATIC_TIMEOUT_LINE }; }
      await deps.sleep(POLL_MS);
      job = await deps.job(job.id);
    }
    if (job.state !== "done") return { ok: false, line: plainStackLine(job.reason) ?? ANIMATIC_FAILED_LINE };
    const result = (job.result ?? {}) as { file?: unknown; total_s?: unknown };
    const bytes = typeof result.file === "string" ? deps.readFile(result.file) : null;
    if (!bytes || typeof result.total_s !== "number") return { ok: false, line: ANIMATIC_MISSING_LINE };
    return { ok: true, bytes, seconds: result.total_s, ms: deps.now() - started, result, readFile: deps.readFile };
  } catch { return { ok: false, line: ANIMATIC_FAILED_LINE }; }
}

// ---- voices and the script (voiced only) ----

export const VOICED_NOT_AVAILABLE_LINE = "The voiced preview is not available yet. The AI engine does not have the storyboard step.";
const DROPPED_LINES_NOTE = (n: number) => `${n === 1 ? "One line was" : `${n} lines were`} left out of the voiced preview because ${n === 1 ? "it" : "they"} could not be used. The rest are spoken.`;

/** The storyboard step is offered only when the Stack says it has it: `media.rough_cut` in the media kinds it lists. An old, remote or silent Stack reads as not available. */
export async function roughCutAvailable(): Promise<boolean> {
  try {
    if (!isStackConfigured() || isRemoteStackSelected()) return false;
    const res = await stack.request("/stack/v1/media", { method: "GET", timeoutMs: 5_000 });
    if (!res.ok) return false;
    const body = await res.json() as { media?: { kinds?: unknown } };
    return Array.isArray(body.media?.kinds) && body.media.kinds.includes("media.rough_cut");
  } catch { return false; }
}

const bandOf = (personId: string) => { const person = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).get(); return person ? speakerAgeBand(person, new Date()) : null; };
/** The minor flag for a voice: the cast's own `minor` (`subjectFacts`), and, when Home cannot tell, assumed minor: a real subject with no person to read an age from, or a person whose age band is unknown. */
export function assumedMinor(entry: Pick<CastEntry, "minor" | "real" | "person_id">): boolean {
  if (entry.minor) return true;
  if (!entry.real) return false;
  return !entry.person_id || bandOf(entry.person_id) === null;
}

/** The plan's one speaking character (its name), else the film's narration. Never an invented name. Matches the storyboard rows. */
export function speakerOfPlan(plan: Pick<FilmPlan, "cast">): { name: string; member: FilmPlan["cast"][number] | null } {
  const characters = plan.cast.filter((entry) => entry.kind === "character");
  return characters.length === 1 ? { name: characters[0]!.name, member: characters[0]! } : { name: "Narration", member: null };
}

const asAddress = (voice: string | null | undefined): string | undefined => (voice && voice !== VOICE_ENGINE_DEFAULT && isPresetVoice(voice) ? voicePresetName(voice) ?? voice : undefined);

/** The script and voices of a plan: each kept shot's line passes the maker's text gate (a failing line is dropped), and the speaker's voice is its own choice if it has one, else the household default. A minor or unknown-age speaker is sent with NO address. */
export async function voicedScript(actor: PersonRow, plan: FilmPlan): Promise<{ script: VoicedScript; dropped: number }> {
  const { name, member } = speakerOfPlan(plan);
  const withheld: string[] = [];
  const lines: VoicedScript["lines"] = [];
  for (const shot of plan.shots.filter((entry) => (entry as { kept?: boolean }).kept !== false)) {
    const text = shot.line?.trim();
    if (!text) continue;
    if (refuseVideoPrompt(text, { lane: "adult" })) { withheld.push(shot.id); continue; }
    lines.push({ shot_id: shot.id, line: { speaker: name, text: text.slice(0, 300) } });
  }
  let minor = false, own: string | undefined;
  if (member?.subject_id) {
    const cast = await resolveCast(actor, [member.subject_id]);
    const entry = cast.members[0];
    // A subject Home cannot resolve is treated like one whose age it cannot tell.
    if (!entry) minor = true;
    else { minor = assumedMinor(entry); own = asAddress(entry.voice); }
  }
  const address = minor ? undefined : own ?? asAddress(voiceForSpeech({ actor }));
  return { script: { lines, voices: lines.length ? [{ speaker: name, ...(address ? { voice_address: address } : {}), ...(minor ? { minor: true } : {}) }] : [], withheld }, dropped: withheld.length };
}

// ---- the pipeline ----

export type RoughCutOutcome =
  | { ok: true; fileId: string; seconds: number; shots: number; lines: number; note: string | null }
  | { ok: false; line: string };
export type AnimaticResult = { ok: true; fileId: string; seconds: number; shots: number } | { ok: false; line: string };

interface StackRoughCutLineResult { shot_id: string; speaker: string; start_s: number; length_s: number; audio: string; wave?: number[] }
interface StackRoughCutResultRead { file?: string; total_s: number; shots: Array<{ id: string; start_s: number; end_s: number }>; lines: StackRoughCutLineResult[] }

/** Makes the rough cut of a planned film: `voiced` false is the silent animatic. Never throws; one plain line on any failure. */
export async function makeRoughCut(input: { actor: PersonRow; productionId: string; plan: FilmPlan; voiced: boolean; signal?: AbortSignal; deps?: RoughCutJobDeps;
  /** Test seams: the file check and the picture gate (the real ones need a Stack and ffmpeg). */
  seams?: { verify?: typeof verifyRoughCutBytes; gate?: (bytes: Uint8Array, seconds: number | null, prompt: string) => Promise<{ ok: true } | { ok: false; line: string }> } }): Promise<RoughCutOutcome> {
  const { actor, productionId, voiced, signal } = input;
  // The silent animatic has always held every planned shot; only the voiced preview leaves out a shot the person skipped.
  const plan = voiced ? { ...input.plan, shots: input.plan.shots.filter((shot) => (shot as { kept?: boolean }).kept !== false) } as FilmPlan : input.plan;
  if (actor.role === "guest" || laneOfPerson(actor) !== "adult") return { ok: false, line: "That film is not available to you." };
  const production = getMediaProduction(actor, productionId);
  if (!production || production.owner_person_id !== actor.id) return { ok: false, line: "That film is not available to you." };
  const stored = production.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots));
  if (plan.shots.length === 0) return { ok: false, line: "This film has no shots yet." };
  const kind = voiced ? "voiced preview" : "animatic";
  let script: VoicedScript | undefined, dropped = 0;
  if (voiced) {
    if (!(await roughCutAvailable())) return { ok: false, line: VOICED_NOT_AVAILABLE_LINE };
    // The script is gated BEFORE anything is sent to the Stack (rules 0 and 10).
    ({ script, dropped } = await voicedScript(actor, plan));
    if (script.lines.length === 0) return { ok: false, line: dropped > 0 ? "None of the lines could be used in the voiced preview. Change the lines, then try again." : "There are no lines to speak yet. Add a line to a shot, then make the voiced preview." };
  }
  const files: Array<{ bytes: Uint8Array; ext: string }> = [];
  for (const shot of plan.shots) {
    const pictureId = stored.find((item) => item.id === shot.id)?.picture_file_id;
    if (!pictureId) return { ok: false, line: `The pictures are not ready yet. Wait for the stills, then make the ${kind}.` };
    const picture = readAttachment(actor, pictureId);
    if (!picture.ok) return { ok: false, line: "One of the film's pictures is missing. Make that shot's picture again." };
    files.push({ bytes: picture.value.bytes, ext: "png" });
  }
  if (!isStackConfigured()) return { ok: false, line: ANIMATIC_FAILED_LINE };
  if (isRemoteStackSelected()) return { ok: false, line: EDIT_REMOTE_LINE };
  const staged = await stageFilesForStack(files);
  if (!staged) return { ok: false, line: ANIMATIC_FAILED_LINE };
  let made: Awaited<ReturnType<typeof runRoughCutJob>>;
  try { made = await runRoughCutJob(roughCutRequest(plan.shots, staged.paths, script), signal, input.deps ?? realJobDeps(fullViewForJob("adult", actor))); } finally { staged.cleanup(); }
  if (!made.ok) return { ok: false, line: made.line };
  const result = made.result as StackRoughCutResultRead;
  console.log("[film-rough-cut] %s: %d shots, %d lines, %d ms", kind, plan.shots.length, result.lines?.length ?? 0, made.ms);
  // Voiced: each line heard once, at its time, or the file is not shown. Not checked counts as a failure here.
  if (voiced) {
    const lines = result.lines ?? [];
    const lineByShot = new Map((script?.lines ?? []).map((entry) => [entry.shot_id, entry.line.text]));
    const verdict = await (input.seams?.verify ?? verifyRoughCutBytes)(made.bytes, {
      total_s: result.total_s, has_audio: lines.length > 0, signal,
      shots: result.shots.map((entry) => { const planned = plan.shots.find((shot) => shot.id === entry.id); const holds = !/^(zoom (in|out)|pan (left|right))$/i.test(planned?.motion?.trim() ?? ""); return { id: entry.id, start_s: entry.start_s, end_s: entry.end_s, held_still: holds, ...(lineByShot.has(entry.id) ? { line: lineByShot.get(entry.id)! } : {}) }; }),
    });
    if (!verdict.checked) return { ok: false, line: "The voiced preview could not be checked, so it was not kept. Try again." };
    if (verdict.lines.length > 0) return { ok: false, line: `The voiced preview did not pass its check. ${verdict.lines.join(" ")}` };
  }
  const gate = input.seams?.gate ?? (async (bytes: Uint8Array, seconds: number | null, prompt: string) => {
    const frames = await extractKeyframes(bytes, seconds);
    if (!frames?.length) return { ok: false as const, line: `The ${kind} could not be checked, so it was not kept. Try again.` };
    const checks = await checkImages(frames, "video");
    const decision = await gateFinished({ actor, kind: "video", jobId: `film-${voiced ? "rough-cut" : "animatic"}:${productionId}`, adultOnly: true, checks, images: frames, prompt });
    return decision.action === "withhold" ? { ok: false as const, line: decision.line } : { ok: true as const };
  });
  const gated = await gate(made.bytes, made.seconds, plan.shots.map((shot) => shot.still).join(" "));
  if (!gated.ok) return { ok: false, line: gated.line };
  // Kept only after every check passed. Each spoken line's audio is kept as its own file so the page can play it; the result Home stores points at those files.
  const keptLines: Array<StackRoughCutLineResult & { audio: string }> = [];
  if (voiced) {
    for (const line of result.lines ?? []) {
      const audio = made.readFile(line.audio);
      if (!audio) return { ok: false, line: ANIMATIC_MISSING_LINE };
      const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "audio/wav", bytes: audio, provenance: `voiceover:${JSON.stringify({ v: 1, source: "film-rough-cut", shot: line.shot_id })}`, retention: "kept", name: "Film line", deduplicate: false });
      if (!saved.ok) return { ok: false, line: saved.error };
      keptLines.push({ ...line, audio: `/api/files/${encodeURIComponent(saved.value.id)}/content` });
    }
  }
  const record = { v: 1, kind: voiced ? "film-rough-cut" : "film-animatic", production: productionId, shots: plan.shots.length, seconds: made.seconds, ...(voiced ? { plan: planFingerprint(plan) } : {}), ...(voiced ? { result: { total_s: result.total_s, shots: result.shots, lines: keptLines } } : {}) };
  const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: made.bytes, provenance: `video-edit:${JSON.stringify(record)}`, retention: "kept", name: voiced ? "Film voiced preview" : "Film animatic", deduplicate: false });
  if (!saved.ok) return { ok: false, line: saved.error };
  return { ok: true, fileId: saved.value.id, seconds: made.seconds ?? 0, shots: plan.shots.length, lines: keptLines.length, note: dropped > 0 ? DROPPED_LINES_NOTE(dropped) : null };
}

/** A short fingerprint of what a voiced preview was made from (each kept shot's id, length, motion and line): a preview made from other words is stale. */
export function planFingerprint(plan: Pick<FilmPlan, "shots">): string {
  const text = plan.shots.filter((shot) => (shot as { kept?: boolean }).kept !== false).map((shot) => [shot.id, shot.seconds, shot.motion, shot.line?.trim() ?? ""].join("|")).join("\n");
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16);
}

/** The newest stored voiced preview of a production: its file and the result Home kept (shots, and each line's own audio address and wave). Null when there is none. */
export function latestVoicedPreview(actor: PersonRow, productionId: string, plan?: Pick<FilmPlan, "shots">): { fileId: string; result: { total_s: number; shots: Array<{ id: string; start_s: number; end_s: number }>; lines: Array<{ shot_id: string; speaker: string; start_s: number; length_s: number; audio: string; wave?: number[] }> } } | null {
  const rows = db.select().from(attachments).where(and(eq(attachments.ownerPersonId, actor.id), like(attachments.provenance, 'video-edit:%"kind":"film-rough-cut"%'))).orderBy(desc(attachments.createdAt)).all();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.provenance.slice("video-edit:".length)) as { production?: string; plan?: string; result?: never };
      // A preview made from other shots, lengths or words than the plan has now is stale, and is not shown.
      if (parsed.production === productionId && parsed.result && (!plan || parsed.plan === planFingerprint(plan))) return { fileId: row.id, result: parsed.result };
    } catch { /* an unreadable record is not a preview */ }
  }
  return null;
}
