// LONGTAKE-01 (design: docs/design/long-clips-2026-11-09.md, architect APPROVED): a clip longer than one part's ceiling, made as a chain of
// parts. Part 1 comes from the words; each later part starts from the last frame of the one before; every part is a normal video job
// (so the age and surface gates, the Adult-only mark and the finished-video check are each part's own); a part with a serious finding
// from the frame check is made once more with a new seed; the parts are joined with a cut and the joined file is checked again and kept
// as one normal clip. The run record is a media production with provenance `long-take`; its parameters are in its `summary`.
import { recordLongTakeCreation, safely } from "@/lib/creations/writers";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { videoJobs } from "@/db/schema";
import type { PersonRow } from "@/types";
import { createMediaProduction, getMediaProduction, setShotClip, updateMediaProduction, type Production } from "@/lib/mediaProductions";
import { readAttachment, storeFile } from "@/lib/attachments";
import { checkImages } from "@/lib/pictures/ageCheck";
import { gateFinished } from "@/lib/pictures/laneGate";
import { extractKeyframes } from "@/lib/pictures/keyframes";
import { backgroundTurn } from "@/lib/films/engines";
import { runGenerateVideo } from "./tool";
import { makeAudienceOf, MINOR_MAKE_LINE } from "./make";
import { getVideoJobFor, type VideoJob } from "./jobs";
import { prepareContinueFrame } from "./editTool";
import { checkClipFrames } from "./frameCheck";
import { runStackEdit } from "./stackEdit";
import { joinOps } from "./editPlan";
import { clipFileOf } from "./editGate";
import { LTX25_DEFAULTS, LTX25_MAX_DEFAULTS } from "./quality";
import { laneOf } from "@/lib/pictures/lane";
import { refuseVideoPrompt, videoDenial, VIDEO_DENIAL_LINE, VIDEO_REFUSAL_LINE } from "./policy";

export const MAX_PARTS = 12;
/** A continuous take is capped here (drift builds with every part); a longer ask is a scene with cuts, which the Film maker makes. */
export const MAX_TAKE_SECONDS = 40;
export const MIN_PART_SECONDS = 3;
export const SUMMARY_LIMIT = 2000;
export const CONTINUITY = "The same scene, the same people and light, a moment later.";
export const TAKE_TOO_MUCH_LINE = "That is too much to say in one take. Shorten the words or the beats.";

export type TakeTier = "standard" | "boost" | "max";
export interface TakeParams { v: 1; prompt: string; beats: string[]; tier: TakeTier; orientation?: "landscape" | "portrait"; parts: number; per_part: number; seed?: number; styles?: string[] }

/** One part's ceiling at a level (a Stack profile that lowers it makes that part shorter, never longer). */
export function ceilingFor(tier: TakeTier): number {
  return tier === "max" ? LTX25_MAX_DEFAULTS.max_seconds : LTX25_DEFAULTS[tier === "boost" ? "boost" : "standard"].max_seconds;
}

/** Parts and seconds each for a wanted length, or a plain line when the ask cannot be met. Pure. */
export function planParts(seconds: number, tier: TakeTier): { ok: true; parts: number; perPart: number } | { ok: false; line: string } {
  const ceiling = ceilingFor(tier);
  if (!Number.isFinite(seconds) || seconds <= ceiling) return { ok: false, line: `A clip up to ${ceiling} seconds is made as one piece. Ask for a longer length to make a long take.` };
  if (seconds > MAX_TAKE_SECONDS) return { ok: false, line: `One unbroken take is at most ${MAX_TAKE_SECONDS} seconds, because a face or a room drifts a little with every part. For something longer, ask for a film or a scene, which is made from shots with cuts.` };
  const parts = Math.ceil(seconds / ceiling);
  if (parts > MAX_PARTS) return { ok: false, line: `A long take is at most ${MAX_PARTS} parts at this level. Ask for a shorter length.` };
  const perPart = Math.max(MIN_PART_SECONDS, Math.round(seconds / parts));
  return { ok: true, parts, perPart: Math.min(perPart, ceiling) };
}

