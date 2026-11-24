import { buildSetupJobs, type SetupCopy, type SetupJobsInput } from "../../../../shared/setupJobs";
import type { DiskPlan } from "../../../../shared/diskPlanMath";

export const fakeCopy: SetupCopy = {
  card: (key) => ({ title: key === "videos" ? "Videos" : key === "pictures" ? "Pictures" : `Job ${key}`, summary: `What ${key} does.` }),
};
/** The units the server would send for a plan (no hub parts unless a test names them). */
export function jobsFor(plan: DiskPlan, over: Partial<Omit<SetupJobsInput, "plan" | "copy">> = {}) {
  return buildSetupJobs({ copy: fakeCopy, plan, householdHasMinors: false, hub: {}, ...over });
}
