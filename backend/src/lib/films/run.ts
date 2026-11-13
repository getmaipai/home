import { getMediaProduction, setShotClip, setShotPicture, setShotVoiceLine, updateMediaProduction, clearShotArtifacts, type Production, type Shot } from "@/lib/mediaProductions";
import { synthIdOfSubject } from "@/lib/mediaSubjects";
import type { PersonRow } from "@/types";
import type { FilmPlan } from "@/lib/films/plan";

export type FilmStage = "cast" | "stills" | "clips" | "music" | "assemble" | "keep";
export class FilmStepError extends Error {
  constructor(readonly stage: FilmStage, message: string, readonly shotId?: string, cause?: unknown) { super(message, cause === undefined ? undefined : { cause }); this.name = "FilmStepError"; }
  get line(): string { return this.message; }
}
export interface FilmEngines {
  ensureSubject(input: { name: string; kind: "character" | "place" | "prop"; locked: string; /** A cast member the person picked: its subject, used as it is. */ subjectId?: string }, options: { signal: AbortSignal }): Promise<string>;
  makeStill(input: { shot: FilmPlan["shots"][number]; castLocked: string[]; /** The name of a supplied product kept hidden until this shot: its own picture is the still (a model redraws writing as nonsense). */ exactReference?: string }, options: { signal: AbortSignal }): Promise<string>;
  makeClip(input: { shot: FilmPlan["shots"][number]; stillFileId: string; /** The exact picture this clip must end on (the closing product shot follows it). */ endStillFileId?: string }, options: { signal: AbortSignal }): Promise<string>;
  /** FILM-REAL-05: how far a finished clip drifted from its starting picture (measure only; null when it cannot be measured). */
  measureClip?(input: { stillFileId: string; clipFileId: string; seconds: number }): Promise<{ first: number; middle: number; last: number } | null>;
  makeNarration?(input: { shot: FilmPlan["shots"][number] }, options: { signal: AbortSignal }): Promise<{ fileId: string; seconds: number }>;
  readNarration?(input: { fileId: string }, options: { signal: AbortSignal }): Promise<{ fileId: string; seconds: number }>;
  makeMotionClip?(input: { shot: FilmPlan["shots"][number]; stillFileId: string; narrationFileId: string; seconds: number }, options: { signal: AbortSignal }): Promise<string>;
  makeMusic(input: { brief: string; seconds: number; faceless?: boolean }, options: { signal: AbortSignal }): Promise<string>;
  assemble(input: { plan: FilmPlan; clipFileIds: string[]; /** Null when the song could not be made: a film still ends with its picture and sound. */ musicFileId: string | null }, options: { signal: AbortSignal }): Promise<string>;
  waitForIdle(): Promise<void>;
  note?: string;
  onProgress?: (progress: { stage: FilmStage; done: number; total: number; shotId?: string }) => void;
}

function productionShots(production: Production): Shot[] { return production.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots)); }
function failIfAborted(signal: AbortSignal) { if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError"); }
function lockedForShot(plan: FilmPlan, shot: FilmPlan["shots"][number]): string[] {
  return plan.cast.filter((member) => shot.still.toLocaleLowerCase().includes(member.name.toLocaleLowerCase())).map((member) => `${member.name}: ${member.locked}`);
}
function storeCast(actor: PersonRow, productionId: string, plan: FilmPlan, ids: string[]): Production {
  const current = getMediaProduction(actor, productionId)!;
  const cast = plan.cast.slice(0, ids.length).map((member, i) => ({ subject_id: ids[i]!, role: member.name, wardrobe_variant_ids: [], voice_choice: null, notes: member.locked, synth_id: synthIdOfSubject(ids[i]!) }));
  return updateMediaProduction(actor, productionId, { cast }) ?? current;
}

/** A Stack that is restarting (a deploy on this machine) answers 503 "back in about a minute". A film of many steps outlives such a restart, so a step
 *  waits and tries again instead of ending the film (found 2026-11-12: a film failed at its first still because a release restarted the Stack). */
export function isTransientStackError(error: unknown): boolean {
  const e = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  if (e.code === "stack_restarting" || e.code === "unavailable" || e.code === "stack_unavailable") return true;
  if (e.status === 502 || e.status === 503 || e.status === 504) return true;
  return /ECONNREFUSED|socket refused|fetch failed|stack is not running|is restarting|editor is restarting|back by themselves/i.test(String(e.message ?? ""));
}
let retryDelays = [10_000, 20_000, 30_000, 60_000, 60_000, 60_000, 60_000, 60_000];
export function __setFilmRetryDelaysForTests(delays: number[] | null): void { retryDelays = delays ?? [10_000, 20_000, 30_000, 60_000, 60_000, 60_000, 60_000, 60_000]; }
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError")); }, { once: true });
  });
}

