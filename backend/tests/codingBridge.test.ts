// CODE-AGENT-01 slice two and CODE-BRAKE-01: agent events become redacted message parts and audit lines, every action passes the tool brake, a held request is
// the brake's own ask, Stop and the wall-clock budget end the turn with a stopped-run, and messages typed meanwhile wait in the session's queue.
import { afterEach, describe, expect, test } from "bun:test";
import { addCheckpoint, createCodingSession, getCodingSession } from "@/lib/codingSessions";
import { __setBudgetMsForTests, cancelQueuedMessage, queuedMessageIds, sendMessage, stopCodingSession, submitTurn, turnFinished, turnState, undoToCheckpoint } from "@/lib/codingTurns";
import { answerHostRequest, isSessionTainted, pendingRequestsFor } from "@/lib/codingBridge";
import { listCodingMessages } from "@/lib/codingTranscript";
import { listCodingEvents, recordCodingEvent } from "@/lib/codingEvents";
import { brakeFor } from "@/lib/toolBrake";
import { redactCredentials } from "@/lib/codingRedact";
import { input, owner, person, settled, startRig } from "./codingRig";

let rig: ReturnType<typeof startRig>;
afterEach(() => rig?.restore());
const GITHUB_TOKEN = "github_pat_FINEGRAINEDSECRET0123456789";

describe("the brake for a Code session's actions (CODE-BRAKE-01)", () => {
  const base = { tool: "code" as const, args: {}, actor: { id: "person-willow01", role: "adult", band: "adult" as const }, tainted: false };
  test("reads always run, writes follow the mode, plan never writes", () => {
    expect(brakeFor({ ...base, action: "read", mode: "never" }).decision).toBe("do");
    expect(brakeFor({ ...base, action: "file_write", mode: "do" }).decision).toBe("do");
    expect(brakeFor({ ...base, action: "file_write", mode: "ask" })).toEqual({ decision: "ask", reason: "mode_ask" });
    expect(brakeFor({ ...base, action: "file_write", mode: "never" }).decision).toBe("never");
  });
  test("push, pull request, a new host and a delete need the person's click in every mode, tainted or not", () => {
    for (const action of ["push", "pull_request", "host_new", "delete_session"]) for (const mode of ["do", "ask"] as const) for (const tainted of [false, true]) {
      expect(brakeFor({ ...base, action, mode, tainted }).decision).toBe("ask");
    }
  });
  test("a command after outside content asks even in auto edit; an unknown effect asks; a guest never acts", () => {
    expect(brakeFor({ ...base, action: "command", mode: "do" }).decision).toBe("do");
    expect(brakeFor({ ...base, action: "command", mode: "do", tainted: true }).decision).toBe("ask");
    expect(brakeFor({ ...base, action: "format_disk", mode: "do" }).decision).toBe("ask");
    expect(brakeFor({ ...base, action: "file_write", mode: "do", actor: { id: "g", role: "guest", band: "child" } }).decision).toBe("never");
  });
});

describe("events become message parts and audit lines", () => {
  test("text, plan, command and file writes land in the transcript and the trail; a token is removed from both", async () => {
    rig = startRig({ script: async (host) => {
      host.emit({ kind: "text", text: "Looking at it. " }); host.emit({ kind: "text", text: `The token is ${GITHUB_TOKEN}.` });
      host.emit({ kind: "plan", items: [{ text: "fix", done: false }] }); host.emit({ kind: "plan", items: [{ text: "fix", done: true }] });
      host.emit({ kind: "command", command: `curl -H "Authorization: Bearer ${GITHUB_TOKEN}" https://example.com`, exit_code: 0, duration_ms: 12 });
      host.emit({ kind: "file_write", path: "src/thermostat.ts" });
    } });
    const a = owner(); const s = createCodingSession(a, input());
    const sent = submitTurn(a, s.id, "fix it"); await settled(); rig.agent.finishAll(); await turnFinished(sent.turn_id);
    const messages = listCodingMessages(a.id, s.id);
    expect(messages.map((m) => m.role)).toEqual(["user", "agent", "system"]);
    const parts = messages[1]!.parts;
    expect(parts.map((p) => p.type)).toEqual(["text", "plan", "tool", "tool"]);
    expect((parts[1] as { items: { done: boolean }[] }).items[0]!.done).toBe(true);
    expect(JSON.stringify(messages)).not.toContain(GITHUB_TOKEN);
    expect(JSON.stringify(parts[0])).toContain("[credential removed]");
    const trail = listCodingEvents(a.id, s.id);
    expect(trail.map((e) => e.kind)).toEqual(["command", "file_write"]);
    expect(JSON.stringify(trail)).not.toContain(GITHUB_TOKEN);
    expect(trail[0]!.detail).toMatchObject({ exit_code: 0, duration_ms: 12 }); expect(trail[1]!.detail).toEqual({ path: "src/thermostat.ts" });
  });
  test("redactCredentials removes tokens and Home's own key shape and counts them", () => {
    const r = redactCredentials(`a ${GITHUB_TOKEN} b maipai_key0123456789abcdefghij_secretsecretsecret c`);
    expect(r.found).toBe(2); expect(r.text).not.toContain("github_pat_"); expect(r.text).not.toContain("maipai_key");
    expect(redactCredentials("plain words")).toEqual({ text: "plain words", found: 0 });
  });
  test("the trail redacts a token before it clips, so a token across the cut leaves no fragment", () => {
    rig = startRig(); const a = owner(); const s = createCodingSession(a, input());
    recordCodingEvent({ sessionId: s.id, personId: a.id, kind: "command", detail: { command: `${"x".repeat(470)} ${GITHUB_TOKEN} tail`, exit_code: 0, duration_ms: 1 } });
    const stored = JSON.stringify(listCodingEvents(a.id, s.id));
    expect(stored).not.toContain("github_pat"); expect(stored).not.toContain("FINEGRAINED"); expect(stored).toContain("[credential removed]");
  });
  test("another person cannot read the transcript or the trail", async () => {
    rig = startRig(); const a = owner(); const b = person(); const s = createCodingSession(a, input());
    submitTurn(a, s.id, "x"); await settled();
    expect(listCodingMessages(b.id, s.id)).toEqual([]); expect(listCodingEvents(b.id, s.id)).toEqual([]);
    stopCodingSession(a, s.id);
  });
});

