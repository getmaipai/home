// PROJECT-START-01's own acceptance tests (docs/BACKLOG.md, "Projects
// (2026-09-26)"): start_project as a tool (offer/classify/run), and the
// completion surface (post.ts) that attaches its result to the thread and
// fires a notification. Mirrors projects/runner.test.ts's own structure
// (resetDb() per test, a scripted llm.complete() stub, deterministic and
// offline throughout) and artifactsRoutes.test.ts's own conversation/turn
// fixtures.
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../reset-db";
import { db } from "@/db";
import { people, conversationTurns, artifacts } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import * as llm from "@/lib/llm";
import * as notifications from "@/lib/notifications";
import { runStartProjectTool, START_PROJECT_TOOL_ID, type StartProjectArgs } from "@/lib/projects/tool";
import { registerProjectType, __resetProjectTypesForTests } from "@/lib/projects/projectTypes";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import { toolNode } from "@/lib/turnMachine/nodes/tool";
import { waitForSettled, cancel, __resetRunnerForTests } from "@/lib/projects/runner";
import { postProjectResult } from "@/lib/projects/post";
import type { TurnState, ActionProposal, ToolCall } from "@/lib/turnMachine/contract";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetRunnerForTests();
  __resetProjectTypesForTests();
});

afterEach(() => __resetRunnerForTests());