async function callEngine<T>(stage: FilmStage, shotId: string | undefined, engines: FilmEngines, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  failIfAborted(signal);
  await engines.waitForIdle();
  failIfAborted(signal);
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (error) {
      if (signal.aborted) failIfAborted(signal);
      if (isTransientStackError(error) && attempt < retryDelays.length) {
        engines.note = "The picture engine was restarting, so I waited and tried again.";
        await pause(retryDelays[attempt]!, signal);
        await engines.waitForIdle();
        failIfAborted(signal);
        continue;
      }
      throw new FilmStepError(stage, "I couldn't finish that part of the film. You can try again.", shotId, error);
    }
  }
}

export async function runFilm(input: { actor: PersonRow; productionId: string; plan: FilmPlan; engines: FilmEngines; signal: AbortSignal; faceless?: boolean; /** FILM-ANIMATIC-01: make the cast and the stills, then stop so the person can play the animatic before any clip is rendered. */ stopAfterStills?: boolean }): Promise<Production> {
  const { actor, productionId, plan, engines, signal } = input;
  const faceless = input.faceless === true;
  let production = getMediaProduction(actor, productionId);
  if (!production || production.owner_person_id !== actor.id) throw new Error("That production is not available to you.");
  if (production.episodes.length === 0) {
    const episodes = [{ id: "film-episode", title: plan.title, scenes: [{ id: "film-scene", title: plan.title, shots: plan.shots.map(({ id }) => ({ id, subject_ids: [] })) }] }];
    production = updateMediaProduction(actor, productionId, { title: plan.title, summary: plan.summary, episodes, cast: [] }) ?? production;
  }

  let current = getMediaProduction(actor, productionId)!;
  const subjectIds: string[] = [];
  for (let i = 0; i < plan.cast.length; i++) {
    const role = current.cast.find((entry) => entry.role === plan.cast[i]?.name);
    if (role?.subject_id) subjectIds.push(role.subject_id);
    else {
      const member = plan.cast[i]!;
      const id = await callEngine("cast", undefined, engines, signal, () => engines.ensureSubject({ name: member.name, kind: member.kind, locked: member.locked, ...(member.subject_id ? { subjectId: member.subject_id } : {}) }, { signal }));
      subjectIds.push(id);
      current = storeCast(actor, productionId, plan, [...current.cast.map((entry) => entry.subject_id), id]);
      subjectIds.splice(0, subjectIds.length, ...current.cast.map((entry) => entry.subject_id));
      engines.onProgress?.({ stage: "cast", done: subjectIds.length, total: plan.cast.length });
    }
  }
  if (subjectIds.length && current.cast.length !== subjectIds.length) current = storeCast(actor, productionId, plan, subjectIds);

  const shotsNow = productionShots(current);
  for (let i = 0; i < plan.shots.length; i++) {
    const planned = plan.shots[i]!;
    const stored = shotsNow.find((shot) => shot.id === planned.id);
    if (!stored?.picture_file_id) {
      const fileId = await callEngine("stills", planned.id, engines, signal, () => engines.makeStill({ shot: planned, castLocked: lockedForShot(plan, planned), exactReference: plan.cast.find((member) => member.reveal_last === true && planned.still.toLocaleLowerCase().includes(member.name.toLocaleLowerCase()))?.name }, { signal }));
      setShotPicture(actor.id, productionId, planned.id, fileId);
    }
    engines.onProgress?.({ stage: "stills", done: i + 1, total: plan.shots.length, shotId: planned.id });
  }
  current = getMediaProduction(actor, productionId)!;
  if (input.stopAfterStills) return current;
  for (let i = 0; i < plan.shots.length; i++) {
    const planned = plan.shots[i]!;
    const stored = productionShots(current).find((shot) => shot.id === planned.id);
    if (!stored?.clip_file_id) {
      if (!stored?.picture_file_id) throw new FilmStepError("clips", "The shot's picture is missing.", planned.id);
      let fileId: string;
      if (faceless) {
        if (!engines.makeNarration || !engines.makeMotionClip || (stored.voice_line_id && !engines.readNarration)) throw new FilmStepError("clips", "The narration step is unavailable.", planned.id);
        const narration = stored.voice_line_id
          ? await callEngine("clips", planned.id, engines, signal, () => engines.readNarration!({ fileId: stored.voice_line_id! }, { signal }))
          : await callEngine("clips", planned.id, engines, signal, () => engines.makeNarration!({ shot: planned }, { signal }));
        if (!stored.voice_line_id) setShotVoiceLine(actor.id, productionId, planned.id, narration.fileId);
        engines.onProgress?.({ stage: "clips", done: i * 2 + 1, total: plan.shots.length * 2, shotId: planned.id });
        fileId = await callEngine("clips", planned.id, engines, signal, () => engines.makeMotionClip!({ shot: planned, stillFileId: stored.picture_file_id!, narrationFileId: narration.fileId, seconds: Math.max(planned.seconds, narration.seconds + 0.6) }, { signal }));
      } else {
        const last = plan.shots[plan.shots.length - 1]!, lastStored = productionShots(current).find((shot) => shot.id === last.id);
        const endsOnReveal = i === plan.shots.length - 2 && !!lastStored?.picture_file_id && plan.cast.some((member) => member.reveal_last === true && last.still.toLocaleLowerCase().includes(member.name.toLocaleLowerCase()));
        fileId = await callEngine("clips", planned.id, engines, signal, () => engines.makeClip({ shot: planned, stillFileId: stored.picture_file_id!, ...(endsOnReveal ? { endStillFileId: lastStored!.picture_file_id! } : {}) }, { signal }));
      }
      setShotClip(actor.id, productionId, planned.id, fileId);
      if (!faceless && engines.measureClip) { const drift = await engines.measureClip({ stillFileId: stored.picture_file_id!, clipFileId: fileId, seconds: planned.seconds }).catch(() => null); if (drift) console.log(`[film] drift ${planned.id} first ${drift.first} middle ${drift.middle} last ${drift.last}`); }
    }
    current = getMediaProduction(actor, productionId)!;
    engines.onProgress?.({ stage: "clips", done: faceless ? (i + 1) * 2 : i + 1, total: faceless ? plan.shots.length * 2 : plan.shots.length, shotId: planned.id });
  }
  current = getMediaProduction(actor, productionId)!;
  let musicFileId: string | null | undefined = current.music_line_ids[0];
  if (!musicFileId) {
    try {
      musicFileId = await callEngine("music", undefined, engines, signal, () => engines.makeMusic({ brief: faceless ? `${plan.music}, soft and underscoring a narrator` : plan.music, seconds: plan.shots.reduce((sum, shot) => sum + shot.seconds, 0), faceless }, { signal }));
      current = updateMediaProduction(actor, productionId, { music_line_ids: [...current.music_line_ids, musicFileId] })!;
    } catch (error) {
      // A failed song never fails the film: the clips are already made, so the cut is assembled without music and says so.
      if (signal.aborted || faceless || !(error instanceof FilmStepError)) throw error;
      engines.note = "The film is ready, but I couldn't make its music.";
    }
  }
  engines.onProgress?.({ stage: "music", done: 1, total: 1 });
  if (current.finished_cut_file_ids.length === 0) {
    const clips = productionShots(current).filter((shot) => plan.shots.some((p) => p.id === shot.id)).map((shot) => shot.clip_file_id).filter((id): id is string => !!id);
    const cutId = await callEngine("assemble", undefined, engines, signal, () => engines.assemble({ plan, clipFileIds: clips, musicFileId: musicFileId ?? null }, { signal }));
    engines.onProgress?.({ stage: "assemble", done: 1, total: 1 });
    current = updateMediaProduction(actor, productionId, { finished_cut_file_ids: [...current.finished_cut_file_ids, cutId] })!;
    engines.onProgress?.({ stage: "keep", done: 1, total: 1 });
  }
  return getMediaProduction(actor, productionId)!;
}

export async function redoShot(input: { actor: PersonRow; productionId: string; plan: FilmPlan; shotId: string; engines: FilmEngines; signal: AbortSignal }): Promise<Production> {
  if (!input.plan.shots.some((shot) => shot.id === input.shotId)) throw new Error("That shot is not in the film plan.");
  clearShotArtifacts(input.actor.id, input.productionId, input.shotId);
  return runFilm(input);
}

export async function changeMusic(input: { actor: PersonRow; productionId: string; plan: FilmPlan; engines: FilmEngines; signal: AbortSignal }): Promise<Production> {
  const current = getMediaProduction(input.actor, input.productionId);
  if (!current || current.owner_person_id !== input.actor.id) throw new Error("That production is not available to you.");
  const updated = updateMediaProduction(input.actor, input.productionId, { music_line_ids: [], finished_cut_file_ids: [] });
  if (!updated) throw new Error("That production is not available to you.");
  return runFilm(input);
}
