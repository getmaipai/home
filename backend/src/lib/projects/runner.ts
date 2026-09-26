// PROJECT-RUN-01: start/resume/cancel for a project's own XState actor.
// Live actors sit on a globalThis registry via hotReloadState() - the
// one shared helper hotReloadState.ts's own header describes, the same
// shape llmSupervisor.ts's engine-backend state and stack/client.ts's
// job registry already use, so a `bun --hot` reload never orphans an
// in-flight project the way a plain module-level `Map` would.
import { createActor, type Actor } from "xstate";
import { hotReloadState } from "@/lib/hotReloadState";
import { createProject, loadProject, saveProject, listResumableProjects, type CreateProjectInput } from "./store";
import { projectMachine } from "./machine";
import { refusalFor } from "./steps";
import { planSteps } from "./types";
import type { Project } from "./types";

export type { CreateProjectInput as StartProjectInput };

type ProjectActor = Actor<typeof projectMachine>;

interface RunnerState {
  actors: Map<string, ProjectActor>;
}

const state = hotReloadState<RunnerState>("projectRunner", () => ({ actors: new Map() }));

/** Schedules the next batch through a REAL event-loop tick rather than
 * sending CONTINUE synchronously from inside the subscribe callback
 * below - machine.ts's own header explains why: it's the gap that lets
 * a crash (or a test simulating one) land between two steps of a
 * dependency chain, never mid-batch. `state.actors.get(id) === actor`
 * guards against a stale timer firing after that actor was already
 * stopped and replaced (a resume) or removed (a cancel/crash). */
function scheduleContinue(id: string, actor: ProjectActor): void {
  setTimeout(() => {
    if (state.actors.get(id) === actor) actor.send({ type: "CONTINUE" });
  }, 0);
}

function launch(project: Project, startedAtMs?: number): ProjectActor {
  const actor = createActor(projectMachine, { input: { project, startedAtMs } });
  state.actors.set(project.id, actor);
  actor.subscribe((snapshot) => {
    // Only the two fields saveProject() itself re-stamps are copied back
    // - never a full Object.assign of `saved` onto the live project.
    // saveProject() round-trips through Project.parse(), which returns a
    // brand-new clone (new `steps`/`artifacts` arrays, new element
    // objects); overwriting the live project's own arrays with that
    // clone orphans the exact StepState objects machine.ts/steps.ts are
    // still mutating in place mid-batch (a step that just flipped to
    // "running" would silently write its "done" transition onto an
    // object nothing reads anymore, and readySteps()/the guards would
    // see it stuck "running" forever - reproduced by every run before
    // this fix). hlc/updatedAt aren't mutated in place anywhere else, so
    // copying just those two keeps the live object's clock stamp current
    // for a caller reading it later without touching shared identity.
    const saved = saveProject(snapshot.context.project);
    snapshot.context.project.hlc = saved.hlc;
    snapshot.context.project.updatedAt = saved.updatedAt;
    if (snapshot.matches("idle")) {
      scheduleContinue(project.id, actor);
    } else if (snapshot.status !== "active" && state.actors.get(project.id) === actor) {
      state.actors.delete(project.id);
    }
  });
  actor.start();
  return actor;
}

/** Creates the row (always, in `planned` state - store.ts's own
 * header), then either launches it or, for a plan validation refuses
 * (today: any `media`/`tool` step - PROJECT-MEDIA-01/START-01's own
 * scope), flips that same row straight to `failed` - "the project fails
 * planned-to-failed, nothing half-run," never a row that never existed
 * and never a step that ran before the refusal. */
export function start(input: CreateProjectInput): Project {
  const project = createProject(input);
  const refusal = refusalFor(planSteps(input.plan));
  if (refusal) return saveProject({ ...project, state: "failed", error: refusal });
  launch(project);
  return project;
}

/** Test-only: identical to start(), but lets a test pin the machine's
 * own elapsed-time origin into the past so a maxWallSeconds ceiling
 * (schema minimum: 1 whole second) can be proven breached without a
 * real multi-second sleep. */
export function __startWithStartedAtForTests(input: CreateProjectInput, startedAtMs: number): Project {
  const project = createProject(input);
  const refusal = refusalFor(planSteps(input.plan));
  if (refusal) return saveProject({ ...project, state: "failed", error: refusal });
  launch(project, startedAtMs);
  return project;
}

/** Boot-time resume (design record, "The project record and the
 * runner": "a restart resumes unfinished projects from the last
 * completed step"). A step still `running` in the persisted row was cut
 * off mid-execution by whatever stopped the process - never trusted as
 * done, reset to `pending` so the new runner executes it again; a step
 * already `done` is never re-run. */
export function resumeAll(): void {
  for (const project of listResumableProjects()) {
    for (const stepState of project.steps) {
      if (stepState.state === "running") {
        stepState.state = "pending";
        stepState.startedAt = null;
      }
    }
    launch(project);
  }
}

/** First-class cancel (design record, "The project record and the
 * runner"). A no-op (returns false) for a project with no live actor -
 * already terminal, or this process never launched it. */
export function cancel(id: string): boolean {
  const actor = state.actors.get(id);
  if (!actor) return false;
  actor.send({ type: "CANCEL" });
  return true;
}

/** Resolves once the project reaches a terminal state (done/failed/
 * cancelled) - real callers don't need this (the design's own "the turn
 * replies immediately... the project runs after it"), but a test
 * driving the runner directly does. Falls back to the persisted row for
 * a project this process never launched or already finished. */
export function waitForSettled(id: string): Promise<Project> {
  const actor = state.actors.get(id);
  if (!actor) {
    const project = loadProject(id);
    if (!project) throw new Error(`no project "${id}"`);
    return Promise.resolve(project);
  }
  const snapshot = actor.getSnapshot();
  if (snapshot.status !== "active") return Promise.resolve(snapshot.context.project);
  return new Promise((resolve) => {
    const subscription = actor.subscribe((snap) => {
      if (snap.status !== "active") {
        subscription.unsubscribe();
        resolve(snap.context.project);
      }
    });
  });
}

/** Test-only escape hatch, the same shape llmSupervisor.ts's own
 * __resetLlmSupervisorForTests() etc. use: lets a test observe or stop a
 * live actor directly (simulating a crash between two batches) without
 * the runner exposing that as real API surface. */
export function __liveActorForTests(id: string): ProjectActor | undefined {
  return state.actors.get(id);
}

export function __resetRunnerForTests(): void {
  const actors = [...state.actors.values()];
  state.actors.clear();
  for (const actor of actors) actor.stop();
}
