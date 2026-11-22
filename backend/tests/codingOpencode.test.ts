// CODE-AGENT-01 slice three: the OpenCode driver over a fake exec sandbox. The event shapes follow OpenCode's JSON run output as documented and are NOT checked
// against a real OpenCode here (opt-in at the bottom, MAIPAI_REAL_OPENCODE=1 with a real sandbox).
import { afterEach, describe, expect, test } from "bun:test";
import { CodingSessionError, createCodingSession, getCodingSession } from "@/lib/codingSessions";
import { __setBudgetMsForTests, setCodingRuntime, submitTurn, stopCodingSession, turnFinished, turnState } from "@/lib/codingTurns";
import { createOpenCodeAgent, mapOpenCodeEvent, openCodeConfig, type OpenCodeDeps } from "@/lib/codingOpencode";
import { listCodingMessages } from "@/lib/codingTranscript";
import { listCodingEvents } from "@/lib/codingEvents";
import { answerHostRequest, pendingRequestsFor } from "@/lib/codingBridge";
import type { ExecChunk, ExecInput, ExecSandbox } from "@/lib/codingSandbox";
import { input, owner, settled, startRig } from "./codingRig";

let rig: ReturnType<typeof startRig>;
afterEach(() => rig?.restore());
const line = (o: unknown) => JSON.stringify(o) + "\n";
const bash = (command: string, exit = 0) => line({ type: "tool_use", part: { tool: "bash", state: { status: "completed", input: { command }, metadata: { exit }, time: { start: 100, end: 160 } } } });

/** A sandbox whose exec plays a script and records what it was asked. */
function execSandbox(script: (i: ExecInput) => AsyncIterable<ExecChunk>) {
  const execs: ExecInput[] = []; const events: string[] = [];
  const sandbox: ExecSandbox = {
    start: async ({ sessionId }) => { events.push(`start:${sessionId}`); }, stop: async () => undefined, destroy: async () => undefined,
    snapshot: async ({ label }) => { events.push(`snapshot:${label}`); return { id: `snap-${events.length}`, files: 2 }; },
    restoreCheckpoint: async ({ checkpointId }) => { events.push(`restore:${checkpointId}`); },
    exec: (i) => { execs.push(i); return script(i); },
  };
  return { sandbox, execs, events };
}
const deps = (sandbox: ExecSandbox, over: Partial<OpenCodeDeps> = {}): OpenCodeDeps => ({ sandbox, gatewayUrl: () => "http://192.0.2.1:3000/code/v1", canMintKeys: () => true, sessionKey: async () => "session-key-for-test", ...over });
function wire(sbx: ReturnType<typeof execSandbox>, over: Partial<OpenCodeDeps> = {}) {
  setCodingRuntime({ agent: createOpenCodeAgent(deps(sbx.sandbox, over)), sandbox: sbx.sandbox, lease: () => rig.lease });
}
async function* play(chunks: ExecChunk[]) { for (const c of chunks) yield c; }

describe("event mapping", () => {
  test("text, bash, edit, plan, fetch and token events map; unknown and unfinished events give nothing", () => {
    expect(mapOpenCodeEvent({ type: "text", part: { text: "hi" } }).events).toEqual([{ kind: "text", text: "hi" }]);
    expect(mapOpenCodeEvent({ type: "tool_use", part: { tool: "bash", state: { status: "completed", input: { command: "ls" }, metadata: { exit: 2 }, time: { start: 1, end: 11 } } } }).events).toEqual([{ kind: "command", command: "ls", exit_code: 2, duration_ms: 10 }]);
    expect(mapOpenCodeEvent({ type: "tool_use", part: { tool: "edit", state: { status: "completed", input: { filePath: "a.ts" } } } }).events).toEqual([{ kind: "file_write", path: "a.ts" }]);
    expect(mapOpenCodeEvent({ type: "tool_use", part: { tool: "todowrite", state: { status: "completed", input: { todos: [{ content: "x", status: "completed" }, { content: "y", status: "pending" }] } } } }).events).toEqual([{ kind: "plan", items: [{ text: "x", done: true }, { text: "y", done: false }] }]);
    expect(mapOpenCodeEvent({ type: "tool_use", part: { tool: "webfetch", state: { status: "completed", input: {} } } }).events).toEqual([{ kind: "external_read" }]);
    expect(mapOpenCodeEvent({ type: "step_finish", part: { tokens: { input: 5, output: 3 } } }).tokens).toEqual({ input: 5, output: 3 });
    expect(mapOpenCodeEvent({ type: "tool_use", part: { tool: "bash", state: { status: "running", input: {} } } }).events).toEqual([]);
    expect(mapOpenCodeEvent({ type: "mystery", part: {} }).events).toEqual([]); expect(mapOpenCodeEvent(null).events).toEqual([]); expect(mapOpenCodeEvent("x").events).toEqual([]);
  });
  test("the config points at the gateway with the key and tier, turns permissions on and off, and always denies web fetches", () => {
    const c = JSON.parse(openCodeConfig({ gatewayUrl: "http://192.0.2.1:3000/code/v1", key: "k", tier: "boost", allowEdit: true, allowBash: false }));
    expect(c.provider.maipai.options).toMatchObject({ baseURL: "http://192.0.2.1:3000/code/v1", apiKey: "k", headers: { "x-maipai-coding-tier": "boost" } });
    expect(c.permission).toEqual({ edit: "allow", bash: "deny", webfetch: "deny" }); expect(c.autoupdate).toBe(false); expect(c.share).toBe("disabled");
  });
});

