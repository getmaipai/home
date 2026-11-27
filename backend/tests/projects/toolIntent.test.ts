// TOOL-INTENT-LINE-01: a changing tool writes "about to run X" (tool name and step id only, rule 6a) before it runs.
// A restart that finds the intent with no result tells the person the outcome is unknown and never runs the tool again.
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../reset-db";
import { db } from "@/db";
import { people, toolAudit } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { resumeAll, waitForSettled, __resetRunnerForTests } from "@/lib/projects/runner";
import { createProject, saveProject, loadProject } from "@/lib/projects/store";
import * as steps from "@/lib/projects/steps";
import { recordToolIntent, recordToolResult, toolOutcomeUnknown } from "@/lib/toolAudit";
import type { ProjectPlan } from "@/lib/projects/types";

beforeEach(() => { resetDb(); __resetRunnerForTests(); });
afterEach(() => { __resetRunnerForTests(); });

function adult() {
  return db.insert(people).values({ id: "person-sage", displayName: "Sage", role: "adult", avatarSeed: "t", source: "test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: nextHlc() }).returning().get()!;
}

function toolProjectCutMidStep(personId: string) {
  const plan: ProjectPlan = { steps: [{ id: "send", kind: "tool", needs: [], params: { tool: "remind", args: { secret: "never-logged" } } }], ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 } };
  const project = createProject({ type: "adhoc", title: "Tool project", plan, provenance: { person: personId, conversationId: null, turnId: null, companion_id: null, planSource: "package" } });
  project.state = "running";
  const step = project.steps.find((s) => s.stepId === "send")!;
  step.state = "running";
  step.startedAt = new Date().toISOString();
  saveProject(project);
  return project;
}

describe("tool intent line", () => {
  test("kill mid-tool, restart: the step reports an unknown outcome and the tool is not called again", async () => {
    const person = adult();
    const project = toolProjectCutMidStep(person.id);
    recordToolIntent({ personId: person.id, tool: "remind", stepId: `${project.id}:send`, band: "adult" });
    const exec = spyOn(steps, "executeStep");

    resumeAll();
    const finished = await waitForSettled(project.id);

    expect(exec.mock.calls.length).toBe(0);
    const step = finished.steps.find((s) => s.stepId === "send")!;
    expect(step.state).toBe("failed");
    expect(step.error).toContain("unknown");
    expect(loadProject(project.id)!.state).toBe("failed");
    exec.mockRestore();
  });

  test("the intent row holds the tool name and step id only, no arguments", () => {
    const person = adult();
    recordToolIntent({ personId: person.id, tool: "remind", stepId: "p1:send", band: "adult" });
    const rows = db.select().from(toolAudit).where(eq(toolAudit.personId, person.id)).all();
    expect(rows.length).toBe(1);
    expect(JSON.stringify(rows[0])).not.toContain("never-logged");
    expect(rows[0]!.decision).toBe("intent");
  });

  test("a recorded result clears the unknown", () => {
    const person = adult();
    recordToolIntent({ personId: person.id, tool: "remind", stepId: "p1:send", band: "adult" });
    expect(toolOutcomeUnknown(person.id, "remind", "p1:send")).toBe(true);
    recordToolResult({ personId: person.id, tool: "remind", stepId: "p1:send", band: "adult" });
    expect(toolOutcomeUnknown(person.id, "remind", "p1:send")).toBe(false);
  });
});