describe("approvals are held host requests", () => {
  test("in Ask mode a file write waits for the person, the session reads needs_you, and an allow resumes it", async () => {
    let answer = null as string | null;
    rig = startRig({ script: async (host) => { answer = await host.permit({ effect: "file_write", detail: { path: "a.ts" } }); } });
    const a = owner(); const s = createCodingSession(a, input({ mode: "ask" }));
    const sent = submitTurn(a, s.id, "go"); await settled();
    expect(getCodingSession(a, s.id)!.state).toBe("needs_you");
    const [req] = pendingRequestsFor(a.id, s.id); expect(req).toMatchObject({ effect: "file_write" });
    expect(() => answerHostRequest(person(), s.id, req!.request_id, "allow")).toThrow(); // someone else cannot answer
    answerHostRequest(a, s.id, req!.request_id, "allow"); await settled();
    expect(answer).toBe("allow"); expect(getCodingSession(a, s.id)!.state).toBe("working");
    const card = listCodingMessages(a.id, s.id)[1]!.parts[0]!; expect(card).toMatchObject({ type: "approval", status: "allowed" });
    expect(listCodingEvents(a.id, s.id).map((e) => [e.kind, e.detail])).toContainEqual(["approval", { what: "file_write", answer: "allow" }]);
    rig.agent.finishAll(); await turnFinished(sent.turn_id);
  });
  test("auto edit writes without asking, plan mode refuses writes, and a new host always asks and records the answer", async () => {
    const answers: string[] = [];
    rig = startRig({ script: async (host) => {
      answers.push(await host.permit({ effect: "file_write", detail: { path: "a.ts" } }));
      answers.push(await host.permit({ effect: "host_new", detail: { host: "registry.example.com" } }));
    } });
    const a = owner(); const auto = createCodingSession(a, input({ mode: "auto_edit" }));
    const t1 = submitTurn(a, auto.id, "go"); await settled();
    expect(answers).toEqual(["allow"]); const [req] = pendingRequestsFor(a.id, auto.id);
    expect(req!.effect).toBe("host_new");
    answerHostRequest(a, auto.id, req!.request_id, "deny"); await settled();
    expect(answers).toEqual(["allow", "deny"]);
    expect(listCodingEvents(a.id, auto.id).map((e) => e.kind)).toEqual(["approval", "host_blocked"]);
    rig.agent.finishAll(); await turnFinished(t1.turn_id);
    answers.length = 0;
    const plan = createCodingSession(a, input({ mode: "plan", title: "Plan" }));
    const t2 = submitTurn(a, plan.id, "go"); await settled();
    expect(answers[0]).toBe("deny"); // plan mode never writes
    stopCodingSession(a, plan.id); await turnFinished(t2.turn_id);
  });
  test("a session from a git host starts tainted and outside reads taint any session; a tainted command asks", async () => {
    const answers: string[] = [];
    rig = startRig({ script: async (host) => { host.emit({ kind: "external_read" }); answers.push(await host.permit({ effect: "command", detail: { command: "make" } })); } });
    const a = owner(); const s = createCodingSession(a, input({ mode: "auto_edit" }));
    expect(isSessionTainted(s.id)).toBe(false);
    const t = submitTurn(a, s.id, "go"); await settled();
    expect(isSessionTainted(s.id)).toBe(true); expect(pendingRequestsFor(a.id, s.id)).toHaveLength(1);
    stopCodingSession(a, s.id); await turnFinished(t.turn_id);
    expect(answers).toEqual(["deny"]); // Stop denies what was waiting
  });
});