describe("a turn through the driver", () => {
  test("auto edit runs opencode in the workspace, streams events into the transcript and trail, takes a checkpoint first, and records usage", async () => {
    rig = startRig();
    const sbx = execSandbox(() => play([
      { stream: "stdout", text: line({ type: "text", part: { text: "Fixing. " } }) + bash("npm test") },
      { stream: "stdout", text: line({ type: "tool_use", part: { tool: "edit", state: { status: "completed", input: { filePath: "src/a.ts" } } } }) },
      { stream: "stderr", text: "SECRET-IN-STDERR" },
      { stream: "stdout", text: line({ type: "step_finish", part: { tokens: { input: 40, output: 9 } } }) }, { exit: 0 },
    ]));
    wire(sbx);
    const a = owner(); const s = createCodingSession(a, input({ mode: "auto_edit", tier: "max" }));
    const t = submitTurn(a, s.id, "fix the bug"); await turnFinished(t.turn_id);
    expect(turnState(t.turn_id)).toBe("done");
    const exec = sbx.execs[0]!;
    expect(exec.argv.slice(0, 6)).toEqual(["opencode", "run", "--format", "json", "--model", "maipai/coding"]); expect(exec.argv.at(-1)).toBe("fix the bug"); expect(exec.argv).not.toContain("--continue");
    expect(exec.cwd).toBe("/workspace");
    const cfg = JSON.parse(exec.env!.OPENCODE_CONFIG_CONTENT!);
    expect(cfg.permission).toEqual({ edit: "allow", bash: "allow", webfetch: "deny" }); expect(cfg.provider.maipai.options.headers["x-maipai-coding-tier"]).toBe("max");
    const parts = listCodingMessages(a.id, s.id)[1]!.parts; expect(parts.map((p) => p.type)).toEqual(["text", "tool", "tool"]);
    expect(JSON.stringify(listCodingMessages(a.id, s.id))).not.toContain("SECRET-IN-STDERR");
    expect(listCodingEvents(a.id, s.id).map((e) => e.kind)).toEqual(["command", "file_write"]);
    expect(sbx.events).toEqual([`start:${s.id}`, "snapshot:Before your message"]);
    expect(getCodingSession(a, s.id)).toMatchObject({ state: "idle", usage: { input_tokens: 40, output_tokens: 9 }, checkpoints: [{ label: "Before your message", files: 2 }] });
  });
  test("a second message continues the OpenCode session", async () => {
    rig = startRig(); const sbx = execSandbox(() => play([{ exit: 0 }])); wire(sbx);
    const a = owner(); const s = createCodingSession(a, input({ mode: "auto_edit" }));
    const t1 = submitTurn(a, s.id, "one"); await turnFinished(t1.turn_id); const t2 = submitTurn(a, s.id, "two"); await turnFinished(t2.turn_id);
    expect(sbx.execs[1]!.argv).toContain("--continue");
  });
  test("plan mode turns edits and commands off without asking; ask mode holds the request and a deny turns the permission off", async () => {
    rig = startRig(); const sbx = execSandbox(() => play([{ exit: 0 }])); wire(sbx);
    const a = owner(); const plan = createCodingSession(a, input({ mode: "plan" }));
    const t1 = submitTurn(a, plan.id, "look"); await turnFinished(t1.turn_id);
    expect(JSON.parse(sbx.execs[0]!.env!.OPENCODE_CONFIG_CONTENT!).permission).toEqual({ edit: "deny", bash: "deny", webfetch: "deny" });
    const ask = createCodingSession(a, input({ mode: "ask", title: "Ask" }));
    const t2 = submitTurn(a, ask.id, "do"); await settled();
    expect(pendingRequestsFor(a.id, ask.id)[0]!.effect).toBe("file_write");
    answerHostRequest(a, ask.id, pendingRequestsFor(a.id, ask.id)[0]!.request_id, "allow"); await settled();
    answerHostRequest(a, ask.id, pendingRequestsFor(a.id, ask.id)[0]!.request_id, "deny"); await turnFinished(t2.turn_id);
    expect(JSON.parse(sbx.execs[1]!.env!.OPENCODE_CONFIG_CONTENT!).permission).toEqual({ edit: "allow", bash: "deny", webfetch: "deny" });
  });
  test("a non-zero exit fails the turn with a stopped-run and no text in the log", async () => {
    rig = startRig(); wire(execSandbox(() => play([{ stream: "stdout", text: bash("make", 1) }, { exit: 3 }])));
    const a = owner(); const s = createCodingSession(a, input({ mode: "auto_edit" }));
    const t = submitTurn(a, s.id, "x"); await turnFinished(t.turn_id);
    expect(turnState(t.turn_id)).toBe("failed"); expect(getCodingSession(a, s.id)!.state).toBe("failed");
    expect(listCodingMessages(a.id, s.id).at(-1)!.parts[0]).toEqual({ type: "stopped", reason: "error" });
  });
  test("Stop kills the exec and the wall-clock budget does the same", async () => {
    rig = startRig(); let ended = 0;
    const sbx = execSandbox((i) => (async function* () { await new Promise<void>((r) => i.signal.addEventListener("abort", () => r())); ended += 1; })());
    wire(sbx);
    const a = owner(); const s = createCodingSession(a, input({ mode: "auto_edit" }));
    const t1 = submitTurn(a, s.id, "x"); await settled(); stopCodingSession(a, s.id); await turnFinished(t1.turn_id);
    expect(ended).toBe(1); expect(turnState(t1.turn_id)).toBe("cancelled");
    __setBudgetMsForTests(30);
    const t2 = submitTurn(a, s.id, "y"); await turnFinished(t2.turn_id);
    expect(ended).toBe(2); expect(listCodingEvents(a.id, s.id).at(-1)!.detail).toEqual({ reason: "wall_clock" });
  });
  test("with no gateway address, or no way to sign in, a message is refused before anything starts", async () => {
    rig = startRig(); const sbx = execSandbox(() => play([{ exit: 0 }]));
    const a = owner(); const s = createCodingSession(a, input());
    wire(sbx, { gatewayUrl: () => null });
    expect(() => submitTurn(a, s.id, "x")).toThrow(CodingSessionError); expect(() => submitTurn(a, s.id, "x")).toThrow(/gateway address/);
    wire(sbx, { canMintKeys: () => false }); expect(() => submitTurn(a, s.id, "x")).toThrow(/sign in/);
    expect(sbx.events).toEqual([]); expect(sbx.execs).toEqual([]);
  });
  test("a message too long for the command line fails the turn instead of being cut", async () => {
    rig = startRig(); const sbx = execSandbox(() => play([{ exit: 0 }])); wire(sbx);
    const a = owner(); const s = createCodingSession(a, input({ mode: "auto_edit" }));
    const t = submitTurn(a, s.id, "x".repeat(100_001)); await turnFinished(t.turn_id);
    expect(turnState(t.turn_id)).toBe("failed"); expect(sbx.execs).toEqual([]);
  });
});

// Opt-in: needs a real sandbox image with OpenCode and a gateway key. MAIPAI_REAL_OPENCODE=1.
describe.skipIf(process.env.MAIPAI_REAL_OPENCODE !== "1")("real OpenCode in a real sandbox (opt-in)", () => {
  test("is exercised by hand against a sandbox image that contains OpenCode", () => { expect(process.env.MAIPAI_SANDBOX_GATEWAY_URL).toBeTruthy(); });
});
