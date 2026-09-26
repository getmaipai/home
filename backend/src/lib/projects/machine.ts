// PROJECT-RUN-01 ("The runner's machinery: XState v5, already decided",
// docs/plans/harness-turns-and-projects-2026-09-26.md): the project
// runner is an XState v5 machine the way turnMachine/machine.ts is - one
// state per row of "walk the dependency graph, run ready steps, decide"
// - never a hand-rolled loop or a second orchestration library
// (ARCH-BUILD-01's verdict, carried over).
//
// One real difference from the turn machine's shape: a turn's nodes run
// in a fixed sequence, so one state per node is enough. A project's
// steps form a dependency graph, so this machine has one state
// (`batch`) that runs every currently-ready step concurrently, then
// loops - `idle` is a real, distinct state in between (not `batch`
// re-invoking itself directly) so runner.ts can drive the next batch
// through a real event-loop tick (setTimeout) rather than one unbroken
// synchronous chain: that gap is what lets a crash - or a test
// simulating one - land between two steps of a dependency chain instead
// of only ever between whole projects.
//
// No separate trace object either: each step's own StepState (state,
// startedAt, endedAt, error) already IS this runner's per-node trace
// entry - name, timing and outcome - and it's the one the project record
// persists, so there's no second, unpersisted copy of the identical
// information living only in this machine's own context the way
// turnMachine's NodeExecution does for a turn.
import { setup, fromPromise } from "xstate";
import { withTimeout } from "@maipai/core/src/withTimeout";
import { executeStep } from "./steps";
import { planSteps, stepStateFor } from "./types";
import type { Project, PlanStep } from "./types";

/** No per-step deadline field exists in project.schema.json yet (only
 * the plan-wide `ceilings.maxWallSeconds`) - a single generous constant
 * until a real package needs a narrower one named in the schema. */
export const STEP_DEADLINE_MS = 120_000;

function readySteps(project: Project): PlanStep[] {
  return planSteps(project.plan).filter((step) => {
    const state = stepStateFor(project, step.id);
    if (state.state !== "pending") return false;
    return step.needs.every((needId) => stepStateFor(project, needId).state === "done");
  });
}

/** Every step not already `done`/`failed` becomes `skipped` - called the
 * moment the project stops running for any reason (a step failed, the
 * wall-time ceiling was breached, a manual cancel), so a step that never
 * ran is never left silently `pending` on a terminal project. */
function skipRemaining(project: Project): void {
  const now = new Date().toISOString();
  for (const state of project.steps) {
    if (state.state === "pending") {
      state.state = "skipped";
      state.endedAt = now;
    }
  }
}

async function runOneStep(project: Project, step: PlanStep): Promise<void> {
  const state = stepStateFor(project, step.id);
  state.state = "running";
  state.startedAt = new Date().toISOString();
  try {
    await withTimeout(executeStep(project, step), STEP_DEADLINE_MS, () => new Error(`the "${step.id}" step exceeded its ${STEP_DEADLINE_MS / 1000}s deadline`));
    state.state = "done";
  } catch (err) {
    state.state = "failed";
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.endedAt = new Date().toISOString();
  }
}

/** A pool of `limit` workers pulling from the same queue, so at most
 * `limit` of `items` are ever in flight at once (a plain `Promise.all`
 * over every item has no such cap) - a worker that finishes just picks
 * up the next queued item instead of every item starting together. */
async function runLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workerCount = Math.max(1, Math.min(limit, queue.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await run(item);
      }
    }),
  );
}

/** Runs every currently-ready step against the SAME `project` object
 * (mutated in place - steps.ts's own header explains why), each one
 * writing its own StepState directly, capped at the plan's own
 * `ceilings.maxGeneratorJobs` concurrent at a time (project.schema.json
 * requires the field on every plan for exactly this reason - a code
 * review before this landed found the runner ignoring it entirely and
 * running every ready step at once regardless of the household's
 * declared budget). Only resolves once every step it started has
 * settled one way or the other - nothing from this batch is left
 * `running` when it returns. */
