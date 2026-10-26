// AIMODELS-SETUP-01: the setup wizard's plan step reads the same job cards as Settings (shared/aiChoices.ts) and turns one
// pick per job into the disk plan rows to install. Pure: cards and plan in, rows and settings out.
import type { AiCard, AiChoice, AiJobId } from "../../../../shared/aiChoices";
import type { DiskPlan } from "../../../../shared/diskPlanMath";
import { JOB_ORDER, optionsOf } from "@/apps/settings/aiGlanceRows";

/** One job as the wizard shows it. */
export interface SetupJob {
  job: AiJobId; title: string; summary: string;
  options: AiChoice[];
  /** The job cannot be turned off: one of its choices is a required row. */
  required: boolean;
}
export interface JobPick { on: boolean; choiceId: string }
export type Picks = Partial<Record<AiJobId, JobPick>>;

const rowOf = (plan: DiskPlan, id: string) => plan.rows.find((row) => row.id === id);
const specRow = (choice: AiChoice) => choice.rowIds[0] ?? "";

/** The jobs this computer offers, in the order of Settings. The wake word files are the hub's own download, not part of the install plan, so it is not asked here. */
export function setupJobs(cards: readonly AiCard[], plan: DiskPlan): SetupJob[] {
  return JOB_ORDER.flatMap((job) => {
    const card = cards.find((candidate) => candidate.id === job);
    const options = card ? optionsOf(card) : [];
    if (!card || job === "wakeword" || options.length === 0) return [];
    return [{ job, title: card.title, summary: card.summary, options, required: options.some((option) => rowOf(plan, specRow(option))?.need === "required") }];
  });
}

/** The picks that match the plan's own defaults, so the first screen installs exactly what the disk plan recommends. */
export function defaultPicks(jobs: readonly SetupJob[], plan: DiskPlan): Picks {
  const chosen = new Set(plan.default_selected);
  const picks: Picks = {};
  for (const { job, options, required } of jobs) {
    const selected = options.filter((option) => chosen.has(specRow(option)) || rowOf(plan, specRow(option))?.need === "required");
    const pick = selected.find((option) => option.recommended) ?? selected[0];
    picks[job] = pick ? { on: true, choiceId: pick.id } : { on: required, choiceId: (options.find((option) => option.recommended) ?? options[0]!).id };
  }
  return picks;
}

/** The disk plan rows the picks install: every required row, the plan's defaults for rows no card asks about, and the chosen model of each job that is on. */
export function selectedRows(jobs: readonly SetupJob[], plan: DiskPlan, picks: Picks): Set<string> {
  const isModel = (id: string) => rowOf(plan, id)?.kind !== "engine";
  const asked = new Set(jobs.flatMap((job) => job.options.flatMap((option) => option.rowIds)));
  const rows = new Set<string>(plan.rows.filter((row) => row.kind !== "engine" && row.need === "required").map((row) => row.id));
  for (const id of plan.default_selected) if (!asked.has(id)) rows.add(id);
  for (const job of jobs) {
    const pick = picks[job.job];
    const choice = job.options.find((option) => option.id === pick?.choiceId);
    if (pick?.on && choice) for (const id of choice.rowIds) if (isModel(id)) rows.add(id);
  }
  return rows;
}

/** The household settings the picks carry (picture, video and music choices), saved with the install. */
export function settingsFor(jobs: readonly SetupJob[], picks: Picks): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const job of jobs) {
    const pick = picks[job.job];
    const choice = job.options.find((option) => option.id === pick?.choiceId);
    if (!choice?.setting) continue;
    const value = choice.setting.value;
    if (pick?.on) { if (typeof value === "string" || typeof value === "boolean") out[choice.setting.key] = value; }
    else if (choice.kind === "switch") out[choice.setting.key] = false;
  }
  return out;
}
