// FILM-ANIMATIC-01: the film as an animatic before any clip is rendered. Each planned shot's still is held for the shot's seconds with the
// plan's own motion (the Stack's kenburns step, as faceless films already do), the shot's line is shown as words, and the pieces are joined.
// No model runs, so it takes seconds. The finished file goes through the same finished-video check as every other film file (fails closed).
import type { PersonRow } from "@/types";
import { readAttachment, storeFile } from "@/lib/attachments";
import { checkImages } from "@/lib/pictures/ageCheck";
import { gateFinished } from "@/lib/pictures/laneGate";
import { extractKeyframes } from "@/lib/pictures/keyframes";
import { runStackEdit, type EditOp } from "@/lib/videos/stackEdit";
import { getMediaProduction } from "@/lib/mediaProductions";
import type { FilmPlan } from "./plan";

export type AnimaticResult = { ok: true; fileId: string; seconds: number; shots: number } | { ok: false; line: string };

type PlanShot = FilmPlan["shots"][number];

/** The steps for one shot: motion from the plan, then its line as words for the whole shot. Pure; tested without the Stack. */
export function animaticShotOps(shot: PlanShot): EditOp[] {
  const direction = shot.motion.toLowerCase();
  const pan = direction === "pan left" ? "left" : direction === "pan right" ? "right" : "none";
  const zoomFrom = direction === "zoom out" ? 1.2 : 1;
  const zoomTo = direction === "zoom out" ? 1 : direction === "zoom in" ? 1.2 : 1;
  const ops: EditOp[] = [{ op: "kenburns", zoom_from: zoomFrom, zoom_to: zoomTo, pan, duration_s: shot.seconds }];
  const line = shot.line?.trim();
  if (line) ops.push({ op: "captions", lines: [{ from_s: 0, to_s: shot.seconds, text: line.slice(0, 200) }], position: "bottom" });
  return ops;
}

export async function makeFilmAnimatic(input: { actor: PersonRow; productionId: string; plan: FilmPlan; signal?: AbortSignal }): Promise<AnimaticResult> {
  const { actor, productionId, plan, signal } = input;
  const production = getMediaProduction(actor, productionId);
  if (!production || production.owner_person_id !== actor.id) return { ok: false, line: "That film is not available to you." };
  const stored = production.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots));
  const pieces: Uint8Array[] = [];
  for (const shot of plan.shots) {
    const pictureId = stored.find((item) => item.id === shot.id)?.picture_file_id;
    if (!pictureId) return { ok: false, line: "The pictures are not ready yet. Wait for the stills, then play the animatic." };
    const picture = readAttachment(actor, pictureId);
    if (!picture.ok) return { ok: false, line: "One of the film's pictures is missing. Make that shot's picture again." };
    const piece = await runStackEdit({ inputs: [{ bytes: picture.value.bytes, ext: "png" }], ops: animaticShotOps(shot), name: `animatic-${shot.id}.mp4`, signal });
    if (!piece.ok) return { ok: false, line: piece.line };
    pieces.push(piece.bytes);
  }
  if (pieces.length === 0) return { ok: false, line: "This film has no shots yet." };
  const joined = pieces.length === 1
    ? { ok: true as const, bytes: pieces[0]!, seconds: plan.shots[0]!.seconds }
    : await runStackEdit({ inputs: pieces.map((bytes) => ({ bytes, ext: "mp4" })), ops: [{ op: "concat" }], name: "animatic.mp4", signal });
  if (!joined.ok) return { ok: false, line: joined.line };
  const frames = await extractKeyframes(joined.bytes, joined.seconds);
  if (!frames?.length) return { ok: false, line: "The animatic could not be checked, so it was not kept. Try again." };
  const checks = await checkImages(frames, "video");
  const decision = await gateFinished({ actor, kind: "video", jobId: `film-animatic:${productionId}`, adultOnly: true, checks, images: frames, prompt: plan.shots.map((shot) => shot.still).join(" ") });
  if (decision.action === "withhold") return { ok: false, line: decision.line };
  const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: joined.bytes, provenance: `video-edit:${JSON.stringify({ v: 1, kind: "film-animatic", production: productionId, shots: plan.shots.length, seconds: joined.seconds })}`, retention: "kept", name: "Film animatic", deduplicate: false });
  if (!saved.ok) return { ok: false, line: saved.error };
  return { ok: true, fileId: saved.value.id, seconds: joined.seconds ?? 0, shots: plan.shots.length };
}
