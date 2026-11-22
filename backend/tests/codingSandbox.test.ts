// CODE-SANDBOX-01 (Home side): the sandbox client against a fake Stack. The fake serves what the real Stack serves (create, get, stop, delete) and the proposed
// exec and snapshot routes. Anything that needs a real machine is in the opt-in test at the bottom (MAIPAI_REAL_SANDBOX=1), like the Stack's network gate.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStackClient } from "@/lib/stack/client";
import { createStackSandbox, SandboxClientError, type ExecChunk } from "@/lib/codingSandbox";
import { createCodingSession } from "@/lib/codingSessions";
import { __setWorkspaceRootForTests, codingWorkspace } from "@/lib/codingShare";
import { input, owner, startRig } from "./codingRig";

interface Machine { state: "running" | "stopped" }
function fakeStack(over: { createStatus?: number; createState?: string; noExec?: boolean } = {}) {
  const machines = new Map<string, Machine>(); const calls: string[] = []; const bodies: unknown[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname; const method = (init?.method ?? "GET").toUpperCase(); calls.push(`${method} ${path}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined; bodies.push(body);
    const m = path.match(/^\/stack\/v1\/sandboxes(?:\/([^/]+)(?:\/(.*))?)?$/);
    if (!m) return json(404, { error: "no" });
    const [, id, rest] = m;
    if (!id && method === "POST") {
      if (over.createStatus && over.createStatus !== 201) return json(over.createStatus, { error: over.createStatus === 503 ? "The container system is not running." : "The sandbox's network lock did not load, so the machine was removed and nothing ran in it." });
      machines.set(body.id, { state: "running" }); return json(201, { id: body.id, state: over.createState ?? "running" });
    }
    if (id && !rest && method === "GET") return machines.has(id) ? json(200, { id, state: machines.get(id)!.state }) : json(404, { error: "No sandbox has this id." });
    if (id && !rest && method === "DELETE") { if (!machines.delete(id)) return json(404, { error: "none" }); return json(200, { ok: true }); }
    if (id && rest === "stop") { if (!machines.has(id)) return json(404, { error: "none" }); machines.get(id)!.state = "stopped"; return json(200, { id, state: "stopped" }); }
    if (over.noExec && (rest === "exec" || rest?.startsWith("snapshots"))) return json(404, { error: "Not found" });
    if (rest === "exec") {
      const lines = [{ stream: "stdout", text: "hello\n" }, { stream: "stderr", text: "warn\n" }, { exit: 0 }].map((l) => JSON.stringify(l)).join("\n") + "\n";
      if (body.argv[0] === "slow") return new Response(new ReadableStream({ start() { /* never ends until aborted */ }, cancel() { calls.push("CANCELLED"); } }), { status: 200 });
      return new Response(lines, { status: 200, headers: { "content-type": "application/x-ndjson" } });
    }
    if (rest === "snapshots") return json(201, { id: "snap-1", files: 7 });
    if (rest?.endsWith("/restore")) return json(200, { ok: true });
    return json(404, { error: "no" });
  }) as unknown as typeof fetch;
  return { fetchFn, machines, calls, bodies };
}
let rig: ReturnType<typeof startRig>; let root = "";
beforeEach(() => { rig = startRig(); root = mkdtempSync(join(tmpdir(), "code-sbx-")); __setWorkspaceRootForTests(root); });
afterEach(() => { rig.restore(); __setWorkspaceRootForTests(null); rmSync(root, { recursive: true, force: true }); });
const sandboxOn = (stack: ReturnType<typeof fakeStack>) => { const client = createStackClient({ baseUrl: "http://127.0.0.1:1", fetch: stack.fetchFn }); return createStackSandbox(() => client); };
const collect = async (it: AsyncIterable<ExecChunk>) => { const out: ExecChunk[] = []; for await (const c of it) out.push(c); return out; };

describe("create, reuse, stop, delete", () => {
  test("start creates the machine on the session's workspace with no network and creates the folder", async () => {
    const stack = fakeStack(); const a = owner(); const s = createCodingSession(a, input());
    await sandboxOn(stack).start({ sessionId: s.id, environmentId: "cenv-abcdef12" });
    expect(stack.calls).toEqual(["GET /stack/v1/sandboxes/" + s.id, "POST /stack/v1/sandboxes"]);
    expect(stack.bodies[1]).toEqual({ id: s.id, workspace: codingWorkspace(a.id, s.id), network: { policy: "none", hosts: [] } });
    expect(existsSync(codingWorkspace(a.id, s.id))).toBe(true);
  });
  test("a running machine is reused; a stopped one is removed and made again", async () => {
    const stack = fakeStack(); const a = owner(); const s = createCodingSession(a, input()); const sbx = sandboxOn(stack);
    await sbx.start({ sessionId: s.id, environmentId: "x" }); stack.calls.length = 0;
    await sbx.start({ sessionId: s.id, environmentId: "x" }); expect(stack.calls).toEqual(["GET /stack/v1/sandboxes/" + s.id]);
    await sbx.stop(s.id); stack.calls.length = 0;
    await sbx.start({ sessionId: s.id, environmentId: "x" });
    expect(stack.calls.map((c) => c.split(" ")[0])).toEqual(["GET", "DELETE", "POST"]);
  });
  test("a failed lock fails closed with the Stack's sentence, and so does anything not clearly running", async () => {
    const a = owner(); const s = createCodingSession(a, input());
    const err = await sandboxOn(fakeStack({ createStatus: 500 })).start({ sessionId: s.id, environmentId: "x" }).then(() => null, (e) => e as SandboxClientError);
    expect(err).toBeInstanceOf(SandboxClientError); expect(err!.reason).toBe("lock_not_ready"); expect(err!.message).toContain("network lock did not load");
    const odd = await sandboxOn(fakeStack({ createState: "stopped" })).start({ sessionId: s.id, environmentId: "x" }).then(() => null, (e) => e as SandboxClientError);
    expect(odd!.reason).toBe("lock_not_ready");
    const down = await sandboxOn(fakeStack({ createStatus: 503 })).start({ sessionId: s.id, environmentId: "x" }).then(() => null, (e) => e as SandboxClientError);
    expect(down!.reason).toBe("unavailable");
  });
  test("an older engine with no sandbox calls, and a session that allows hosts, are refused before anything starts", async () => {
    const a = owner(); const s = createCodingSession(a, input());
    const plain = createStackSandbox(() => ({ } as never));
    expect((await plain.start({ sessionId: s.id, environmentId: "x" }).catch((e) => e)).reason).toBe("unavailable");
    const hosts = createCodingSession(a, input({ title: "H", network: { policy: "hosts", hosts: ["example.com"] } }));
    const stack = fakeStack();
    expect((await sandboxOn(stack).start({ sessionId: hosts.id, environmentId: "x" }).catch((e) => e)).reason).toBe("bad_request");
    expect(stack.calls).toEqual([]);
  });
  test("stop and destroy tolerate a machine that is already gone", async () => {
    const stack = fakeStack(); const sbx = sandboxOn(stack);
    await sbx.stop("csess-gone000001"); await sbx.destroy("csess-gone000001");
  });
  test("the client only reaches the sandbox routes", async () => {
    const client = createStackClient({ baseUrl: "http://127.0.0.1:1", fetch: fakeStack().fetchFn });
    await expect(client.sandboxCall!("GET", "/stack/v1/roles")).rejects.toThrow();
  });
});

describe("exec and snapshots", () => {
  test("exec yields stdout, stderr and the exit code from the stream", async () => {
    const stack = fakeStack(); const chunks = await collect(sandboxOn(stack).exec({ sessionId: "csess-abcdef0001", argv: ["echo"], signal: new AbortController().signal }));
    expect(chunks).toEqual([{ stream: "stdout", text: "hello\n" }, { stream: "stderr", text: "warn\n" }, { exit: 0 }]);
  });
  test("Stop kills the exec: aborting the signal ends the stream and cancels the request", async () => {
    const stack = fakeStack(); const ctl = new AbortController();
    const run = collect(sandboxOn(stack).exec({ sessionId: "csess-abcdef0001", argv: ["slow"], signal: ctl.signal }));
    setTimeout(() => ctl.abort(), 20);
    expect(await run).toEqual([]); expect(stack.calls).toContain("CANCELLED");
  });
  test("a Stack that does not serve exec or snapshots gives a plain feature-missing error", async () => {
    const sbx = sandboxOn(fakeStack({ noExec: true }));
    expect((await collect(sbx.exec({ sessionId: "csess-abcdef0001", argv: ["x"], signal: new AbortController().signal })).catch((e) => e)).reason).toBe("feature_missing");
    expect((await sbx.snapshot({ sessionId: "csess-abcdef0001", label: "x" }).catch((e) => e)).reason).toBe("feature_missing");
  });
  test("a snapshot returns its id and file count, and restore calls the restore route", async () => {
    const stack = fakeStack(); const sbx = sandboxOn(stack);
    expect(await sbx.snapshot({ sessionId: "csess-abcdef0001", label: "Before" })).toEqual({ id: "snap-1", files: 7 });
    await sbx.restoreCheckpoint!({ sessionId: "csess-abcdef0001", checkpointId: "snap-1" });
    expect(stack.calls.at(-1)).toBe("POST /stack/v1/sandboxes/csess-abcdef0001/snapshots/snap-1/restore");
  });
});

// Opt-in: needs the Stack's sandbox routes and Apple's container system on this computer. Run with MAIPAI_REAL_SANDBOX=1 and a Stack that serves /stack/v1/sandboxes.
describe.skipIf(process.env.MAIPAI_REAL_SANDBOX !== "1")("a real sandbox (opt-in)", () => {
  test("a session's machine starts behind its lock, runs a command and is removed", async () => {
    const a = owner(); const s = createCodingSession(a, input()); const sbx = createStackSandbox(() => createStackClient());
    await sbx.start({ sessionId: s.id, environmentId: "x" });
    expect((await collect(sbx.exec({ sessionId: s.id, argv: ["echo", "ok"], signal: new AbortController().signal }))).some((c) => "exit" in c && c.exit === 0)).toBe(true);
    await sbx.destroy(s.id);
  });
});
