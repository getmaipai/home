// LONGFORM-03: the scene runner. For each scene of an approved production: write its script and shot list if missing, then render the shot list as
// film runs (at most MAX_SHOTS_PER_RUN shots each, from planStructure) one after another, each tied to the production by parent_id and scene_key.
// Nothing renders before the bible and outline are approved. Progress is read from the film runs, so a restart resumes where it stopped.
import type { PersonRow } from "@/types";
import { startPlannedFilm } from "@/lib/films/background";
import type { FilmPlan } from "@/lib/films/plan";
import { listFilmRunsByParent } from "@/lib/films/store";
import { getDocument } from "./documents";
import { runsFor, planStructure } from "./structure";
import { writeScene, type ShotList } from "./scripts";
import type { Bible, Outline, Treatment } from "./stages";

export interface ProduceSummary { ok: boolean; line: string; scenes_done: number; scenes_total: number; run_ids: string[] }
const working = new Set<string>();
const stops = new Map<string, AbortController>();
export const isProducing = (productionId: string) => working.has(productionId);
export function stopProducing(productionId: string): boolean { const c = stops.get(productionId); if (!c) return false; c.abort(); return true; }

function planFor(chunk: ShotList["shots"], t: Treatment, bible: Bible, scene: Outline["scenes"][number], part: string): FilmPlan {
  const named = bible.cast.filter((c) => chunk.some((s) => s.still.includes(c.name))).slice(0, 6);
  const cast = (named.length ? named : bible.cast.slice(0, 1)).map((c) => ({ name: c.name, kind: "character" as const, locked: c.description.slice(0, 400) }));
  return {
    title: `${t.title}: ${scene.title}${part}`.slice(0, 80), summary: scene.beat.slice(0, 400), cast,
    shots: chunk.map((s) => ({ id: s.id, subject_ids: [], framing: s.framing, still: `${s.still} ${t.look}`.slice(0, 600), motion: s.motion, seconds: s.seconds, ...(s.line ? { line: s.line.slice(0, 160) } : {}) })),
    music: bible.music[0]?.mood.slice(0, 300) ?? "soft underscore", credits: [],
  };
}

/** Runs of one scene that already finished are skipped, so Resume continues instead of repeating. */
export async function renderScene(actor: PersonRow, productionId: string, sceneKey: string, signal?: AbortSignal): Promise<{ ok: true; run_ids: string[] } | { ok: false; line: string }> {
  const bibleDoc = getDocument(actor, productionId, "bible"), outDoc = getDocument(actor, productionId, "outline"), tDoc = getDocument(actor, productionId, "treatment");
  if (!tDoc || !bibleDoc?.approved || !outDoc?.approved) return { ok: false, line: "Approve the bible and the outline before anything is made." };
  const seconds = (tDoc.json as { length_seconds?: number }).length_seconds ?? 0;
  const structure = planStructure(seconds); if (!structure.ok) return structure;
  const scene = structure.plan.scenes.find((s) => s.key === sceneKey); const entry = (outDoc.json as Outline).scenes.find((s) => s.key === sceneKey);
  if (!scene || !entry) return { ok: false, line: "That scene is not part of this production." };
  let list = getDocument(actor, productionId, "shotlist", sceneKey);
  if (!list) { const w = await writeScene(actor, productionId, sceneKey); if (!w.ok) return w; list = w.shotlist; }
  const shots = (list.json as ShotList).shots;
  const finished = new Set(listFilmRunsByParent(actor, productionId).filter((r) => r.state === "done" && r.scene_key === sceneKey).map((r) => r.idea));
  const ids: string[] = []; let at = 0;
  for (const [i, n] of runsFor(shots.length).entries()) {
    const chunk = shots.slice(at, at + n); at += n;
    const part = scene.runs.length > 1 ? ` (part ${i + 1})` : "";
    const idea = `${productionId}:${sceneKey}:${i}`;
    if (finished.has(idea)) continue;
    if (signal?.aborted) return { ok: false, line: "Stopped. Press Resume to continue." };
    const started = startPlannedFilm({ actor, idea, plan: planFor(chunk, tDoc.json as Treatment, bibleDoc.json as Bible, entry, part), parentId: productionId, sceneKey });
    if ("line" in started) return { ok: false, line: started.line };
    ids.push(started.id);
    const end = await started.done;
    if (end?.state !== "done") return { ok: false, line: end?.error_line ?? "A scene could not be finished. Press Resume to continue." };
  }
  return { ok: true, run_ids: ids };
}

/** All scenes in order. Resolves when the production is finished or a step fails; call it without await to run in the background. */
export async function produce(actor: PersonRow, productionId: string): Promise<ProduceSummary> {
  const tDoc = getDocument(actor, productionId, "treatment");
  const structure = planStructure((tDoc?.json as { length_seconds?: number } | undefined)?.length_seconds ?? 0);
  if (!structure.ok) return { ok: false, line: structure.line, scenes_done: 0, scenes_total: 0, run_ids: [] };
  if (working.has(productionId)) return { ok: false, line: "This production is already being made.", scenes_done: 0, scenes_total: structure.plan.scenes.length, run_ids: [] };
  working.add(productionId); const control = new AbortController(); stops.set(productionId, control);
  const run_ids: string[] = []; let done = 0;
  try {
    for (const s of structure.plan.scenes) {
      const r = await renderScene(actor, productionId, s.key, control.signal);
      if (!r.ok) return { ok: false, line: r.line, scenes_done: done, scenes_total: structure.plan.scenes.length, run_ids };
      run_ids.push(...r.run_ids); done++;
    }
    return { ok: true, line: "Every scene is made.", scenes_done: done, scenes_total: structure.plan.scenes.length, run_ids };
  } finally { working.delete(productionId); stops.delete(productionId); }
}

/** What the page and the chat read: how far along, from the film runs. */
export function progressOf(actor: PersonRow, productionId: string): { producing: boolean; scenes_total: number; scenes_done: number; runs: { scene_key: string; state: string; done_steps: number; total_steps: number }[]; seconds_left: number | null } {
  const tDoc = getDocument(actor, productionId, "treatment");
  const structure = planStructure((tDoc?.json as { length_seconds?: number } | undefined)?.length_seconds ?? 0);
  const runs = listFilmRunsByParent(actor, productionId);
  const plan = structure.ok ? structure.plan : null;
  const scenes_done = plan ? plan.scenes.filter((s) => { const mine = runs.filter((r) => r.scene_key === s.key && r.state === "done"); return mine.length >= s.runs.length; }).length : 0;
  const finished = runs.filter((r) => r.state === "done");
  const perRun = finished.length ? finished.reduce((n, r) => n + (Date.parse(r.updated_at) - Date.parse(r.created_at)), 0) / finished.length / 1000 : null;
  const runsLeft = plan ? plan.totalRuns - finished.length : 0;
  return { producing: working.has(productionId), scenes_total: plan?.scenes.length ?? 0, scenes_done, runs: runs.map((r) => ({ scene_key: r.scene_key ?? "", state: r.state, done_steps: r.done_steps, total_steps: r.total_steps })), seconds_left: perRun === null ? null : Math.round(perRun * runsLeft) };
}
