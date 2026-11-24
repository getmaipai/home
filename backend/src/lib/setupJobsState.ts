// The units of the setup wizard's plan step for a disk plan: the plan's rows grouped by the Stack's feature row (shared/setupJobs.ts), the
// words from the spec, and the state of the two parts the hub holds itself. The engine may not exist yet, so nothing here needs it.
import { db } from "@/db";
import { people } from "@/db/schema";
import { aiCopy } from "@/lib/aiCopy";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { FACE_FINDER_NAME, faceFinderDescription, faceFinderState } from "@/lib/visionAssets";
import { INGREDIENTS_AFTER_SETUP_LINE, INGREDIENTS_BYTES, INGREDIENTS_NAME, ingredientsDescription, ingredientsState } from "@/lib/videos/ingredientsAdapter";
import type { DiskPlan } from "../../../shared/diskPlanMath";
import { buildSetupJobs, type SetupJob } from "../../../shared/setupJobs";

/** WAN-DEFAULT-01: a child or teen lives here, so the minors-only video model is offered and starts on. */
export function householdHasMinors(): boolean {
  return db.select().from(people).all().some((person) => { const lane = laneOfPerson(person); return lane === "child" || lane === "teen"; });
}

export async function setupJobsFor(plan: DiskPlan): Promise<SetupJob[]> {
  // The face finder files install with the wizard's Install; the adapter needs a Hugging Face token and an accepted licence, so the wizard lists it and says where to add it.
  const faces = faceFinderState();
  const adapter = await ingredientsState();
  return buildSetupJobs({
    plan, copy: aiCopy, householdHasMinors: householdHasMinors(),
    hub: {
      faces: { ...faces, label: FACE_FINDER_NAME, description: faceFinderDescription() },
      ingredients: { installed: adapter.installed, bytes: INGREDIENTS_BYTES, installing: adapter.installing, failure: adapter.failure, blockedReason: adapter.installed ? null : INGREDIENTS_AFTER_SETUP_LINE, label: INGREDIENTS_NAME, description: ingredientsDescription() },
    },
  });
}
