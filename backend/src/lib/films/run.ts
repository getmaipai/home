import { getMediaProduction, setShotClip, setShotPicture, updateMediaProduction, clearShotArtifacts, type Production, type Shot } from "@/lib/mediaProductions";
import type { PersonRow } from "@/types";
import type { FilmPlan } from "@/lib/films/plan";

export type FilmStage = "cast" | "stills" | "clips" | "music" | "assemble" | "keep";
export class FilmStepError extends Error {
  constructor(readonly stage: FilmStage, message: string, readonly shotId?: string) { super(message); this.name = "FilmStepError"; }
  get line(): string { return this.message; }
}
export interface FilmEngines {
  ensureSubject(input: { name: string; kind: "character" | "place" | "prop"; locked: string }, options: { signal: AbortSignal }): Promise<string>;
  makeStill(input: { shot: FilmPlan["shots"][number]; castLocked: string[] }, options: { signal: AbortSignal }): Promise<string>;
  makeClip(input: { shot: FilmPlan["shots"][number]; stillFileId: string }, options: { signal: AbortSignal }): Promise<string>;
  makeMusic(input: { brief: string; seconds: number }, options: { signal: AbortSignal }): Promise<string>;
  assemble(input: { plan: FilmPlan; clipFileIds: string[]; musicFileId: string }, options: { signal: AbortSignal }): Promise<string>;
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
  const cast = plan.cast.map((member, i) => ({ subject_id: ids[i]!, role: member.name, wardrobe_variant_ids: [], voice_choice: null, notes: member.locked }));
  return updateMediaProduction(actor, productionId, { cast }) ?? current;
}

async function callEngine<T>(stage: FilmStage, shotId: string | undefined, engines: FilmEngines, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  failIfAborted(signal);
  await engines.waitForIdle();
  failIfAborted(signal);
  try { return await fn(); }
  catch (error) {
    if (signal.aborted) failIfAborted(signal);
    throw new FilmStepError(stage, "I couldn't finish that part of the film. You can try again.", shotId);
  }
}

export async function runFilm(input: { actor: PersonRow; productionId: string; plan: FilmPlan; engines: FilmEngines; signal: AbortSignal }): Promise<Production> {
  const { actor, productionId, plan, engines, signal } = input;
  let production = getMediaProduction(actor, productionId);
  if (!production || production.owner_person_id !== actor.id) throw new Error("That production is not available to you.");
  if (production.episodes.length === 0) {
    const episodes = [{ id: "film-episode", title: plan.title, scenes: [{ id: "film-scene", title: plan.title, shots: plan.shots.map(({ id, subject_ids }) => ({ id, subject_ids })) }] }];
    production = updateMediaProduction(actor, productionId, { title: plan.title, summary: plan.summary, episodes, cast: [] }) ?? production;
  }

  let current = getMediaProduction(actor, productionId)!;
  const subjectIds: string[] = [];
  for (let i = 0; i < plan.cast.length; i++) {
    const role = current.cast.find((entry) => entry.role === plan.cast[i]?.name);
    if (role?.subject_id) subjectIds.push(role.subject_id);
    else {
      const member = plan.cast[i]!;
      const id = await callEngine("cast", undefined, engines, signal, () => engines.ensureSubject({ name: member.name, kind: member.kind, locked: member.locked }, { signal }));
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
      const fileId = await callEngine("stills", planned.id, engines, signal, () => engines.makeStill({ shot: planned, castLocked: lockedForShot(plan, planned) }, { signal }));
      setShotPicture(actor.id, productionId, planned.id, fileId);
    }
    engines.onProgress?.({ stage: "stills", done: i + 1, total: plan.shots.length, shotId: planned.id });
  }
  current = getMediaProduction(actor, productionId)!;
  for (let i = 0; i < plan.shots.length; i++) {
    const planned = plan.shots[i]!;
    const stored = productionShots(current).find((shot) => shot.id === planned.id);
    if (!stored?.clip_file_id) {
      if (!stored?.picture_file_id) throw new FilmStepError("clips", "The shot's picture is missing.", planned.id);
      const fileId = await callEngine("clips", planned.id, engines, signal, () => engines.makeClip({ shot: planned, stillFileId: stored.picture_file_id! }, { signal }));
      setShotClip(actor.id, productionId, planned.id, fileId);
    }
    current = getMediaProduction(actor, productionId)!;
    engines.onProgress?.({ stage: "clips", done: i + 1, total: plan.shots.length, shotId: planned.id });
  }
  current = getMediaProduction(actor, productionId)!;
  let musicFileId = current.music_line_ids[0];
  if (!musicFileId) {
    musicFileId = await callEngine("music", undefined, engines, signal, () => engines.makeMusic({ brief: plan.music, seconds: plan.shots.reduce((sum, shot) => sum + shot.seconds, 0) }, { signal }));
    current = updateMediaProduction(actor, productionId, { music_line_ids: [...current.music_line_ids, musicFileId] })!;
  }
  engines.onProgress?.({ stage: "music", done: 1, total: 1 });
  if (current.finished_cut_file_ids.length === 0) {
    const clips = productionShots(current).filter((shot) => plan.shots.some((p) => p.id === shot.id)).map((shot) => shot.clip_file_id).filter((id): id is string => !!id);
    const cutId = await callEngine("assemble", undefined, engines, signal, () => engines.assemble({ plan, clipFileIds: clips, musicFileId }, { signal }));
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