/** The words for part n (0-based): part 1 as written (its beat if there is one), later parts add the continuity sentence. Pure. */
export function partPrompt(params: Pick<TakeParams, "prompt" | "beats">, index: number): string {
  const base = (params.beats[index]?.trim() || params.prompt.trim());
  const text = index === 0 ? (params.beats[0]?.trim() ? `${params.prompt.trim()} ${params.beats[0].trim()}` : base) : `${base} ${CONTINUITY}`;
  return text.slice(0, 1200);
}

export function encodeParams(params: TakeParams): { ok: true; summary: string } | { ok: false; line: string } {
  const summary = JSON.stringify(params);
  return summary.length > SUMMARY_LIMIT ? { ok: false, line: TAKE_TOO_MUCH_LINE } : { ok: true, summary };
}
export function decodeParams(summary: string): TakeParams | null {
  try { const value = JSON.parse(summary) as TakeParams; return value && value.v === 1 && typeof value.prompt === "string" && Array.isArray(value.beats) && value.parts >= 2 ? value : null; } catch { return null; }
}

export type TakeState = "running" | "done" | "stopped" | "failed";
export interface TakeProgress { id: string; state: TakeState; parts_done: number; parts_total: number; file_id: string | null; error_line: string | null }

const running = new Map<string, AbortController>();
const failures = new Map<string, string>();
const partId = (n: number) => `part-${n + 1}`;
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason ?? new Error("Aborted")); }, { once: true }); });

function ownTake(actor: PersonRow, id: string): { production: Production; params: TakeParams } | null {
  const production = getMediaProduction(actor, id);
  if (!production || production.owner_person_id !== actor.id || !production.provenance.includes('"long-take"')) return null;
  const params = decodeParams(production.summary);
  return params ? { production, params } : null;
}
const shotsOf = (p: Production) => p.episodes.flatMap((e) => e.scenes.flatMap((s) => s.shots));

export function takeProgress(actor: PersonRow, id: string): TakeProgress | null {
  const own = ownTake(actor, id); if (!own) return null;
  const done = shotsOf(own.production).filter((s) => !!s.clip_file_id).length;
  const file = own.production.finished_cut_file_ids.at(-1) ?? null;
  const state: TakeState = file ? "done" : running.has(id) ? "running" : failures.has(id) ? "failed" : "stopped";
  return { id, state, parts_done: done, parts_total: own.params.parts, file_id: file, error_line: failures.get(id) ?? null };
}

export type StartTake = { ok: true; id: string; parts: number; per_part: number } | { ok: false; status: 403 | 409 | 422; line: string };

export function startLongTake(actor: PersonRow, input: { prompt: string; seconds: number; beats?: string[]; tier?: TakeTier; orientation?: "landscape" | "portrait"; styles?: string[] }): StartTake {
  const audience = makeAudienceOf(actor);
  if (laneOf(audience) !== "adult") return { ok: false, status: 403, line: MINOR_MAKE_LINE };
  const denial = videoDenial(audience); if (denial) return { ok: false, status: 403, line: VIDEO_DENIAL_LINE[denial] };
  const prompt = input.prompt.trim(), beats = (input.beats ?? []).map((b) => b.trim()).filter(Boolean).slice(0, MAX_PARTS);
  if (prompt.length < 3) return { ok: false, status: 422, line: "Describe the video in 3 to 1200 characters, then try again." };
  for (const text of [prompt, ...beats]) {
    const refused = refuseVideoPrompt(text, { lane: "adult" }); if (refused) return { ok: false, status: 422, line: VIDEO_REFUSAL_LINE[refused] };
  }
  const tier = input.tier ?? "standard";
  const plan = planParts(input.seconds, tier); if (!plan.ok) return { ok: false, status: 422, line: plan.line };
  if ([...running.keys()].some((key) => ownTake(actor, key))) return { ok: false, status: 409, line: "A long take is already being made. Wait for it to finish or stop it first." };
  const styles = (input.styles ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 2);
  const params: TakeParams = { v: 1, prompt, beats, tier, ...(styles.length ? { styles } : {}), ...(input.orientation ? { orientation: input.orientation } : {}), parts: plan.parts, per_part: plan.perPart };
  const encoded = encodeParams(params); if (!encoded.ok) return { ok: false, status: 422, line: encoded.line };
  const made = createMediaProduction(actor, { title: "Long take", summary: encoded.summary }, "long-take");
  const shots = Array.from({ length: plan.parts }, (_, n) => ({ id: partId(n), subject_ids: [] as string[] }));
  updateMediaProduction(actor, made.id, { episodes: [{ id: "take-episode", title: "Long take", scenes: [{ id: "take-scene", title: "Long take", shots }] }] });
  launch(actor, made.id);
  return { ok: true, id: made.id, parts: plan.parts, per_part: plan.perPart };
}

