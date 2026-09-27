// PROJECT-RUN-01's own acceptance tests (docs/BACKLOG.md, "Projects
// (2026-09-26)"): the real runner, a scripted llm.complete() stub (the
// same spyOn(llm, "complete") shape temporaryChat.test.ts already uses),
// deterministic and offline throughout. Mirrors turnMachine's own test
// files for structure: resetDb() per test, a minimal local person
// helper (artifacts.test.ts's own child()), no bespoke harness.
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { resetDb } from "../reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import * as llm from "@/lib/llm";
import { start, resumeAll, waitForSettled, liveProject, __liveActorForTests, __resetRunnerForTests, __startWithStartedAtForTests } from "@/lib/projects/runner";
import { createProject, loadProject } from "@/lib/projects/store";
import { executeStep } from "@/lib/projects/steps";
import { planSteps } from "@/lib/projects/types";
import type { ProjectPlan, ProjectProvenance } from "@/lib/projects/types";

beforeEach(() => {
  resetDb();
  __resetRunnerForTests();
});

afterEach(() => {
  __resetRunnerForTests();
});

function adult(displayName = "Sage") {
  return db
    .insert(people)
    .values({
      id: `person-${displayName.toLowerCase()}`,
      displayName,
      role: "adult",
      avatarSeed: "test",
      source: "test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hlc: nextHlc(),
    })
    .returning()
    .get()!;
}

function provenanceFor(personId: string): ProjectProvenance {
  return { person: personId, conversationId: null, turnId: null, planSource: "package" };
}

