// VF-REPAIR-01 slice 1 (architect record VF-REPAIR-01-SLICE1, owner: "Bounded repair: one automatic retry per shot."): when the finished-film check fails a shot, the film
// is repaired once and rechecked; it never loops and never silently replaces a shot the person marked.
//   - A missing line or copied sound is first fixed by rebuilding the cut from the stored clips (no GPU); a new take (`take_of`) only when that shot's own clip has the fault.
//   - A frozen or black picture means a new take.
//   - Only shots the person has not marked are swapped; a kept shot is flagged and left; a skipped shot is left out of it.
//   - One new take per faulty shot, one repair pass per film, one retry per shot (`repair.retries`, shared with CREATOR-10's per-clip retake).
//   - After a second failure (or a take that could not be shown) the first take stays in the cut; both takes are kept; the card offers "Use the new take".
// Every new take passed the finished-clip check inside its own video job (a withheld take throws and the first stays); the rebuilt film passes the finished-file check
// and the lane gate again inside `assemble`. The plain lines are the architect's, word for word.
import { getMediaProduction, setShotClip, updateMediaProduction, type Production, type Shot } from "@/lib/mediaProductions";
import type { PersonRow } from "@/types";
import type { FilmEngines } from "./run";
import type { FilmPlan, FilmShotRepair } from "./plan";
import type { FilmFault, FilmFaultKind } from "./verifyFinished";
import { shotReview } from "./review";
import { speakerOfPlan } from "./speaker";

const shotsOf = (production: Production): Shot[] => production.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots));
const WHAT: Record<FilmFaultKind, string> = { no_speech: "no sound where its line should be", copied_sound: "another shot's sound", frozen: "a frozen picture", black: "a black picture" };
const WHY: Record<FilmFaultKind, string> = { no_speech: "its line had no sound", copied_sound: "it carried another shot's sound", frozen: "its picture was frozen", black: "its picture went black" };

/** The plain line for a shot's repair state, word for word from the architect's record; also what the film card's repair rows show. */
export function repairLine(n: number, repair: FilmShotRepair): string {
  switch (repair.state) {
    case "fixed": return `Shot ${n} was made again and now passes.`;
    case "failed": return `Shot ${n} still has ${WHAT[repair.fault]} after one more try. The film is ready with the first take.`;
    case "withheld": return `Shot ${n}'s new take couldn't be shown, so the first take stays.`;
    case "flagged": return `Shot ${n}, which you kept, has ${WHAT[repair.fault]}. It was left as you kept it.`;
  }
}

export const CHECKING_LINE = "Checking the finished film.";
export const REBUILDING_LINE = "Putting the film back together.";

export interface RepairInput {
  actor: PersonRow; productionId: string; plan: FilmPlan; cutId: string; musicFileId: string | null; faults: FilmFault[];
  engines: Pick<FilmEngines, "assemble" | "makeClip" | "verifyCut" | "verifyClip" | "say" | "retakeSpent">; signal: AbortSignal;
}
export interface RepairResult { cutId: string; plan: FilmPlan; lines: string[]; /** Whether anything was done (a rebuild or a new take). */ acted: boolean }