/** Start again at the first part with no clip (after a restart, a stop or a failure). */
export function resumeLongTake(actor: PersonRow, id: string): TakeProgress | { line: string } | null {
  const own = ownTake(actor, id); if (!own) return null;
  if (running.has(id)) return takeProgress(actor, id);
  if (own.production.finished_cut_file_ids.length > 0) return takeProgress(actor, id);
  failures.delete(id); launch(actor, id); return takeProgress(actor, id);
}
export function cancelLongTake(actor: PersonRow, id: string): TakeProgress | null {
  if (!ownTake(actor, id)) return null;
  running.get(id)?.abort(new Error("Long take stopped."));
  return takeProgress(actor, id);
}

function partJob(actor: PersonRow, productionId: string, shot: string): VideoJob | null {
  const rows = db.select().from(videoJobs).where(and(eq(videoJobs.personId, actor.id), eq(videoJobs.state, "done"))).orderBy(desc(videoJobs.updatedAt)).limit(300).all();
  for (const row of rows) {
    let request: { production_id?: string; shot_id?: string }; try { request = JSON.parse(row.request) as typeof request; } catch { continue; }
    if (request.production_id === productionId && request.shot_id === shot) return getVideoJobFor(actor, row.id);
  }
  return null;
}

function launch(actor: PersonRow, id: string): void {
  const controller = new AbortController(); running.set(id, controller);
  void (async () => {
    try { await runTake(actor, id, controller.signal); }
    catch (error) {
      if (!controller.signal.aborted) { console.error("[long-take] failed", id, error); failures.set(id, error instanceof Error && error.message ? error.message : "The long take could not be finished. Press Resume to try again."); }
    } finally { if (running.get(id) === controller) running.delete(id); }
  })();
}

async function makePart(input: { actor: PersonRow; id: string; shot: string; params: TakeParams; index: number; seed?: number; signal: AbortSignal; turn: { conversationId: string; turnId: string } }): Promise<VideoJob> {
  const { actor, params, index, signal, turn } = input;
  const audience = makeAudienceOf(actor);
  const prompt = partPrompt(params, index);
  let prepared: Awaited<ReturnType<typeof prepareContinueFrame>> | null = null;
  if (index > 0) {
    const previous = partJob(actor, input.id, partId(index - 1));
    if (!previous) throw new Error("An earlier part is missing. Start the long take again.");
    prepared = await prepareContinueFrame({ actor, audience, source: previous, body: { prompt, tier: params.tier }, conversationId: turn.conversationId, turnId: turn.turnId, temporary: false, allowBusy: true });
    if (!prepared.ok) throw new Error(prepared.line);
  }
  const result = await runGenerateVideo({
    state: { actor, persona: null, conversationId: turn.conversationId, turnId: turn.turnId, temporary: false },
    args: { prompt, production: input.id, shot: input.shot, seconds: params.per_part, tier: params.tier, ...(params.orientation ? { orientation: params.orientation } : {}), ...(input.seed ? { seed: input.seed } : {}) },
    callId: `take-${input.id}-${input.shot}`, spoken: false, audience, ...(params.styles?.length ? { styleIds: params.styles } : {}),
    ...(prepared?.ok ? { prepared: prepared.prepared, adultOnly: prepared.adultOnly, ...(prepared.adultLock ? { adultLock: prepared.adultLock } : {}) } : {}),
  });
  const jobId = (result.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
  if (!jobId) throw new Error((result.result?.reply?.text ?? "").replace(/^No (?:new )?video was (?:made|started)\. Say this to the person in your own words and keep its meaning:\s*/, "").trim() || "A part of the long take could not be started.");
  const deadline = Date.now() + 25 * 60_000;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason ?? new Error("Aborted");
    const job = getVideoJobFor(actor, jobId);
    if (job?.state === "done") return job;
    if (job && (job.state === "failed" || job.state === "cancelled")) throw new Error("A part of the long take did not finish. Press Resume to try that part again.");
    await sleep(500, signal);
  }
  throw new Error("A part of the long take took too long. Press Resume to try again.");
}