describe("the runner (text and assemble steps, resumable)", () => {
  test("a three-step plan (text, text needing the first, assemble needing both) runs to done, every artifact carries a gate verdict, and the trace shows dependency order respected", async () => {
    const person = adult();
    const completeSpy = spyOn(llm, "complete").mockImplementation(async (_role, messages) => ({
      ok: true,
      value: { text: `generated: ${messages[0]!.content}`, model: "stub" },
    }));

    const plan: ProjectPlan = {
      steps: [
        { id: "a", kind: "text", needs: [], params: { role: "chat", promptTemplate: "write part a", inputs: [] } },
        { id: "b", kind: "text", needs: ["a"], params: { role: "chat", promptTemplate: "write part b using {{a}}", inputs: ["a"] } },
        { id: "c", kind: "assemble", needs: ["a", "b"], params: { assembler: "markdown-concat", inputs: ["a", "b"] } },
      ],
      ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 },
    };

    const project = start({ type: "adhoc", title: "A three-step project", plan, provenance: provenanceFor(person.id) });
    const finished = await waitForSettled(project.id);

    expect(finished.state).toBe("done");
    expect(finished.artifacts.length).toBe(3);
    expect(finished.artifacts.every((a) => a.gate === "passed")).toBe(true);

    const stepA = finished.steps.find((s) => s.stepId === "a")!;
    const stepB = finished.steps.find((s) => s.stepId === "b")!;
    const stepC = finished.steps.find((s) => s.stepId === "c")!;
    expect([stepA.state, stepB.state, stepC.state]).toEqual(["done", "done", "done"]);
    // Dependency order, proven from each step's own StepState timing
    // (this runner's own per-node trace - machine.ts's own header):
    // a dependent never starts before every step it needs has ended.
    expect(Date.parse(stepB.startedAt!)).toBeGreaterThanOrEqual(Date.parse(stepA.endedAt!));
    expect(Date.parse(stepC.startedAt!)).toBeGreaterThanOrEqual(Date.parse(stepA.endedAt!));
    expect(Date.parse(stepC.startedAt!)).toBeGreaterThanOrEqual(Date.parse(stepB.endedAt!));

    completeSpy.mockRestore();
  });

  test("a project stopped after its first step completes resumes with a new runner and finishes without re-running the done step, proven by the stub's call count", async () => {
    const person = adult();
    const completeSpy = spyOn(llm, "complete").mockImplementation(async () => ({ ok: true, value: { text: "generated text", model: "stub" } }));

    const plan: ProjectPlan = {
      steps: [
        { id: "step1", kind: "text", needs: [], params: { role: "chat", promptTemplate: "first", inputs: [] } },
        { id: "step2", kind: "text", needs: ["step1"], params: { role: "chat", promptTemplate: "second", inputs: [] } },
      ],
      ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 },
    };

    const project = start({ type: "adhoc", title: "A resumable project", plan, provenance: provenanceFor(person.id) });
    const actor = __liveActorForTests(project.id)!;

    // step1's own batch settles into `idle` (runner.ts schedules its
    // CONTINUE through a real event-loop tick, never synchronously - see
    // machine.ts/runner.ts's own headers) before step2's batch ever
    // starts; stopping the actor here, before that tick fires, is the
    // crash this test simulates.
    await new Promise<void>((resolve) => {
      const subscription = actor.subscribe((snapshot) => {
        if (snapshot.matches("idle")) {
          subscription.unsubscribe();
          resolve();
        }
      });
    });
    actor.stop();

    expect(completeSpy.mock.calls.length).toBe(1);

    resumeAll();
    const resumed = await waitForSettled(project.id);

    expect(resumed.state).toBe("done");
    expect(completeSpy.mock.calls.length).toBe(2); // step1 never re-run; only step2 adds a call
    expect(resumed.steps.find((s) => s.stepId === "step1")!.state).toBe("done");
    expect(resumed.steps.find((s) => s.stepId === "step2")!.state).toBe("done");

    completeSpy.mockRestore();
  });

  test("a failing text step ends the project failed with a plain-words error and its dependents skipped", async () => {
    const person = adult();
    const completeSpy = spyOn(llm, "complete").mockImplementation(async () => ({
      ok: false,
      status: 503,
      code: "unavailable",
      error: "the chat engine is not responding",
    }));

    const plan: ProjectPlan = {
      steps: [
        { id: "a", kind: "text", needs: [], params: { role: "chat", promptTemplate: "will fail", inputs: [] } },
        { id: "b", kind: "text", needs: ["a"], params: { role: "chat", promptTemplate: "never runs", inputs: [] } },
      ],
      ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 },
    };

    const project = start({ type: "adhoc", title: "Will fail", plan, provenance: provenanceFor(person.id) });
    const finished = await waitForSettled(project.id);

    expect(finished.state).toBe("failed");
    expect(finished.error).toContain("the chat engine is not responding");
    expect(finished.steps.find((s) => s.stepId === "a")!.state).toBe("failed");
    expect(finished.steps.find((s) => s.stepId === "b")!.state).toBe("skipped");

    completeSpy.mockRestore();
  });

  test("a maxWallSeconds breach cancels with the reason recorded", async () => {
    const person = adult();
    const completeSpy = spyOn(llm, "complete").mockImplementation(async () => ({ ok: true, value: { text: "output", model: "stub" } }));

    const plan: ProjectPlan = {
      steps: [
        { id: "a", kind: "text", needs: [], params: { role: "chat", promptTemplate: "a", inputs: [] } },
        { id: "b", kind: "text", needs: ["a"], params: { role: "chat", promptTemplate: "b", inputs: [] } },
      ],
      ceilings: { maxWallSeconds: 1, maxGeneratorJobs: 1 },
    };

    // Pinned 5 real seconds in the past against a 1-second ceiling: the
    // first batch's own decision already reads as breached, deterministic
    // regardless of how fast this machine runs the mocked step itself.
    const project = __startWithStartedAtForTests({ type: "adhoc", title: "Too slow", plan, provenance: provenanceFor(person.id) }, Date.now() - 5000);
    const finished = await waitForSettled(project.id);

    expect(finished.state).toBe("cancelled");
    expect(finished.error).toContain("wall-time ceiling");
    expect(finished.steps.find((s) => s.stepId === "b")!.state).toBe("skipped");

    completeSpy.mockRestore();
  });

  test("a plan with a media step is refused at validation with the honest error and nothing executed", () => {
    const person = adult();
    const completeSpy = spyOn(llm, "complete").mockImplementation(async () => ({ ok: true, value: { text: "should never run", model: "stub" } }));

    const plan: ProjectPlan = {
      steps: [
        { id: "a", kind: "text", needs: [], params: { role: "chat", promptTemplate: "a", inputs: [] } },
        { id: "picture", kind: "media", needs: [], params: { role: "image", quality: "fast", promptTemplate: "a dinosaur", inputs: [] } },
      ],
      ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 },
    };

    const project = start({ type: "adhoc", title: "Needs a picture", plan, provenance: provenanceFor(person.id) });

    expect(project.state).toBe("failed");
    expect(project.error).toBe("media steps need the Stack image role, not built yet");
    expect(completeSpy).not.toHaveBeenCalled();
    expect(project.steps.every((s) => s.state === "pending")).toBe(true);

    completeSpy.mockRestore();
  });

  test("runBatch caps concurrent steps at the plan's own maxGeneratorJobs - a code review's own regression", async () => {
    // A review before this landed found runBatch() running every ready
    // step at once regardless of `ceilings.maxGeneratorJobs`. Nothing
    // resolves a call until this test explicitly releases it, so the
    // observed concurrency is real, not an artifact of how fast the stub
    // happens to run.
    const person = adult();
    let concurrent = 0;
    let maxConcurrent = 0;
    let totalCalls = 0;
    const pending: Array<() => void> = [];
    const completeSpy = spyOn(llm, "complete").mockImplementation(() => {
      totalCalls++;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      return new Promise((resolve) => {
        pending.push(() => {
          concurrent--;
          resolve({ ok: true, value: { text: "ok", model: "stub" } });
        });
      });
    });

    const plan: ProjectPlan = {
      steps: ["s1", "s2", "s3", "s4"].map((id) => ({ id, kind: "text", needs: [], params: { role: "chat", promptTemplate: id, inputs: [] } })),
      ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 2 },
    };

    const project = start({ type: "adhoc", title: "Four independent steps", plan, provenance: provenanceFor(person.id) });
    const settled = waitForSettled(project.id);

    while (totalCalls < 4) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      while (pending.length > 0) pending.shift()!();
    }
    while (pending.length > 0) pending.shift()!();

    const finished = await settled;
    expect(finished.state).toBe("done");
    expect(totalCalls).toBe(4);
    // Proves the cap is real (never above it) and actually exercised
    // (reached it, not accidentally serialized to 1).
    expect(maxConcurrent).toBe(2);

    completeSpy.mockRestore();
  });

  test("a step's result landing after its own step has already moved on is dropped, never mutating the project - a code review's own regression", async () => {
    // machine.ts's withTimeout() only races a step's promise against the
    // deadline; it never cancels the underlying model call. A review
    // before this landed found that a text step's late-arriving result
    // could still reach writeAndGateArtifact() and mutate a project that
    // had already been marked failed/skipped and saved, with nothing
    // persisting the extra write. This drives that exact path directly:
    // mark the step "failed" (as the timeout path already does) before
    // its "result" arrives, then confirm the late call is a no-op.
    const person = adult();
    const plan: ProjectPlan = {
      steps: [{ id: "a", kind: "text", needs: [], params: { role: "chat", promptTemplate: "a", inputs: [] } }],
      ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 },
    };
    const project = createProject({ type: "adhoc", title: "One step", plan, provenance: provenanceFor(person.id) });
    const stepA = project.steps.find((s) => s.stepId === "a")!;
    stepA.state = "failed";
    stepA.error = "the \"a\" step exceeded its deadline";

    const completeSpy = spyOn(llm, "complete").mockImplementation(async () => ({ ok: true, value: { text: "arrived too late", model: "stub" } }));

    await executeStep(project, planSteps(project.plan)[0]!);

    expect(project.artifacts.length).toBe(0);
    expect(stepA.artifactIds.length).toBe(0);
    expect(stepA.state).toBe("failed");

    completeSpy.mockRestore();
  });

  // PROJECT-PROGRESS-01's own blocking gap: saveProject() (this file's
  // own actor.subscribe()) only re-persists the row once a whole BATCH
  // settles, so a poll against loadProject() alone sees every step
  // "pending," then every step in the batch "done," with nothing
  // observable in between - a real regression a mid-batch poll would
  // otherwise never catch. liveProject() reads the running actor's own
  // in-memory object instead, the exact one steps.ts mutates per step.
  test("liveProject() sees one chapter done and another still running mid-batch, while the persisted row (loadProject) still shows every step pending", async () => {
    const person = adult();
    const releases: Array<() => void> = [];
    const completeSpy = spyOn(llm, "complete").mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => resolve({ ok: true, value: { text: "chapter text", model: "stub" } }));
        }),
    );

    const plan: ProjectPlan = {
      steps: [
        { id: "chapter-1", kind: "text", needs: [], params: { role: "chat", promptTemplate: "chapter 1", inputs: [] } },
        { id: "chapter-2", kind: "text", needs: [], params: { role: "chat", promptTemplate: "chapter 2", inputs: [] } },
      ],
      ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 2 },
    };

    const project = start({ type: "adhoc", title: "A two-chapter book", plan, provenance: provenanceFor(person.id) });

    // Both steps run concurrently (maxGeneratorJobs: 2) - wait until both
    // have actually issued their own model call before touching either.
    while (releases.length < 2) await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Resolve only chapter-1's call, then let its own StepState write
    // (runOneStep()'s `state.state = "done"`) actually land.
    releases[0]!();
    while (liveProject(project.id)!.steps.find((s) => s.stepId === "chapter-1")!.state !== "done") {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const live = liveProject(project.id)!;
    expect(live.steps.find((s) => s.stepId === "chapter-1")!.state).toBe("done");
    expect(live.steps.find((s) => s.stepId === "chapter-2")!.state).toBe("running");

    // The persisted row is stuck at whatever it showed the moment this
    // batch started (both chapters "running") - saveProject() only fires
    // again once the WHOLE batch settles, so a poll against loadProject()
    // alone can't tell chapter-1 already finished from it still running,
    // the exact gap this item exists to close.
    const persisted = loadProject(project.id)!;
    expect(persisted.steps.find((s) => s.stepId === "chapter-1")!.state).toBe("running");
    expect(persisted.steps.find((s) => s.stepId === "chapter-1")!.state).not.toBe("done");

    releases[1]!();
    const finished = await waitForSettled(project.id);
    expect(finished.state).toBe("done");
    // Once truly terminal, liveProject() has nothing live left to read -
    // the route's own fallback to loadProject() is what a caller gets.
    expect(liveProject(project.id)).toBeUndefined();

    completeSpy.mockRestore();
  });
});