async function runBatch(project: Project): Promise<void> {
  const ready = readySteps(project);
  await runLimited(ready, project.plan.ceilings.maxGeneratorJobs, (step) => runOneStep(project, step));
}

export interface MachineInput {
  project: Project;
  /** Overridable only so tests can simulate an already-elapsed ceiling
   * without a real sleep; runner.ts's real callers always omit it. */
  startedAtMs?: number;
}

interface MachineContext {
  project: Project;
  startedAtMs: number;
}

export const projectMachine = setup({
  types: {} as { context: MachineContext; input: MachineInput },
  actors: {
    batch: fromPromise<void, { project: Project }>(({ input }) => runBatch(input.project)),
  },
  guards: {
    wallTimeExceeded: ({ context }) => Date.now() - context.startedAtMs > context.project.plan.ceilings.maxWallSeconds * 1000,
    anyStepFailed: ({ context }) => context.project.steps.some((s) => s.state === "failed"),
    allSettled: ({ context }) => context.project.steps.every((s) => s.state !== "pending" && s.state !== "running"),
    stalled: ({ context }) => readySteps(context.project).length === 0,
  },
  actions: {
    skipRemaining: ({ context }) => skipRemaining(context.project),
    markDone: ({ context }) => {
      context.project.state = "done";
    },
    markFailed: ({ context }) => {
      const failedStep = context.project.steps.find((s) => s.state === "failed");
      context.project.state = "failed";
      context.project.error = failedStep?.error ?? "a step failed";
    },
    markStalled: ({ context }) => {
      context.project.state = "failed";
      context.project.error = "the plan stalled: no remaining step's dependencies can ever be satisfied";
    },
    markCancelledWallTime: ({ context }) => {
      context.project.state = "cancelled";
      context.project.error = `the project exceeded its ${context.project.plan.ceilings.maxWallSeconds}s wall-time ceiling`;
    },
    markCancelledManual: ({ context }) => {
      context.project.state = "cancelled";
      context.project.error = "cancelled";
    },
  },
}).createMachine({
  id: "project",
  context: ({ input }) => {
    // Set here, once, for both a fresh start and a resume - a resumed
    // project's own row is already `running` from its first launch, so
    // this is a no-op for it and the one real transition for a fresh
    // `planned` one.
    input.project.state = "running";
    return { project: input.project, startedAtMs: input.startedAtMs ?? Date.now() };
  },
  initial: "batch",
  states: {
    batch: {
      invoke: {
        src: "batch",
        input: ({ context }) => ({ project: context.project }),
        onDone: [
          { guard: "wallTimeExceeded", actions: ["skipRemaining", "markCancelledWallTime"], target: "cancelled" },
          { guard: "anyStepFailed", actions: ["skipRemaining", "markFailed"], target: "failed" },
          { guard: "allSettled", actions: "markDone", target: "done" },
          { guard: "stalled", actions: ["skipRemaining", "markStalled"], target: "failed" },
          { target: "idle" },
        ],
      },
    },
    // A real pause, not an immediate self-loop - see this file's own
    // header for why runner.ts drives CONTINUE through a real
    // event-loop tick rather than sending it synchronously.
    idle: {
      on: { CONTINUE: "batch" },
    },
    done: { type: "final" },
    failed: { type: "final" },
    cancelled: { type: "final" },
  },
  on: {
    // A root-level `on` resolves an unprefixed target against the root
    // node itself, not its children, so a sibling state here needs the
    // leading dot (createMachine() throws "not a valid target from the
    // root node" otherwise - the same targets inside `batch`'s own
    // onDone below are fine unprefixed because THEIR parent is `batch`,
    // a sibling of `cancelled`/`done`/`failed`, not the root).
    CANCEL: { target: ".cancelled", actions: ["skipRemaining", "markCancelledManual"] },
  },
});
