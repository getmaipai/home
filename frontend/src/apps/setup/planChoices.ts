// The setup wizard's plan step: one on/off pick per unit (a Stack feature row at its recommended level, plus the hub's own parts),
// turned into the disk plan rows to install. Pure: units and plan in, rows out. The units come from the server (shared/setupJobs.ts).
import type { DiskPlan } from "../../../../shared/diskPlanMath";
import type { SetupJob, SetupJobId } from "../../../../shared/setupJobs";

export type { SetupJob };
export type Picks = Partial<Record<SetupJobId, boolean>>;

/** The picks the plan recommends: on for a required unit, a unit with recommended rows and a hub part that can be installed now. */
export function defaultPicks(jobs: readonly SetupJob[]): Picks {
  const picks: Picks = {};
  for (const job of jobs) picks[job.job] = job.required || (job.defaultOn && job.blocked === null);
  return picks;
}

/** The disk plan rows the picks install: every required row, the plan's defaults for rows no unit asks about, and the rows of each unit that is on. */
export function selectedRows(jobs: readonly SetupJob[], plan: DiskPlan, picks: Picks): Set<string> {
  const isModel = (id: string) => plan.rows.find((row) => row.id === id)?.kind !== "engine";
  const asked = new Set(jobs.flatMap((job) => plan.rows.filter((row) => row.feature && row.feature === featureOf(plan, job)).map((row) => row.id)));
  const rows = new Set<string>(plan.rows.filter((row) => row.kind !== "engine" && row.need === "required").map((row) => row.id));
  for (const id of plan.default_selected) if (!asked.has(id)) rows.add(id);
  for (const job of jobs) if (picks[job.job] === true) for (const id of job.rowIds) if (isModel(id)) rows.add(id);
  return rows;
}

/** The feature row a unit's rows belong to, read from the rows themselves (the first row names it; hub parts have none). */
function featureOf(plan: DiskPlan, job: SetupJob): string | null {
  return job.hubPart ? null : plan.rows.find((row) => row.id === job.rowIds[0])?.feature ?? null;
}