export async function repairFinishedFilm(input: RepairInput): Promise<RepairResult> {
  const { actor, productionId, engines, signal } = input;
  let plan = input.plan, cutId = input.cutId;
  const lines: string[] = [];
  let acted = false;
  const kept = plan.shots.filter((shot) => shotReview(shot) !== "skipped");
  const numberOf = (id: string): number => kept.findIndex((shot) => shot.id === id) + 1;
  const planShot = (id: string) => plan.shots.find((shot) => shot.id === id)!;
  const setRepair = (id: string, repair: FilmShotRepair) => { plan = { ...plan, shots: plan.shots.map((shot) => (shot.id === id ? { ...shot, repair } : shot)) }; };
  const clips = (): string[] => { const stored = shotsOf(getMediaProduction(actor, productionId)!); return kept.map((shot) => stored.find((item) => item.id === shot.id)?.clip_file_id).filter((id): id is string => !!id); };
  const assembleAndCheck = async (): Promise<{ cutId: string; faults: FilmFault[] | null }> => {
    const made = await engines.assemble({ plan, clipFileIds: clips(), musicFileId: input.musicFileId }, { signal });
    const verdict = engines.verifyCut ? await engines.verifyCut({ plan, cutFileId: made }, { signal }).catch(() => ({ checked: false, lines: [] as string[], faults: undefined })) : { checked: false, lines: [] as string[], faults: undefined };
    return { cutId: made, faults: verdict.checked ? verdict.faults ?? [] : null };
  };
  const putCut = (id: string) => { const current = getMediaProduction(actor, productionId)!; updateMediaProduction(actor, productionId, { finished_cut_file_ids: [...current.finished_cut_file_ids, id] }); cutId = id; };

  // The first fault of each shot decides its repair (a shot with two faults is one repair).
  const byShot = new Map<string, FilmFaultKind>();
  for (const fault of input.faults) if (!byShot.has(fault.shot_id)) byShot.set(fault.shot_id, fault.kind);
  const toTake: string[] = [], cutOnly: string[] = [];
  const stored = shotsOf(getMediaProduction(actor, productionId)!);
  for (const [id, kind] of byShot) {
    const shot = planShot(id), review = shotReview(shot), n = numberOf(id);
    if (!shot || review === "skipped" || n === 0) continue;
    if (review === "kept") {
      const flagged: FilmShotRepair = { retries: shot.repair?.retries ?? 0, fault: kind, state: "flagged" };
      lines.push(repairLine(n, flagged)); setRepair(id, flagged);
      continue;
    }
    const clipOfShot = stored.find((item) => item.id === id)?.clip_file_id;
    if ((shot.repair?.retries ?? 0) >= 1 || (clipOfShot && engines.retakeSpent?.(clipOfShot))) continue; // the one retry is spent (here, or by the clip check's own retake)
    if (kind === "no_speech" || kind === "copied_sound") {
      // The cut may have lost a clip's sound while the clip itself is fine: look at the clip alone before spending a new take.
      const clipId = stored.find((item) => item.id === id)?.clip_file_id;
      const alone = clipId && engines.verifyClip ? await engines.verifyClip({ shot, clipFileId: clipId }, { signal }).catch(() => null) : null;
      if (alone?.checked && !(alone.faults ?? []).some((f) => f.kind === kind)) cutOnly.push(id);
      else if (alone?.checked) toTake.push(id);
      else cutOnly.push(id); // not provable: the cheap repair only
    } else toTake.push(id);
  }

  let faultsNow: FilmFault[] | null = input.faults;
  if (cutOnly.length) {
    acted = true;
    engines.say?.(REBUILDING_LINE);
    const rebuilt = await assembleAndCheck();
    putCut(rebuilt.cutId);
    faultsNow = rebuilt.faults;
    for (const id of cutOnly) {
      const still = faultsNow?.find((f) => f.shot_id === id);
      if (still) lines.push(`Shot ${numberOf(id)} still has ${WHAT[still.kind]} after the film was put back together. Make it again from the shot's card.`);
    }
  }

  const accepted: Array<{ id: string; first: string; fresh: string; kind: FilmFaultKind }> = [];
  for (const id of toTake) {
    const kind = byShot.get(id)!, shot = planShot(id), n = numberOf(id);
    const row = shotsOf(getMediaProduction(actor, productionId)!).find((item) => item.id === id);
    const first = row?.clip_file_id, still = row?.picture_file_id;
    if (!first || !still) continue;
    acted = true;
    engines.say?.(`Fixing shot ${n}: ${WHY[kind]}.`);
    let fresh: string;
    try { fresh = await engines.makeClip({ shot, stillFileId: still, speaker: speakerOfPlan(plan).name, takeOf: first }, { signal }); }
    catch (error) {
      if (signal.aborted) throw error;
      const withheld: FilmShotRepair = { retries: 1, fault: kind, state: "withheld", first_clip_id: first };
      lines.push(repairLine(n, withheld)); setRepair(id, withheld);
      continue;
    }
    const alone = engines.verifyClip ? await engines.verifyClip({ shot, clipFileId: fresh }, { signal }).catch(() => null) : null;
    if (alone?.checked && (alone.faults ?? []).some((f) => f.kind === kind)) {
      const failed: FilmShotRepair = { retries: 1, fault: kind, state: "failed", first_clip_id: first, new_clip_id: fresh };
      lines.push(repairLine(n, failed)); setRepair(id, failed);
      continue;
    }
    accepted.push({ id, first, fresh, kind });
  }

  if (accepted.length) {
    let swapped = accepted;
    for (const item of swapped) setShotClip(actor.id, productionId, item.id, item.fresh);
    engines.say?.(REBUILDING_LINE);
    const rebuilt = await assembleAndCheck();
    const failing = swapped.filter((item) => rebuilt.faults === null ? false : rebuilt.faults.some((f) => f.shot_id === item.id));
    if (failing.length === 0) {
      putCut(rebuilt.cutId);
      for (const item of swapped) { const fixed: FilmShotRepair = { retries: 1, fault: item.kind, state: "fixed", first_clip_id: item.first, new_clip_id: item.fresh }; lines.push(repairLine(numberOf(item.id), fixed)); setRepair(item.id, fixed); }
    } else {
      // The film still fails on those shots: they go back to the first take. The others keep their new take, and the film is put together once more for them.
      for (const item of failing) {
        setShotClip(actor.id, productionId, item.id, item.first);
        const failed: FilmShotRepair = { retries: 1, fault: item.kind, state: "failed", first_clip_id: item.first, new_clip_id: item.fresh };
        lines.push(repairLine(numberOf(item.id), failed)); setRepair(item.id, failed);
      }
      swapped = swapped.filter((item) => !failing.includes(item));
      if (swapped.length) {
        const again = await assembleAndCheck();
        putCut(again.cutId);
        for (const item of swapped) { const fixed: FilmShotRepair = { retries: 1, fault: item.kind, state: "fixed", first_clip_id: item.first, new_clip_id: item.fresh }; lines.push(repairLine(numberOf(item.id), fixed)); setRepair(item.id, fixed); }
      }
      // With nothing swapped the cut before this pass (already the last in the production) stays as it is.
    }
  }
  return { cutId, plan, lines, acted };
}