async function seriousFindings(actor: PersonRow, job: VideoJob): Promise<number> {
  const clip = clipFileOf(actor, job); if (!clip) return 0;
  const seconds = job.files[0]?.seconds ?? job.request.seconds ?? null;
  const check = await checkClipFrames(await extractKeyframes(clip.bytes, seconds), seconds);
  return check.findings.filter((f) => f.level === "serious").length;
}

async function runTake(actor: PersonRow, id: string, signal: AbortSignal): Promise<void> {
  const own = ownTake(actor, id); if (!own) throw new Error("That long take is not available to you.");
  const { params } = own;
  const turn = backgroundTurn(actor);
  for (let index = 0; index < params.parts; index++) {
    if (signal.aborted) return;
    const shot = partId(index);
    const current = ownTake(actor, id)!;
    if (shotsOf(current.production).find((s) => s.id === shot)?.clip_file_id) continue;
    let job = await makePart({ actor, id, shot, params, index, signal, turn });
    if (await seriousFindings(actor, job) > 0) {
      const first = job;
      const second = await makePart({ actor, id, shot, params, index, seed: 1 + Math.floor(Math.random() * 2 ** 31), signal, turn });
      const keepFirst = (await seriousFindings(actor, second)) > 0;
      if (keepFirst && first.files[0]) setShotClip(actor.id, id, shot, first.files[0].id);
      job = keepFirst ? first : second;
    }
  }
  if (signal.aborted) return;
  const finished = ownTake(actor, id)!;
  const ids = shotsOf(finished.production).map((s) => s.clip_file_id);
  if (ids.some((x) => !x)) throw new Error("A part is missing. Press Resume to make it.");
  const files = ids.map((x) => readAttachment(actor, x!));
  if (files.some((f) => !f.ok)) throw new Error("A part of the long take could not be read. Press Resume to make it again.");
  const joined = await runStackEdit({ inputs: files.map((f) => ({ bytes: f.ok ? f.value.bytes : new Uint8Array(), ext: "mp4" })), ops: joinOps("cut"), name: "long-take.mp4", signal });
  if (!joined.ok) throw new Error(joined.line);
  const frames = await extractKeyframes(joined.bytes, joined.seconds);
  if (!frames?.length) throw new Error("The finished long take could not be checked, so it was not kept. Press Resume to try again.");
  const checks = await checkImages(frames, "video");
  const decision = await gateFinished({ actor, kind: "video", jobId: `long-take:${id}`, adultOnly: true, checks, images: frames, prompt: params.prompt });
  if (decision.action === "withhold") throw new Error(decision.line);
  const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: joined.bytes, provenance: `video-edit:${JSON.stringify({ v: 1, kind: "long-take", production: id, parts: params.parts, seconds: joined.seconds })}`, retention: "kept", name: "Long take", deduplicate: false });
  if (!saved.ok) throw new Error(saved.error);
  safely(() => recordLongTakeCreation(actor, { fileId: saved.value.id, productionId: id, partFileIds: ids.filter((x): x is string => !!x), seconds: joined.seconds ?? null, prompt: params.prompt }));
  updateMediaProduction(actor, id, { finished_cut_file_ids: [...finished.production.finished_cut_file_ids, saved.value.id] });
}
