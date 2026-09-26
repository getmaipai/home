// PROJECT-RUN-01 (docs/plans/harness-turns-and-projects-2026-09-26.md).
// spec/gen/ts/project.ts only exports the top-level `Project` type -
// project.schema.json's `$defs` (ProjectPlan, PlanStep, StepState,
// ProjectArtifact) are inlined, not exported as their own consts, and
// PlanStep's `oneOf` compiles to `z.any().superRefine(...)` (the
// generator's own shape for a JSON-schema oneOf), so `z.infer` collapses
// it to `any`. Project.parse()/safeParse() still validate every step's
// real shape at the JSON-schema boundary (store.ts uses it on every
// read and write); this hand-mirrored union is only for the runner's
// own type safety once a plan has already passed that validation.
import type { Project as ProjectT } from "@maipai/spec/gen/ts/project.js";

export type Project = ProjectT;
export type ProjectPlan = Project["plan"];
export type ProjectProvenance = Project["provenance"];
export type StepState = Project["steps"][number];
export type ProjectArtifact = Project["artifacts"][number];

interface PlanStepBase {
  id: string;
  needs: string[];
}

export interface PlanTextStep extends PlanStepBase {
  kind: "text";
  params: { role: "chat"; promptTemplate: string; inputs: string[] };
}

export interface PlanMediaStep extends PlanStepBase {
  kind: "media";
  params: { role: "image" | "video" | "music"; quality: "fast" | "everyday" | "best"; promptTemplate: string; inputs: string[] };
}

export interface PlanToolStep extends PlanStepBase {
  kind: "tool";
  params: { tool: string; args: Record<string, unknown> };
}

export interface PlanAssembleStep extends PlanStepBase {
  kind: "assemble";
  params: { assembler: string; inputs: string[] };
}

export interface PlanGateStep extends PlanStepBase {
  kind: "gate";
  params: { target: string };
}

export type PlanStep = PlanTextStep | PlanMediaStep | PlanToolStep | PlanAssembleStep | PlanGateStep;

/** `project.plan.steps` is typed `any[]` for the reason above; every
 * element already passed Project.parse()'s oneOf validation by the time
 * it reaches the runner, so this cast is the one place that trust is
 * spent. */
export function planSteps(plan: ProjectPlan): PlanStep[] {
  return plan.steps as unknown as PlanStep[];
}

export function stepStateFor(project: Project, stepId: string): StepState {
  const state = project.steps.find((s) => s.stepId === stepId);
  if (!state) throw new Error(`no StepState for step "${stepId}" - the plan and steps arrays have drifted`);
  return state;
}
