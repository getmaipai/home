// VOICED-ROUGH-CUT-HOME-01: the "Make the voiced preview" action of the Film maker page. It runs in the background (a rough cut takes a minute or more);
// the film's own card says what is happening and what went wrong (S6: the run's `note`, no new status surface). Adults and their own films only (C10):
// anyone else gets the same answer as a film that does not exist.
import type { PersonRow } from "@/types";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { isGuestRole } from "@/lib/audience";
import { getFilmRun, updateFilmRun, type FilmRun } from "./store";
import { makeRoughCut, type RoughCutOutcome } from "./roughCut";

export const VOICED_WORKING_NOTE = "Making the voiced preview. This takes a minute or two.";
const inFlight = new Set<string>();
let maker: typeof makeRoughCut = makeRoughCut;
/** Test seam. */
export function __setVoicedMakerForTests(fn: typeof makeRoughCut | null): void { maker = fn ?? makeRoughCut; }

export type VoicedStart = { ok: true; id: string; state: FilmRun["state"] } | { ok: false; status: 404 | 422; line: string; code: string };

/** Starts the voiced preview of this film for its owner. Returns at once; the card's note carries the result. */
export function startVoicedPreview(person: PersonRow, run: FilmRun | null): VoicedStart {
  if (!run || run.person_id !== person.id || isGuestRole(person.role) || laneOfPerson(person) !== "adult") return { ok: false, status: 404, line: "That film isn't available any more.", code: "gone" };
  if (!run.plan || !run.production_id) return { ok: false, status: 422, line: "The shot list is not ready yet. Wait for the plan, then make the voiced preview.", code: "not_ready" };
  // A film that is being planned or made keeps its own note (progress, verify lines); the voiced preview waits until it stops.
  if (run.state === "planning" || run.state === "running") return { ok: false, status: 422, line: "Wait for the film to finish being made, then make the voiced preview.", code: "not_ready" };
  if (inFlight.has(run.id)) return { ok: false, status: 422, line: "The voiced preview is already being made.", code: "busy" };
  inFlight.add(run.id);
  updateFilmRun(person, run.id, { note: VOICED_WORKING_NOTE });
  const { plan, production_id: productionId } = run;
  void (async () => {
    let outcome: RoughCutOutcome;
    try { outcome = await maker({ actor: person, productionId, plan, voiced: true }); } catch { outcome = { ok: false, line: "The voiced preview could not be made. Try again." }; }
    const fresh = getFilmRun(person, run.id);
    if (fresh) updateFilmRun(person, run.id, { note: outcome.ok ? outcome.note : outcome.line });
    inFlight.delete(run.id);
  })();
  return { ok: true, id: run.id, state: run.state };
}