describe("Stop, the wall-clock budget and the message queue", () => {
  test("Stop ends a running turn with a stopped-run card and a trail line, and clears the message queue", async () => {
    rig = startRig(); const a = owner(); const s = createCodingSession(a, input());
    const t = submitTurn(a, s.id, "one"); await settled();
    expect(sendMessage(a, s.id, "two")).toMatchObject({ position: 1 });
    stopCodingSession(a, s.id); await turnFinished(t.turn_id); await settled();
    expect(turnState(t.turn_id)).toBe("cancelled"); expect(queuedMessageIds(a, s.id)).toEqual([]);
    const last = listCodingMessages(a.id, s.id).at(-1)!; expect(last.parts[0]).toEqual({ type: "stopped", reason: "user" });
    expect(listCodingEvents(a.id, s.id).at(-1)).toMatchObject({ kind: "stopped", detail: { reason: "user" } });
  });
  test("the wall-clock budget stops the agent and says so", async () => {
    rig = startRig(); __setBudgetMsForTests(30);
    const a = owner(); const s = createCodingSession(a, input());
    const t = submitTurn(a, s.id, "slow"); await settled(); await turnFinished(t.turn_id);
    expect(turnState(t.turn_id)).toBe("cancelled");
    expect(listCodingMessages(a.id, s.id).at(-1)!.parts[0]).toEqual({ type: "stopped", reason: "wall_clock" });
    expect(listCodingEvents(a.id, s.id).at(-1)!.detail).toEqual({ reason: "wall_clock" });
    expect(getCodingSession(a, s.id)!.state).toBe("idle");
  });
  test("messages typed meanwhile wait in order, can be taken back, and run one after another when the turn ends well", async () => {
    rig = startRig(); const a = owner(); const s = createCodingSession(a, input());
    const t1 = submitTurn(a, s.id, "one"); await settled();
    const q1 = sendMessage(a, s.id, "two") as { queued_message_id: string }; const q2 = sendMessage(a, s.id, "three") as { queued_message_id: string };
    expect(queuedMessageIds(a, s.id)).toEqual([q1.queued_message_id, q2.queued_message_id]);
    expect(cancelQueuedMessage(person(), s.id, q1.queued_message_id)).toBe(false);
    expect(cancelQueuedMessage(a, s.id, q1.queued_message_id)).toBe(true);
    rig.agent.finishAll(); await turnFinished(t1.turn_id); await settled();
    expect(rig.agent.calls.map((c) => c.message)).toEqual(["one", "three"]); // "two" was taken back
    rig.agent.finishAll(); await settled();
    expect(queuedMessageIds(a, s.id)).toEqual([]);
  });
  test("Undo recomputes the Changes count from the sandbox after the restore", async () => {
    rig = startRig(); const a = owner(); const s = createCodingSession(a, input());
    addCheckpoint(s.id, { id: "ckpt-1", label: "Before your message", files: 3 });
    (rig.sandbox.sandbox as unknown as { exec: unknown }).exec = async function* () { yield { stream: "stdout" as const, text: "2\t1\tsrc/a.ts\n" }; yield { exit: 0 }; };
    await undoToCheckpoint(a, s.id, "ckpt-1");
    expect(getCodingSession(a, s.id)!.changes).toEqual({ files: 1, additions: 2, deletions: 1 });
  });
  test("Undo on a receipt restores the checkpoint and records it", async () => {
    rig = startRig(); const a = owner(); const s = createCodingSession(a, input());
    addCheckpoint(s.id, { id: "ckpt-1", label: "Before your message", files: 3 });
    await undoToCheckpoint(a, s.id, "ckpt-1");
    expect(rig.sandbox.events).toContain(`restore:${s.id}:ckpt-1`);
    expect(listCodingEvents(a.id, s.id).at(-1)).toMatchObject({ kind: "checkpoint_restored", detail: { checkpoint_id: "ckpt-1" } });
    await expect(undoToCheckpoint(a, s.id, "../etc")).rejects.toThrow();
    await expect(undoToCheckpoint(a, s.id, "ckpt-unknown")).rejects.toThrow(); // only the session's own checkpoints
  });
});
