// LONGFORM-02: the script of each scene (model) and its shot list (code). The model writes action and dialogue; code turns that into shots
// with a 3 to 8 second length, a coverage pattern by scene kind and no repeated framing. Counts come from planStructure, never typed in here.
import { z } from "zod";
import type { PersonRow } from "@/types";
import { getDocument, saveDocument, type ProductionDocument } from "./documents";
import { planStructure, runsFor, type ScenePlan } from "./structure";
import { shotSecondsFor } from "@/lib/videos/editPlan";
import { askStage, type Bible, type Outline } from "./stages";
import { toSpokenText } from "@/lib/spokenText";

export const scriptSchema = z.object({
  items: z.array(z.object({ kind: z.enum(["action", "line"]), who: z.string().trim().min(1).max(80).optional(), text: z.string().trim().min(1).max(400) })).min(1).max(80),
});
export type Script = z.infer<typeof scriptSchema>;
export interface ShotSpec { id: string; framing: string; still: string; motion: string; seconds: number; line?: string; who?: string }
export interface ShotList { scene_key: string; shots: ShotSpec[] }

export const SHOT_MIN_SECONDS = 3, SHOT_MAX_SECONDS = 8, LINE_MAX_CHARS = 160;
const DIALOGUE_FRAMES = ["medium over the shoulder", "face close-up", "medium two-shot", "reaction shot", "medium single"];
const ACTION_FRAMES = ["wide establishing", "medium tracking", "extreme close-up of detail", "wide", "low angle medium"];
const MOTIONS = ["slow push in", "slow pull back", "pan left", "pan right", "static, slight handheld drift", "slow tilt up"];

function speak(text: string): string { try { return toSpokenText(text); } catch { return text; } }

/** The shot list, by code. One shot per script item, then coverage shots (an establishing shot first, reactions after lines) until the planned count. */
export function buildShotList(scene: ScenePlan, outline: Outline["scenes"][number], bible: Bible, script: Script): ShotList {
  const dialogue = script.items.filter((i) => i.kind === "line").length >= script.items.length / 2;
  const frames = dialogue ? DIALOGUE_FRAMES : ACTION_FRAMES;
  const place = bible.locations.find((l) => l.name === outline.location)?.description ?? outline.location;
  const looks = (names: string[]) => names.map((n) => { const c = bible.cast.find((x) => x.name === n); return c ? `${c.name}, ${c.description}` : n; });
  type Beat = { text: string; who?: string; line?: string; cast: string[]; kind: "establish" | "item" | "reaction" };
  let beats: Beat[] = script.items.map((i) => ({ kind: "item", text: i.text, who: i.who, line: i.kind === "line" ? i.text.slice(0, LINE_MAX_CHARS) : undefined, cast: i.who ? [i.who] : outline.cast }));
  beats = beats.slice(0, scene.shots);
  if (beats.length < scene.shots) beats.unshift({ kind: "establish", text: `${outline.location}, establishing`, cast: [] });
  for (let i = 1; beats.length < scene.shots && i < beats.length; i++) {
    if (beats[i - 1]!.line && beats[i - 1]!.kind === "item") { beats.splice(i, 0, { kind: "reaction", text: `a reaction to what was just said`, cast: outline.cast.filter((n) => n !== beats[i - 1]!.who).slice(0, 1) }); i++; }
  }
  while (beats.length < scene.shots) beats.push({ kind: "item", text: `${outline.location}, the moment holds`, cast: outline.cast });
  // LENGTH-01: each run is its own film, so a seam overlaps only inside a run; the shots of a run add up to its share of the scene plus those overlaps.
  const seconds = runsFor(beats.length).flatMap((count) => shotSecondsFor(scene.seconds * count / beats.length, count)).map((n) => Math.min(SHOT_MAX_SECONDS, Math.max(SHOT_MIN_SECONDS, n)));
  let last = "";
  const shots = beats.map((b, i): ShotSpec => {
    let framing = b.kind === "establish" ? "wide establishing" : b.kind === "reaction" ? "reaction shot" : frames[i % frames.length]!;
    if (framing === last) framing = frames[(i + 1) % frames.length]!;
    last = framing;
    const cast = looks(b.cast);
    return { id: `${scene.key}-shot-${i + 1}`, framing, still: `${framing}, ${place}${cast.length ? `, ${cast.join("; ")}` : ""}. ${b.text}`.slice(0, 600), motion: MOTIONS[i % MOTIONS.length]!, seconds: seconds[i]!, line: b.line ? speak(b.line) : undefined, who: b.who };
  });
  return { scene_key: scene.key, shots };
}

/** The model writes one scene's script from the approved outline and bible; the shot list follows by code. Both are saved. */
export async function writeScene(actor: PersonRow, productionId: string, sceneKey: string): Promise<{ ok: true; script: ProductionDocument; shotlist: ProductionDocument } | { ok: false; line: string }> {
  const t = getDocument(actor, productionId, "treatment"), b = getDocument(actor, productionId, "bible"), o = getDocument(actor, productionId, "outline");
  if (!t || !b?.approved || !o?.approved) return { ok: false, line: "Approve the bible and the outline first; scripts are written from them." };
  const seconds = (t.json as { length_seconds?: number }).length_seconds ?? 0;
  const structure = planStructure(seconds); if (!structure.ok) return structure;
  const scene = structure.plan.scenes.find((s) => s.key === sceneKey); const entry = (o.json as Outline).scenes.find((s) => s.key === sceneKey);
  if (!scene || !entry) return { ok: false, line: "That scene is not part of this production." };
  const castNames = new Set((b.json as Bible).cast.map((c) => c.name));
  const result = await askStage(
    "Write the script of one scene: an ordered list of items, each an action (what we see) or a line (one character speaks, under 20 words, plain spoken English). Use only bible character names in who. Fit about the given number of shots: between half and all of it.",
    { treatment: t.json, bible: b.json, scene: entry, scene_seconds: scene.seconds, shots: scene.shots },
    scriptSchema,
    (s) => { const stray = s.items.find((i) => i.kind === "line" && (!i.who || !castNames.has(i.who))); return stray ? `a line must name a bible character in who (got ${stray.who ?? "nobody"})` : null; },
  );
  if (!result.ok) return result;
  const script = saveDocument(actor, { productionId, kind: "script", key: sceneKey, json: result.value, source: "model" }); if (!script.ok) return script;
  const shotlist = saveDocument(actor, { productionId, kind: "shotlist", key: sceneKey, json: buildShotList(scene, entry, b.json as Bible, result.value), source: "model" });
  return shotlist.ok ? { ok: true, script: script.document, shotlist: shotlist.document } : shotlist;
}
