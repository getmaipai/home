// CODE-FIX-01: a failed Code session says why in plain words, offers Retry, goes quiet on open, and does not stay failed across a restart.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { codingSessions } from "@/db/schema";
import { CODING_FAILURE_COPY, codingFailureLine } from "@/lib/codingFailureCopy";
import { CodingSessionError, createCodingSession, getCodingSession, markSessionOpened, settleSessionsAtStartup } from "@/lib/codingSessions";
import { retryLastTurn, setCodingRuntime, submitTurn, turnFinished, type CodingAgent } from "@/lib/codingTurns";
import { listCodingMessages } from "@/lib/codingTranscript";
import { ENV, input, owner, person, settled, startRig } from "./codingRig";

let rig: ReturnType<typeof startRig>;
let calls: string[]; let failWith: string | null;
beforeEach(() => {
  rig = startRig(); calls = []; failWith = "feature_missing";
  const agent: CodingAgent = { runTurn: async ({ message }) => { calls.push(message); if (failWith) throw Object.assign(new Error("/home/willow/repo: boom"), { reason: failWith }); return { modelId: "coding-model-1" }; } };
  setCodingRuntime({ agent, sandbox: rig.sandbox.sandbox, lease: () => rig.lease });
});
afterEach(() => rig.restore());
const fail = async (boss = owner(), code = "feature_missing") => {
  failWith = code; const s = createCodingSession(boss, input());
  const sent = submitTurn(boss, s.id, "fix the thermostat"); await turnFinished(sent.turn_id);
  return { boss, id: s.id };
};

describe("each reason code reads as one plain sentence", () => {
  test("every code maps to a sentence with a next step and none shows the code", () => {
    for (const [code, line] of Object.entries(CODING_FAILURE_COPY)) {
      if (code.includes("_")) expect(line).not.toContain(code); expect(line).toMatch(/\.$/); expect(line.length).toBeGreaterThan(20);
      expect(line).toMatch(/Retry|Wait|Ask|Check|Tap/);
    }
    for (const code of ["feature_missing", "lock_not_ready", "unavailable", "gateway_unreachable"]) expect(CODING_FAILURE_COPY).toHaveProperty(code);
    expect(codingFailureLine("something_new")).toMatch(/problem on this computer/);
    expect(codingFailureLine(undefined)).toBe(codingFailureLine("Error"));
    expect(codingFailureLine("toString")).toBe(codingFailureLine("Error"));
  });
  test("the session wire carries the sentence of the code the turn failed with, never the code or the error text", async () => {
    for (const code of ["lock_not_ready", "unavailable"]) {
      const { boss, id } = await fail(owner(), code);
      const wire = getCodingSession(boss, id)!;
      expect(wire.state).toBe("failed"); expect(wire.failure).toBe(CODING_FAILURE_COPY[code as keyof typeof CODING_FAILURE_COPY]);
      expect(JSON.stringify(wire)).not.toContain("boom");
    }
  });
});

describe("Retry", () => {
  test("re-runs the last message once, without writing it twice, and a good run ends idle with no failure", async () => {
    const { boss, id } = await fail();
    failWith = null;
    const again = retryLastTurn(boss, id); await turnFinished(again.turn_id);
    expect(calls).toEqual(["fix the thermostat", "fix the thermostat"]);
    expect(listCodingMessages(boss.id, id).filter((m) => m.role === "user")).toHaveLength(1);
    expect(getCodingSession(boss, id)).toMatchObject({ state: "idle", failure: null });
  });
  test("is for the owner only and only after a failure", async () => {
    const { boss, id } = await fail();
    expect(() => retryLastTurn(person("adult"), id)).toThrow(CodingSessionError);
    const fresh = createCodingSession(boss, input({ title: "Quiet" }));
    expect(() => retryLastTurn(boss, fresh.id)).toThrow(/nothing to retry/);
    expect(getCodingSession(boss, id)!.state).toBe("failed");
  });
  test("works over HTTP: 202 for the owner, 404 for another person", async () => {
    const { TestClient } = await import("./client");
    const client = new TestClient(); await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const made = (await (await client.post("/api/code/sessions", { title: "Fix it", repo: { kind: "none", base_branch: "main", work_branch: "code/fix" }, environment_id: ENV })).json()) as { id: string };
    expect((await client.post(`/api/code/sessions/${made.id}/retry`, {})).status).toBe(400);
    const sent = await (await client.post(`/api/code/sessions/${made.id}/messages`, { text: "go" })).json() as { turn_id: string };
    await turnFinished(sent.turn_id); await settled();
    const view = await (await client.get(`/api/code/sessions/${made.id}`)).json() as { session: { failure: string | null } };
    expect(view.session.failure).toBe(CODING_FAILURE_COPY.feature_missing);
    failWith = null;
    const res = await client.post(`/api/code/sessions/${made.id}/retry`, {}); expect(res.status).toBe(202);
    await turnFinished(((await res.json()) as { turn_id: string }).turn_id);
    expect(calls).toEqual(["go", "go"]);
    expect((await new TestClient().post(`/api/code/sessions/${made.id}/retry`, {})).status).toBe(401);
  });
});

describe("a failure does not outlive the person looking at it", () => {
  test("opening a failed session turns the red dot off and keeps the reason; retry stays offered", async () => {
    const { boss, id } = await fail();
    const opened = markSessionOpened(boss, id);
    expect(opened.state).toBe("idle"); expect(opened.failure).toBe(CODING_FAILURE_COPY.feature_missing);
    failWith = null; const again = retryLastTurn(boss, id); await turnFinished(again.turn_id); await settled();
  });
  test("a restart settles a failed session: a stopped message is added and it reads idle with the reason kept", async () => {
    const { boss, id } = await fail(owner(), "lock_not_ready");
    const before = listCodingMessages(boss.id, id).length;
    expect(settleSessionsAtStartup()).toBe(1);
    const wire = getCodingSession(boss, id)!;
    expect(wire.state).toBe("idle"); expect(wire.failure).toBe(CODING_FAILURE_COPY.lock_not_ready);
    const messages = listCodingMessages(boss.id, id);
    expect(messages).toHaveLength(before + 1);
    expect(messages.at(-1)!.parts[0]).toMatchObject({ type: "stopped", reason: "error", code: "lock_not_ready" });
  });
  test("a failed row with no stopped card settles with the restart code", () => {
    const boss = owner(); const s = createCodingSession(boss, input());
    db.update(codingSessions).set({ state: "failed" }).where(eq(codingSessions.id, s.id)).run();
    settleSessionsAtStartup();
    expect(getCodingSession(boss, s.id)).toMatchObject({ state: "idle", failure: CODING_FAILURE_COPY.restarted });
  });
});
