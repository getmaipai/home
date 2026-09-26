// PROJECT-RUN-01: one step's own execution, per kind (design record,
// "The step vocabulary"). Every function here mutates the SAME `project`
// object machine.ts's runBatch() passed in - the identical "mutate the
// shared state object in place" idiom turnMachine/machine.ts's own
// applySafety()/applyContext() actions use for TurnState, so the batch
// runner and its caller always see the one, current copy. A step throws
// a plain-words Error on any failure (a model failure, a missing input,
// an unregistered assembler, an output-safety refusal); machine.ts's
// runBatch() is the one place that catches it and marks the step failed.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { complete } from "@/lib/llm";
import { newProjectArtifactId } from "@/lib/id";
import { projectsDir } from "@/lib/paths";
import { gateText } from "./gate";
import { getAssembler } from "./assemblers";
import { stepStateFor } from "./types";
import type { Project, ProjectArtifact, PlanStep, PlanTextStep, PlanAssembleStep, PlanGateStep } from "./types";

function projectDir(project: Project): string {
  const dir = join(projectsDir, project.id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function artifactFor(project: Project, stepId: string): ProjectArtifact {
  const state = stepStateFor(project, stepId);
  const artifactId = state.artifactIds[0];
  const artifact = artifactId ? project.artifacts.find((a) => a.id === artifactId) : undefined;
  if (!artifact) throw new Error(`the "${stepId}" step produced no artifact for a later step to read`);
  return artifact;
}

function artifactText(project: Project, stepId: string): string {
  return readFileSync(artifactFor(project, stepId).path, "utf8");
}

/** `{{stepId}}` placeholders in a promptTemplate/assembler input list are
 * replaced with that step's own artifact text - simple substitution, no
 * templating engine: the vocabulary here is closed and small on purpose
 * (design record, "The step vocabulary"). */
function renderTemplate(template: string, project: Project, inputs: string[]): string {
  let text = template;
  for (const stepId of inputs) text = text.replaceAll(`{{${stepId}}}`, artifactText(project, stepId));
  return text;
}

/** Writes the artifact file, gates it (mandatory, whether or not the
 * plan declared a `gate` step - SAFETY.md), records it on both
 * `project.artifacts` and the producing step's own `artifactIds` even
 * when the gate refuses it ("finished artifacts kept" - the design
 * record's own failure-honesty rule), and throws when refused so the
 * caller marks the step failed.
 *
 * A code review before this landed found the real gap this staleness
 * check closes: machine.ts's withTimeout() only RACES a step's promise
 * against the deadline - it never cancels the underlying model call, so
 * a timed-out runTextStep() keeps running in the background after its
 * own step has already been marked "failed" (or "skipped", if the whole
 * project stopped first) and the row already saved. Without this check,
 * that late call would still land here and silently push a second
 * artifact and id onto a project that has already moved on, with
 * nothing persisting it (saveProject() never fires again) - an
 * artifact file and an in-memory mutation with no matching database
 * row. Checking the step's own current state right before the mutation
 * (never before, since a legitimate call always starts "running") is
 * enough: it can only have left "running" by way of the timeout/skip
 * paths above, and there is no real retry path that would still be
 * "running" from an unrelated attempt. */
function writeAndGateArtifact(project: Project, step: { id: string }, kind: ProjectArtifact["kind"], text: string): void {
  if (stepStateFor(project, step.id).state !== "running") return;
  const dir = projectDir(project);
  const path = join(dir, `${step.id}.md`);
  writeFileSync(path, text, "utf8");
  const verdict = gateText(project.provenance.person, text);
  const artifact: ProjectArtifact = { id: newProjectArtifactId(), kind, path, gate: verdict.gate, createdAt: new Date().toISOString() };
  project.artifacts.push(artifact);
  stepStateFor(project, step.id).artifactIds.push(artifact.id);
  if (verdict.gate === "failed") throw new Error(verdict.reason ?? `the "${step.id}" step's artifact was refused by the output-safety gate`);
}

async function runTextStep(project: Project, step: PlanTextStep): Promise<void> {
  const prompt = renderTemplate(step.params.promptTemplate, project, step.params.inputs);
  const result = await complete("chat", [{ role: "user", content: prompt }]);
  if (!result.ok) throw new Error(`the "${step.id}" step's model call failed: ${result.error}`);
  writeAndGateArtifact(project, step, "document", result.value.text);
}

function runAssembleStep(project: Project, step: PlanAssembleStep): void {
  const assembler = getAssembler(step.params.assembler);
  if (!assembler) throw new Error(`the "${step.id}" step names an assembler ("${step.params.assembler}") that isn't registered`);
  const inputs = step.params.inputs.map((stepId) => ({ stepId, text: artifactText(project, stepId) }));
  const text = assembler(inputs);
  writeAndGateArtifact(project, step, "document", text);
}

/** Re-runs the gate over its `target` step's already-produced artifacts,
 * mutating their `gate` verdict in place. Produces no new artifact of
 * its own; a target whose re-check flips passed->failed still throws,
 * the same as any other step failure. */
function runGateStep(project: Project, step: PlanGateStep): void {
  const target = stepStateFor(project, step.params.target);
  if (target.artifactIds.length === 0) throw new Error(`the "${step.id}" gate step's target ("${step.params.target}") has no artifact to check`);
  let refusedReason: string | undefined;
  for (const artifactId of target.artifactIds) {
    const artifact = project.artifacts.find((a) => a.id === artifactId);
    if (!artifact) continue;
    const verdict = gateText(project.provenance.person, readFileSync(artifact.path, "utf8"));
    artifact.gate = verdict.gate;
    if (verdict.gate === "failed") refusedReason = verdict.reason;
  }
  if (refusedReason) throw new Error(refusedReason);
}

const UNIMPLEMENTED_STEP_KINDS: Partial<Record<PlanStep["kind"], string>> = {
  media: "media steps need the Stack image role, not built yet",
  tool: "tool steps aren't wired to the runner yet",
};

/** Refuses a plan before any step ever runs - PROJECT-RUN-01's own
 * scope line ("a plan containing a media step is refused at validation
 * ... nothing half-run"). Checked once, up front, so a plan mixing an
 * implemented step with an unimplemented one never gets to run the
 * implemented half first. */
export function refusalFor(steps: PlanStep[]): string | null {
  for (const step of steps) {
    const message = UNIMPLEMENTED_STEP_KINDS[step.kind];
    if (message) return message;
  }
  return null;
}

export async function executeStep(project: Project, step: PlanStep): Promise<void> {
  switch (step.kind) {
    case "text":
      return runTextStep(project, step);
    case "assemble":
      return runAssembleStep(project, step);
    case "gate":
      return runGateStep(project, step);
    case "media":
    case "tool":
      throw new Error(UNIMPLEMENTED_STEP_KINDS[step.kind]);
  }
}