function person(displayName: string, role: "owner" | "adult" | "child" = "adult"): PersonRow {
  // A real generated id (newPersonId(), not a hand-rolled "person-sage"):
  // resolveOrCreateConversation()/logTurn() below validate against the
  // spec's own Conversation/ConversationTurn schemas, which pattern-match
  // every person id as `^person-[a-z0-9]{6,}$` - a short, human-readable
  // id like the plain "person-sage" projects/runner.test.ts uses (never
  // itself passed through those schemas) fails that check here.
  return db
    .insert(people)
    .values({ id: newPersonId(), displayName, role, avatarSeed: "test", source: "test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: nextHlc() })
    .returning()
    .get()!;
}

function conversationFor(actor: PersonRow): string {
  const result = resolveOrCreateConversation(actor, "chat");
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

function turnFor(actor: PersonRow, conversationId: string, id: string = newConversationTurnId()): string {
  db.insert(conversationTurns)
    .values({ id, personId: actor.id, surface: "chat", conversationId, userText: "write me a bedtime story", replyText: "starting now", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() })
    .run();
  return id;
}

function stubComplete(text = "Once upon a time, a small fox learned to share.") {
  return spyOn(llm, "complete").mockImplementation(async () => ({ ok: true, value: { text, model: "stub" } }));
}

function turnState(overrides: Partial<TurnState> = {}): TurnState {
  // policyNode reads state.utterance/state.context unconditionally
  // (groundingSourceTexts()/rosterNames(), before it ever looks at which
  // tool is being classified), so both need a real value even though
  // start_project's own branch never uses them (policy.ts's own comment
  // explains why grounding is skipped for this tool).
  const base = { turnId: "test-turn", conversationId: "test-conv", utterance: "", context: [], temporary: false, crisis: false, actor: overrides.actor ?? person("Sage") };
  return { ...base, ...overrides } as unknown as TurnState;
}

function toolCall(type: string, params?: Record<string, unknown>, id = "call-1"): ToolCall {
  return { tool: START_PROJECT_TOOL_ID, args: (params ? { type, params } : { type }) as StartProjectArgs, id } as unknown as ToolCall;
}

describe("runStartProjectTool(): the tool's own execution", () => {
  test("an unknown project type is refused, nothing started", () => {
    const completeSpy = stubComplete();
    const outcome = runStartProjectTool({ actor: person("Sage"), args: { type: "not-a-real-type" }, callId: "c1", conversationId: "conv-1", turnId: "turn-1", temporary: false });
    expect(outcome.status).toBe("failed");
    expect(outcome.errorCode).toBe("unknown_project_type");
    expect(completeSpy).not.toHaveBeenCalled();
    completeSpy.mockRestore();
  });

  test("missing required params are refused", () => {
    const outcome = runStartProjectTool({ actor: person("Sage"), args: { type: "bedtime-story", params: {} }, callId: "c1", conversationId: "conv-1", turnId: "turn-1", temporary: false });
    expect(outcome.status).toBe("failed");
    expect(outcome.errorCode).toBe("invalid_params");
  });

  test("a valid call starts the project and names the plan and duration in its reply text", async () => {
    const completeSpy = stubComplete();
    const outcome = runStartProjectTool({
      actor: person("Sage"),
      args: { type: "bedtime-story", params: { topic: "a brave little fox" } },
      callId: "c1",
      conversationId: "conv-1",
      turnId: "turn-1",
      temporary: false,
    });
    expect(outcome.status).toBe("succeeded");
    expect(outcome.result?.reply?.text).toContain("bedtime story");
    expect(outcome.result?.reply?.text).toMatch(/\d+ steps?, about \d+/);
    const projectId = (outcome.result?.data as { projectId: string }).projectId;
    expect(projectId).toBeTruthy();
    const finished = await waitForSettled(projectId);
    expect(finished.state).toBe("done");
    completeSpy.mockRestore();
  });
});

describe("policyNode: start_project classified by its own named type, not a fixed manifest", () => {
  test("an unknown type is refused (unknown_project_type), never reaching the runner", async () => {
    const state = turnState();
    const { output } = await policyNode(state, { calls: [toolCall("not-a-real-type")] }, new AbortController().signal);
    expect(output.entries[0]!.decision).toEqual({ allow: false, reason: "unknown_project_type" });
  });

  test("a consequential type asks for confirmation the first time", async () => {
    const state = turnState();
    const { output } = await policyNode(state, { calls: [toolCall("bedtime-story", { topic: "dragons" })] }, new AbortController().signal);
    const decision = output.entries[0]!.decision;
    if (decision.allow) throw new Error("expected a refusal asking to confirm");
    expect(decision.reason).toBe("confirm_needed");
    expect(decision.ask?.prompt).toContain("bedtime story");
  });

  test("the identical pre-confirmed call is allowed to run", async () => {
    const state = turnState();
    const call = toolCall("bedtime-story", { topic: "dragons" });
    const preConfirmed: ActionProposal = { kind: "side_effecting", request: { tool: START_PROJECT_TOOL_ID, args: call.args as Record<string, unknown>, callId: "call-1" } };
    const { output } = await policyNode(state, { calls: [call], preConfirmed }, new AbortController().signal);
    expect(output.entries[0]!.decision).toEqual({ allow: true });
  });

  test("min_role refuses an actor below the type's own floor", async () => {
    registerProjectType({
      id: "adult-only-test-type",
      title: "an adult-only test project",
      description: "test only",
      minRole: "adult",
      consequential: false,
      paramsSchema: { type: "object" },
      buildPlan: () => ({ steps: [{ id: "a", kind: "text", needs: [], params: { role: "chat", promptTemplate: "hi", inputs: [] } }], ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 } }),
    });
    const state = turnState({ actor: person("Bramble", "child") });
    const { output } = await policyNode(state, { calls: [toolCall("adult-only-test-type")] }, new AbortController().signal);
    expect(output.entries[0]!.decision).toEqual({ allow: false, reason: "min_role" });
  });

  test("no temporary_mode refusal - a project is allowed to start from a temporary conversation", async () => {
    const call = toolCall("bedtime-story", { topic: "dragons" });
    const preConfirmed: ActionProposal = { kind: "side_effecting", request: { tool: START_PROJECT_TOOL_ID, args: call.args as Record<string, unknown>, callId: "call-1" } };
    const state = turnState({ temporary: true });
    const { output } = await policyNode(state, { calls: [call], preConfirmed }, new AbortController().signal);
    expect(output.entries[0]!.decision).toEqual({ allow: true });
  });
});

describe("toolNode: start_project's own tool_call/tool_result/tool_error", () => {
  test("a successful call emits tool_call then tool_result carrying the reply text", async () => {
    const completeSpy = stubComplete();
    const state = turnState({ turnId: "turn-1", conversationId: "conv-1" });
    const proposal: ActionProposal = { kind: "side_effecting", request: { tool: START_PROJECT_TOOL_ID, args: { type: "bedtime-story", params: { topic: "dragons" } }, callId: "call-1" } };
    const { output } = await toolNode(state, { proposals: [proposal] }, new AbortController().signal);
    expect(output.toolEvents.map((e) => (e as { t: string }).t)).toEqual(["tool_call", "tool_result"]);
    expect(output.outcomes[0]?.status).toBe("succeeded");
    const result = output.toolEvents[1] as { t: "tool_result"; outcome: { text?: string } };
    expect(result.outcome.text).toContain("bedtime story");
    completeSpy.mockRestore();
  });

  test("an unknown type emits tool_call then tool_error", async () => {
    const state = turnState({ turnId: "turn-1", conversationId: "conv-1" });
    const proposal: ActionProposal = { kind: "side_effecting", request: { tool: START_PROJECT_TOOL_ID, args: { type: "not-a-real-type" }, callId: "call-1" } };
    const { output } = await toolNode(state, { proposals: [proposal] }, new AbortController().signal);
    expect(output.toolEvents.map((e) => (e as { t: string }).t)).toEqual(["tool_call", "tool_error"]);
    expect(output.outcomes[0]?.status).toBe("failed");
  });
});

describe("postProjectResult(): completion posts to the thread and notifies", () => {
  function artifactsFor(turnId: string) {
    return db.select().from(artifacts).where(eq(artifacts.turnId, turnId)).all();
  }

  test("a finished project's deliverable becomes a markdown artifact on the starting turn, and project.done fires", async () => {
    const completeSpy = stubComplete("Once upon a time, a small fox learned to share.");
    const triggerSpy = spyOn(notifications, "trigger").mockResolvedValue();
    const actor = person("Sage");
    const conversationId = conversationFor(actor);
    const turnId = turnFor(actor, conversationId);

    const outcome = runStartProjectTool({ actor, args: { type: "bedtime-story", params: { topic: "a brave little fox" } }, callId: "c1", conversationId, turnId, temporary: false });
    const projectId = (outcome.result?.data as { projectId: string }).projectId;
    await waitForSettled(projectId);

    const rows = artifactsFor(turnId);
    expect(rows.length).toBe(1);
    expect(rows[0]!.kind).toBe("markdown");
    expect(rows[0]!.body).toContain("fox");
    expect(rows[0]!.provenance).toBe(`project:${projectId}`);
    expect(triggerSpy).toHaveBeenCalledWith("project.done", expect.objectContaining({ title: "a bedtime story" }), expect.objectContaining({ personId: actor.id, subjectTurnId: turnId }));

    completeSpy.mockRestore();
    triggerSpy.mockRestore();
  });

  test("a failed project posts a plain-words summary of what did and didn't finish, and project.failed fires", async () => {
    const completeSpy = spyOn(llm, "complete").mockImplementation(async () => ({ ok: false, status: 503, code: "unavailable", error: "the chat engine is not responding" }));
    const triggerSpy = spyOn(notifications, "trigger").mockResolvedValue();
    const actor = person("Sage");
    const conversationId = conversationFor(actor);
    const turnId = turnFor(actor, conversationId);

    const outcome = runStartProjectTool({ actor, args: { type: "bedtime-story", params: { topic: "dragons" } }, callId: "c1", conversationId, turnId, temporary: false });
    const projectId = (outcome.result?.data as { projectId: string }).projectId;
    await waitForSettled(projectId);

    const rows = artifactsFor(turnId);
    expect(rows.length).toBe(1);
    expect(rows[0]!.body).toContain("didn't finish");
    expect(rows[0]!.body).toContain("story");
    expect(triggerSpy).toHaveBeenCalledWith("project.failed", expect.objectContaining({ title: "a bedtime story" }), expect.anything());

    completeSpy.mockRestore();
    triggerSpy.mockRestore();
  });

  test("the FK race: a project finishing before its own turn row exists posts nothing yet, and finishes the moment the row does", async () => {
    const completeSpy = stubComplete();
    const triggerSpy = spyOn(notifications, "trigger").mockResolvedValue();
    const actor = person("Sage");
    const conversationId = conversationFor(actor);
    const turnId = newConversationTurnId(); // never inserted yet - simulates turnNext.ts not having logged the row

    const outcome = runStartProjectTool({ actor, args: { type: "bedtime-story", params: { topic: "a brave little fox" } }, callId: "c1", conversationId, turnId, temporary: false });
    const projectId = (outcome.result?.data as { projectId: string }).projectId;
    await waitForSettled(projectId);
    postProjectResult(projectId); // runner.ts's own terminal hook already called this once; this simulates it finding no row yet is safe to call again

    expect(artifactsFor(turnId).length).toBe(0);
    expect(triggerSpy).not.toHaveBeenCalled();

    turnFor(actor, conversationId, turnId); // turnNext.ts's own logResult() writing the row, after the fact
    postProjectResult(projectId); // turnNext.ts's own post-logResult call

    expect(artifactsFor(turnId).length).toBe(1);
    expect(triggerSpy).toHaveBeenCalledTimes(1);

    completeSpy.mockRestore();
    triggerSpy.mockRestore();
  });

  test("calling postProjectResult twice after the row exists never creates a second artifact or a second notification", async () => {
    const completeSpy = stubComplete();
    const triggerSpy = spyOn(notifications, "trigger").mockResolvedValue();
    const actor = person("Sage");
    const conversationId = conversationFor(actor);
    const turnId = turnFor(actor, conversationId);

    const outcome = runStartProjectTool({ actor, args: { type: "bedtime-story", params: { topic: "a brave little fox" } }, callId: "c1", conversationId, turnId, temporary: false });
    const projectId = (outcome.result?.data as { projectId: string }).projectId;
    await waitForSettled(projectId);

    postProjectResult(projectId); // the second, idempotent caller

    expect(artifactsFor(turnId).length).toBe(1);
    expect(triggerSpy).toHaveBeenCalledTimes(1);

    completeSpy.mockRestore();
    triggerSpy.mockRestore();
  });

  test("cancelled: no artifact, no notification", async () => {
    // Never resolves - CANCEL (a root-level transition, machine.ts) fires
    // regardless of what the in-flight "story" step's own generation is
    // doing, so waitForSettled() resolves without this promise ever
    // needing to settle at all.
    const completeSpy = spyOn(llm, "complete").mockImplementation(() => new Promise(() => {}));
    const triggerSpy = spyOn(notifications, "trigger").mockResolvedValue();
    const actor = person("Sage");
    const conversationId = conversationFor(actor);
    const turnId = turnFor(actor, conversationId);

    const outcome = runStartProjectTool({ actor, args: { type: "bedtime-story", params: { topic: "a brave little fox" } }, callId: "c1", conversationId, turnId, temporary: false });
    const projectId = (outcome.result?.data as { projectId: string }).projectId;
    const settled = waitForSettled(projectId);
    expect(cancel(projectId)).toBe(true);
    const finished = await settled;

    expect(finished.state).toBe("cancelled");
    expect(artifactsFor(turnId).length).toBe(0);
    expect(triggerSpy).not.toHaveBeenCalled();

    completeSpy.mockRestore();
    triggerSpy.mockRestore();
  });

  test("a plan refused at validation posts nothing and notifies nothing - the tool's own immediate outcome already told the person, in the same turn (a code review's own finding: calling postProjectResult() here too doubled that one event into an inline reply AND a notification saying the identical thing)", async () => {
    registerProjectType({
      id: "refused-test-type",
      title: "a refused test project",
      description: "test only - its own buildPlan() returns a media step, which steps.ts's refusalFor() always refuses before anything runs",
      minRole: "child",
      consequential: false,
      paramsSchema: { type: "object" },
      buildPlan: () => ({
        steps: [{ id: "picture", kind: "media", needs: [], params: { role: "image", quality: "fast", promptTemplate: "a fox", inputs: [] } }],
        ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 },
      }),
    });
    const triggerSpy = spyOn(notifications, "trigger").mockResolvedValue();
    const actor = person("Sage");
    const conversationId = conversationFor(actor);
    const turnId = turnFor(actor, conversationId);

    const outcome = runStartProjectTool({ actor, args: { type: "refused-test-type" }, callId: "c1", conversationId, turnId, temporary: false });
    expect(outcome.status).toBe("failed");
    expect(outcome.errorCode).toBe("project_refused");
    expect(outcome.userMessage).toBeTruthy(); // the immediate reply already carries the refusal reason

    expect(artifactsFor(turnId).length).toBe(0);
    expect(triggerSpy).not.toHaveBeenCalled();

    triggerSpy.mockRestore();
  });

  test("incognito/temporary: no thread to post to, but the notification still fires", async () => {
    const completeSpy = stubComplete();
    const triggerSpy = spyOn(notifications, "trigger").mockResolvedValue();
    const actor = person("Sage");

    const outcome = runStartProjectTool({ actor, args: { type: "bedtime-story", params: { topic: "a brave little fox" } }, callId: "c1", conversationId: "unused", turnId: "unused", temporary: true });
    const projectId = (outcome.result?.data as { projectId: string }).projectId;
    const finished = await waitForSettled(projectId);

    expect(finished.provenance.conversationId).toBeNull();
    expect(finished.provenance.turnId).toBeNull();
    expect(triggerSpy).toHaveBeenCalledWith("project.done", expect.anything(), expect.objectContaining({ personId: actor.id, subjectTurnId: undefined }));

    completeSpy.mockRestore();
    triggerSpy.mockRestore();
  });
});
