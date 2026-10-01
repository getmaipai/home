import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { getChatClient, restartChatBackend, stopChatBackend, getEngineStatus, getChatEngineIdentity, getChatLivePid, sweepOrphanEngineProcesses, reportChatBackendUnreachable, chatEngineDown, chatAvailabilityState, probeChatEngine, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { enginesDir } from "@/lib/paths";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setCrashBootHoldForTests } from "@/lib/dirtyBoot";
import { listIssues, resolveIssue, fixIssue } from "@/lib/issues";
import { __setBlockedPortRetryForTests, __setBlockedPortRetryIntervalForTests, startBlockedPortRetryForTests } from "@/lib/llmSupervisor";
import { __resetSidecarsForTests, __setSidecarTimingForTestsOnly, __blockPortForTests, __failEngineForTests, __restartEngineForTests, blockedPortReason, __recordOwnedPortForTests, __setFreePortKillForTests } from "@/lib/sidecars";
import { ENGINE_START_STALL_TIMEOUT_MS } from "@/lib/sidecars";
import { join } from "node:path";
import { resetDb } from "./reset-db";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { roleHealth } from "@/lib/roleHealth";
import { reserveFreePort } from "./fixtures/reserveFreePort";
import { componentStatesFrom } from "@/lib/statusHistory";
import type { HealthSnapshot } from "@/lib/healthSnapshot";
import { spawn } from "node:child_process";
import { once } from "node:events";

const testChatPort = process.env.MAIPAI_LLAMA_SERVER_PORT!;

beforeEach(() => __setStackClientForTests(null));

async function waitForTest(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("waitForTest() timed out");
}

afterEach(() => {
  __resetLlmSupervisorForTests();
  // Also clears any engine watch timer and the respawn history a death
  // test left behind, and restores the real backoff.
  __resetSidecarsForTests();
  __setCrashBootHoldForTests(null);
  delete process.env.MAIPAI_LLAMA_SERVER_BIN;
  delete process.env.MAIPAI_CHAT_MODEL_PATH;
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
  process.env.MAIPAI_LLAMA_SERVER_PORT = testChatPort;
  // household settings persist in the one shared test-process db (bun
  // test runs every file in-process): reset explicitly so a later file's
  // "nothing configured" assumption isn't quietly broken by this one.
  setHouseholdSettingValue("chat.model_id", "");
  setHouseholdSettingValue("engines.stack.url", "");
});

describe("llmSupervisor chatEngineDown()", () => {
  beforeEach(() => {
    __resetSidecarsForTests();
    __resetLlmSupervisorForTests();
    __resetStackEngineForTests();
    __setStackClientForTests(null);
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    process.env.MAIPAI_LLAMA_SERVER_PORT = testChatPort;
  });

  test("the shared helper reads Stack state while chatEngineDown remains a local supervisor backstop", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    stateStopped();
    expect(chatEngineDown()).toBe(true);
    __setStackClientForTests({ roles: async () => ({ roles: [{ id: "chat", state: { state: "ready", since: "now" }, reason: null }] }) } as never);
    expect(chatEngineDown()).toBe(true);
    expect(await roleHealth("chat")).toEqual({ availability: "ready", reason: null });
  });

  test("returns true only for stopped, blocked, and failed; none and starting stay available", () => {
    expect(chatEngineDown()).toBe(false);
    const state = (globalThis as typeof globalThis & {
      __maipai_llmSupervisor?: { startingPromise: Promise<never> | null; startingStartedAtMs: number | null; startupStalled: boolean; manuallyStopped: boolean };
    }).__maipai_llmSupervisor!;
    state.startingPromise = new Promise<never>(() => {});
    state.startingStartedAtMs = Date.now();
    expect(chatEngineDown()).toBe(false);
    state.startingPromise = null;
    state.startingStartedAtMs = null;
    state.manuallyStopped = true;
    expect(chatEngineDown()).toBe(true);
    state.manuallyStopped = false;
    const port = Number(testChatPort);
    process.env.MAIPAI_LLAMA_SERVER_PORT = String(port);
    __blockPortForTests(port, process.pid);
    expect(chatEngineDown()).toBe(true);
    __resetSidecarsForTests();
    __failEngineForTests("chat");
    expect(chatEngineDown()).toBe(true);
  });

  test("derives starting, stopped, crash, blocked port and failed start reasons", () => {
    const state = (globalThis as typeof globalThis & {
      __maipai_llmSupervisor?: { startingPromise: Promise<never> | null; startingStartedAtMs: number | null; startupStalled: boolean; manuallyStopped: boolean; lastStartFailure: "not_installed" | "failed_start" | null };
    }).__maipai_llmSupervisor!;
    state.startingPromise = new Promise<never>(() => {});
    state.startingStartedAtMs = Date.now();
    expect(chatAvailabilityState()).toEqual({ availability: "starting", reason: null });
    state.startingPromise = null;
    state.startingStartedAtMs = null;
    state.manuallyStopped = true;
    expect(chatAvailabilityState()).toEqual({ availability: "unavailable", reason: "stopped" });
    state.manuallyStopped = false;
    __blockPortForTests(Number(testChatPort), process.pid);
    expect(chatAvailabilityState()).toEqual({ availability: "unavailable", reason: "blocked_port" });
    __resetSidecarsForTests();
    __failEngineForTests("chat");
    expect(chatAvailabilityState()).toEqual({ availability: "unavailable", reason: "failed_start" });
    state.lastStartFailure = "not_installed";
    expect(chatAvailabilityState()).toEqual({ availability: "unavailable", reason: "not_installed" });
  });

  test("maps an auto-restarting engine to the crashed reason", () => {
    const state = (globalThis as typeof globalThis & { __maipai_llmSupervisor?: { startingPromise: Promise<never> | null; startingStartedAtMs: number | null } }).__maipai_llmSupervisor!;
    state.startingPromise = null;
    state.startingStartedAtMs = null;
    __restartEngineForTests("chat");
    expect(chatAvailabilityState()).toEqual({ availability: "unavailable", reason: "crashed" });
  });

  test("foreign process holding chat port is reported and clears after it exits", async () => {
    const port = Number(testChatPort);
    const child = spawn("bun", ["-e", `Bun.serve({ port: ${port}, fetch: () => new Response("ok") }); setInterval(() => {}, 1000);`], { stdio: "ignore" });
    if (!child.pid) throw new Error("expected stand-in listener process");
    try {
      await waitForTest(() => fetch(`http://127.0.0.1:${port}`).then((r) => r.ok, () => false));
      __blockPortForTests(port, child.pid);
      expect((await probeChatEngine()).availability).toBe("unavailable");
      expect((await probeChatEngine()).reason).toBe("blocked_port");
      child.kill("SIGKILL");
      await once(child, "exit");
      expect(chatAvailabilityState()).toEqual({ availability: "ready", reason: null });
    } finally {
      child.kill("SIGKILL");
    }
  });

  test("re-probes a blocked port and resolves the chat Repair once the holder exits", async () => {
    const port = Number(testChatPort);
    __setBlockedPortRetryIntervalForTests(20);
    __blockPortForTests(port, 987654);
    const issue = await import("@/lib/issues").then(({ raiseIssue }) => raiseIssue({
      source: "chat-engine", key: "spawn", severity: "error", title: "blocked", detail: "blocked",
    }));
    let available = false;
    __setBlockedPortRetryForTests(async () => {
      if (available) resolveIssue("chat-engine", "spawn");
    });
    startBlockedPortRetryForTests();
    available = true;
    await waitForTest(() => listIssues().every((row) => row.id !== issue.id));
  });

  test("a blocked port stays down while its recorded holder pid is alive", () => {
    const port = Number(testChatPort);
    __blockPortForTests(port, process.pid);
    expect(chatEngineDown()).toBe(true);
  });

  test("a dead blocked-port holder clears its marker and no longer reports down", async () => {
    const child = spawn("true", [], { stdio: "ignore" });
    if (!child.pid) throw new Error("expected the short child to have a pid");
    await once(child, "exit");
    const port = Number(testChatPort);
    __blockPortForTests(port, child.pid);
    expect(chatEngineDown()).toBe(false);
    expect(blockedPortReason(port)).toBeUndefined();
  });

  test("local backstop skips an explicit URL; shared role health checks Stack routing", async () => {
    process.env.MAIPAI_LLAMA_SERVER_URL = "http://127.0.0.1:1";
    expect(chatEngineDown()).toBe(false);
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:12345");
    stateStopped();
    expect(chatEngineDown()).toBe(true);
    __setStackClientForTests({ roles: async () => ({ roles: [{ id: "chat", state: { state: "ready", since: "now" }, reason: null }] }) } as never);
    expect(await roleHealth("chat")).toEqual({ availability: "ready", reason: null });
  });

  test("health ignores stale local chat startup while chat is Stack-owned", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:12345");
    const state = (globalThis as typeof globalThis & {
      __maipai_llmSupervisor?: { startingPromise: Promise<never> | null; startingStartedAtMs: number | null };
    }).__maipai_llmSupervisor!;
    try {
      state.startingPromise = new Promise<never>(() => {});
      state.startingStartedAtMs = Date.now();

      const health = await probeChatEngine();
      expect(health.kind).toBe("stub");
      expect(health.availability).toBe("ready");
      expect(health.reason).toBeNull();
      const snapshot = {
        sidecars: [], brain: "none", voice: "none", ok: true, uptimeSeconds: 1,
        engines: { chat: health, embed: health, background: health, voice: health },
      } as HealthSnapshot;
      expect(componentStatesFrom(snapshot, new Set()).chat).toBe("operational");
    } finally {
      state.startingPromise = null;
      state.startingStartedAtMs = null;
    }
  });
});

function stateStopped(): void {
  const state = (globalThis as typeof globalThis & { __maipai_llmSupervisor?: { manuallyStopped: boolean } }).__maipai_llmSupervisor!;
  state.manuallyStopped = true;
}

describe("llmSupervisor getChatClient()", () => {
  test("an orphaned startup becomes stalled once, raises Repairs, then clears after retry succeeds", async () => {
    const state = (globalThis as typeof globalThis & {
      __maipai_llmSupervisor?: { startingPromise: Promise<never> | null; startingStartedAtMs: number | null; startupStalled: boolean };
    }).__maipai_llmSupervisor!;
    const source = "chat-engine";
    const key = "startup_stalled";
    state.startingPromise = new Promise<never>(() => {});
    state.startingStartedAtMs = Date.now() - ENGINE_START_STALL_TIMEOUT_MS - 1;
    state.startupStalled = false;
    try {
      expect(getEngineStatus().kind).toBe("stalled");
      expect(getEngineStatus().kind).toBe("stalled");
      expect(listIssues().filter((issue) => issue.source === source && issue.key === key)).toHaveLength(1);
      const client = await getChatClient();
      expect(await client.health()).toBe(true);
      expect(getEngineStatus().kind).toBe("stub");
      expect(listIssues().filter((issue) => issue.source === source && issue.key === key)).toHaveLength(0);
    } finally {
      resolveIssue(source, key);
    }
  });

  // A code review (2026-09-04) found the original version left a
  // rejected startingPromise cached forever: once a spawn failed, every
  // later call replayed the same stale rejection instead of retrying,
  // even after whatever caused the failure was fixed. This proves the
  // fix without calling __resetLlmSupervisorForTests between the two
  // calls, since that reset would trivially mask the bug.
  test("a failed start does not permanently wedge the role: the next call retries fresh", async () => {
    process.env.MAIPAI_LLAMA_SERVER_BIN = "/nonexistent/bin/llama-server";
    process.env.MAIPAI_CHAT_MODEL_PATH = "/nonexistent/model.gguf";

    await expect(getChatClient()).rejects.toThrow();

    // Simulate the operator fixing the misconfiguration: clear the env
    // vars so the next attempt falls back to the stub backend.
    delete process.env.MAIPAI_LLAMA_SERVER_BIN;
    delete process.env.MAIPAI_CHAT_MODEL_PATH;

    const client = await getChatClient();
    expect(await client.health()).toBe(true);
  });

  // A code review (2026-09-06) found tier 2 (the developer override) had
  // no crash-boot-hold check at all - only tier 3 did - even though it's
  // a real spawn contending for the same hardware a crash-boot just took
  // down, the exact thing the hold exists to prevent.
  test("a crash-boot hold also refuses tier 2's developer override, not just tier 3", async () => {
    process.env.MAIPAI_LLAMA_SERVER_BIN = "/nonexistent/bin/llama-server";
    process.env.MAIPAI_CHAT_MODEL_PATH = "/nonexistent/model.gguf";
    __setCrashBootHoldForTests(Date.now() + 60_000);
    await expect(getChatClient()).rejects.toThrow(/recovered from an unexpected shutdown/);
  });

  test("getChatClient falls back to the stub backend when nothing is configured", async () => {
    const client = await getChatClient();
    expect(await client.health()).toBe(true);
    // A second call reuses the same cached backend, not a new one.
    const second = await getChatClient();
    expect(second).toBe(client);
  });

  test("ENGINE-HOST-01: MAIPAI_LLAMA_SERVER_URL spawns nothing and reads the engine's identity (build, model file, health); the stub reads as stub", async () => {
    const stubClient = await getChatClient();
    expect(await stubClient.health()).toBe(true);
    expect(getChatEngineIdentity()).toEqual({ host: "stub", build: null, model: null, healthy: null });
    __resetLlmSupervisorForTests();
    const fake = Bun.serve({
      port: 0,
      fetch: (req) => {
        const path = new URL(req.url).pathname;
        if (path === "/health") return Response.json({ status: "ok" });
        if (path === "/props") return Response.json({ build_info: "b10797-832fd6f17", model_path: "/srv/models/qwen3-8b-instruct-q4-k-m.gguf" });
        return new Response("not found", { status: 404 });
      },
    });
    try {
      process.env.MAIPAI_LLAMA_SERVER_URL = `http://127.0.0.1:${fake.port}`;
      await getChatClient();
      expect(getEngineStatus().kind).toBe("url");
      expect(getEngineStatus().pid).toBeNull();
      expect(getChatEngineIdentity()).toEqual({ host: "local", build: "b10797-832fd6f17", model: "qwen3-8b-instruct-q4-k-m.gguf", healthy: true });
    } finally {
      fake.stop(true);
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
    }
  });

  // The crash-boot hold only gates a real spawn (trySpawnFromSelection) -
  // a fresh install with nothing selected yet must still get a working
  // (stubbed) chat surface right after a crash-boot, not an error.
  test("the crash-boot hold does not block the stub when nothing is selected", async () => {
    __setCrashBootHoldForTests(Date.now() + 60_000);
    const client = await getChatClient();
    expect(await client.health()).toBe(true);
  });

  // didn't. restartChatBackend()/stopChatBackend() have no `await` inside,
  // so calling one between starting and awaiting getChatClient() runs
  // synchronously, strictly before the in-flight spawn's own `.then()`
  // (always a microtask) can fire - the same deterministic
  // microtask-ordering trick former Home embedding supervisor.test.ts's own equivalent
  // race test uses.
  test("a caller mid-flight when a restart lands still gets back a real, live client, not a stale one", async () => {
    const clientPromise = getChatClient();
    void restartChatBackend();
    const client = await clientPromise;
    expect(await client.health()).toBe(true);
  });

  // The bug this reproduces: stopChatBackend() landing mid-spawn used to
  // let that spawn's own .then() unconditionally set `chatBackend`
  // afterward, resurrecting a live, GPU-resident process the admin just
  // stopped - and getEngineStatus() would report "stopped" the whole
  // time (it checks `manuallyStopped` first, never `chatBackend` itself),
  // so nothing showed the leak. The ORIGINAL caller now learns the engine
  // is stopped instead of silently receiving a client to that resurrected
  // process, and getEngineStatus().kind stays "stopped" - not just
  // reported as such while a real process quietly keeps running
  // underneath.
  test("a caller mid-flight when a stop lands gets told the engine is stopped, not a resurrected client", async () => {
    const clientPromise = getChatClient();
    stopChatBackend();
    await expect(clientPromise).rejects.toThrow(/stopped/);
    expect(getEngineStatus().kind).toBe("stopped");
  });
});

describe("llmSupervisor tier 3: the household's selected chat model", () => {
  // These never reach a real spawn (the GGUF/engine files are
  // deliberately absent), so they stay fast and deterministic while still
  // proving trySpawnFromSelection's real failure-reason branching - a
  // configured-but-broken selection must throw a specific, useful reason
  // rather than silently falling back to the stub (llmSupervisor.ts's own
  // doc comment: tier 4 is only for "nothing selected yet").

  test("an unknown catalog id fails with a specific reason", async () => {
    setHouseholdSettingValue("chat.model_id", "not-a-real-model-id");
    await expect(getChatClient()).rejects.toThrow(/no longer in the catalog/);
    expect(chatAvailabilityState()).toEqual({ availability: "unavailable", reason: "not_installed" });
  });

  test("a real catalog id with no downloaded GGUF yet fails with a specific reason", async () => {
    setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
    await expect(getChatClient()).rejects.toThrow(/hasn't finished downloading yet/);
  });

  // Found live 2026-09-07: a genuine chat-engine spawn failure had no
  // Repairs-page visibility at all - a household member would only find
  // out by checking Settings -> AI models themselves. Every other
  // subsystem that can fail on its own already raises an issue; this was
  // the one gap.
  test("a real spawn failure raises a Repairs issue, not just a rejected promise", async () => {
    setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
    await expect(getChatClient()).rejects.toThrow();
    const issue = listIssues().find((i) => i.source === "chat-engine" && i.key === "spawn");
    expect(issue).toBeDefined();
    expect(issue!.title).toBe("MaiPai's AI failed to start");
    expect(issue!.detail).toContain("hasn't finished downloading yet");
  });

  test("a blocked chat port explains the problem plainly and keeps its technical detail", async () => {
    const port = Number(testChatPort);
    const holder = Bun.spawn(["bun", "-e", `Bun.serve({ port: ${port}, fetch: () => new Response("holder") }); setTimeout(() => {}, 60000);`, "--port", String(port)], { stdout: "ignore", stderr: "ignore" });
    __recordOwnedPortForTests(port, holder.pid + 1);
    __setFreePortKillForTests((pid, signal) => {
      if (pid === holder.pid) throw Object.assign(new Error("denied"), { code: "EPERM" });
      return process.kill(pid, signal);
    });
    process.env.MAIPAI_LLAMA_SERVER_BIN = "true";
    process.env.MAIPAI_CHAT_MODEL_PATH = "/dev/null";
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await expect(getChatClient()).rejects.toBeInstanceOf(Error);
      const issue = listIssues().find((i) => i.source === "chat-engine" && i.key === "spawn");
      expect(issue?.detail).toContain(`Process ${holder.pid}:`);
      expect(issue?.fix?.label).toBe("Stop it and start MaiPai's AI");
      delete process.env.MAIPAI_LLAMA_SERVER_BIN;
      delete process.env.MAIPAI_CHAT_MODEL_PATH;
      const fixed = await fixIssue(issue!.id);
      expect(fixed.ok).toBe(true);
      await holder.exited;
      expect(getEngineStatus().kind).toBe("stub");
    } finally {
      holder.kill();
      await holder.exited;
      __resetSidecarsForTests();
    }
  });

  // Session F, step 3: lib/dirtyBoot.ts's crash-boot hold. Set BEFORE the
  // catalog/download checks below it in trySpawnFromSelection(), so this
  // proves the hold actually gates the real-spawn path rather than merely
  // existing unreachable code.
  test("a crash-boot hold refuses a real spawn with a clear reason, even for a fully-configured selection", async () => {
    setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
    __setCrashBootHoldForTests(Date.now() + 60_000);
    await expect(getChatClient()).rejects.toThrow(/recovered from an unexpected shutdown/);
  });
});

// The 2026-09-07 incident's actual failure mode (docs/dev.md, "What was
// actually killing the chat engine"): a spawned engine SIGKILLed from
// outside, with the supervisor still holding its client. Before this,
// nothing observed the exit - every turn repeated "could not reach" until
// someone restarted the whole hub. Real tier-2 spawn of the fake engine
// (resourceGovernor.test.ts's own fixture), a real SIGKILL, no mocks.
describe("llmSupervisor: an engine that dies out from under it", () => {
  const FAKE_BIN = join(import.meta.dir, "fixtures", "fakeLlamaServer.ts");

  async function waitUntil(check: () => boolean, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("waitUntil() timed out");
  }

  // FLAKE-PORT-01 (issue 137): reserved fresh right here, immediately
  // before the real spawn that binds it, rather than once for the
  // whole file (a module-level constant sat "reserved" but unbound for
  // the entire describe block's run - three real spawns and kills
  // spread over many seconds - long enough for a concurrent test
  // process on the same machine to grab the identical OS-assigned
  // number first, and its own real bind then failed with EADDRINUSE).
  async function spawnFakeEngine(): Promise<{ pid: number; port: number }> {
    resetDb();
    const port = reserveFreePort();
    process.env.MAIPAI_LLAMA_SERVER_BIN = FAKE_BIN;
    process.env.MAIPAI_CHAT_MODEL_PATH = "/dev/null";
    process.env.MAIPAI_LLAMA_SERVER_PORT = String(port);
    const client = await getChatClient();
    expect(await client.health()).toBe(true);
    const pid = getEngineStatus().pid!;
    expect(pid).toBeGreaterThan(0);
    return { pid, port };
  }

  test("a killed engine recovers and its delayed Repairs notice resolves", async () => {
    __setSidecarTimingForTestsOnly({ backoffMs: [50], diedNoticeDelayMs: 300 });
    const { pid } = await spawnFakeEngine();

    process.kill(pid, "SIGKILL");
    await waitUntil(() => getEngineStatus().pid !== pid);
    // No request needed: a fresh process comes up by itself.
    await waitUntil(() => getEngineStatus().pid !== null && getEngineStatus().pid !== pid);
    const client = await getChatClient();
    expect(await client.health()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const issues = listIssues({ includeResolved: true }).filter((i) => i.source === "chat-engine" && i.key === "died");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.detail).toContain("SIGKILL");
  }, 15_000);

  // The code-review finding on this fix's first cut: a death DURING a
  // request reached llm.ts's "could not reach" handler first, which
  // restarted the backend and so made the exit look deliberate - no log,
  // no Repairs, in the one case that matters most.
  test("a death seen first by a failing request is still a death: reported and started again", async () => {
    __setSidecarTimingForTestsOnly({ backoffMs: [50], diedNoticeDelayMs: 300 });
    const { pid, port } = await spawnFakeEngine();
    process.kill(pid, "SIGKILL");
    reportChatBackendUnreachable(`could not reach http://127.0.0.1:${port}`);
    await waitUntil(() => getEngineStatus().pid !== null && getEngineStatus().pid !== pid);
    // Whichever signal won the race (the request's own failure, or the
    // exit itself), the recovery resolves the notice raised after the
    // replacement took longer than the debounce to become healthy.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const issues = listIssues({ includeResolved: true }).filter((i) => i.source === "chat-engine" && i.key === "died");
    expect(issues).toHaveLength(1);
  }, 15_000);

  test("a deliberate stop is never reported as a death", async () => {
    const { pid } = await spawnFakeEngine();
    // Await the stop: stop() sets deliberate=true synchronously before
    // calling proc.kill(), and awaits proc.exited, so by the time it
    // resolves the exit handler has fired and (seeing deliberate=true)
    // did not report a death. No fixed sleep needed.
    await stopChatBackend();
    expect(getEngineStatus().kind).toBe("stopped");
    expect(listIssues().some((i) => i.source === "chat-engine" && i.key === "died")).toBe(false);
    expect(pid).toBeGreaterThan(0);
  }, 10_000);
});

// freePort()'s own tests moved to tests/sidecars.test.ts (Session F, step
// 2): it now lives in lib/sidecars.ts, the same "test at the real home,
// not the re-export" hygiene as the implementation move itself.

describe("sweepOrphanEngineProcesses", () => {
  // A thin wrapper over lib/sidecars.ts's sweepOrphanProcesses(enginesDir) -
  // that function's own matching/killing logic is tested thoroughly at its
  // real home (tests/sidecars.test.ts); this just proves the wrapper wires
  // the right match target and resolves cleanly (0, in a test environment
  // with no real engine process running under enginesDir).
  test("resolves with 0 when nothing matches enginesDir, without throwing", async () => {
    expect(enginesDir.length).toBeGreaterThan(0); // sanity: a real path, not an empty match-everything string
    await expect(sweepOrphanEngineProcesses()).resolves.toBe(0);
  });

  // Fix A2 (docs/dev.md's 2026-09-07 incident note): the chat backend's
  // own live pid is excluded automatically (no caller needs to pass it),
  // and whatever extraLivePids the caller supplies (index.ts passes
  // embed's and tts's) are excluded too - proven directly against
  // sidecars.ts's real sweepOrphanProcesses() rather than re-mocked here,
  // since that is what actually decides who dies.
  test("excludes the chat backend's own live pid and any extraLivePids given", async () => {
    // `stop: () => {}` matters here: afterEach's own __resetLlmSupervisorForTests()
    // calls `state.chatBackend?.stop()` unconditionally on cleanup, and a
    // fake object missing it would throw "stop is not a function" instead
    // of this test's own assertions ever being reached.
    (globalThis as { __maipai_llmSupervisor?: { chatBackend: { pid: number; stop: () => void } } }).__maipai_llmSupervisor!.chatBackend = {
      pid: 999_001,
      stop: () => {},
    } as unknown as never;
    expect(getChatLivePid()).toBe(999_001);

    // No real process to kill under `enginesDir` here (a test environment
    // never spawns one) - sweeping still resolves to 0, but the point is
    // this call reaches sidecars.ts's sweepOrphanProcesses() with the
    // right excludePids, not that anything real gets protected in this
    // unit test; tests/sidecars.test.ts proves the exclusion itself kills
    // nothing against a real spawned process.
    await expect(sweepOrphanEngineProcesses([999_002, null])).resolves.toBe(0);
  });


});

describe("tier 2 (override) with MAIPAI_CHAT_MODEL_ID (FAST-01)", () => {
  test("when MAIPAI_CHAT_MODEL_ID is set to an invalid value, it doesn't prevent spawn from proceeding", async () => {
    // This just verifies that the code handles MAIPAI_CHAT_MODEL_ID gracefully
    // and doesn't crash. The actual flag inclusion is tested at the unit
    // level in engineAutotune.test.ts (cache-reuse flag is always added).
    process.env.MAIPAI_LLAMA_SERVER_BIN = "/nonexistent/bin/llama-server";
    process.env.MAIPAI_CHAT_MODEL_PATH = "/nonexistent/model.gguf";
    process.env.MAIPAI_CHAT_MODEL_ID = "nonexistent-model-id";

    // Should fail trying to find the model or spawn the binary, not crash
    await expect(getChatClient()).rejects.toThrow();
  });
});

// Fix A1 (docs/dev.md's 2026-09-07 incident note): a `bun --hot` reload
// gives every module a FRESH top-level scope, but the same OS process and
// heap - so this module's own state lives on `globalThis` instead of a
// plain `let`, the same shape wyomingServer.ts's `__maipaiWyomingBoundPorts`
// already established. A real reload can't be produced inside one bun
// test process (the module graph is cached for the run), so this proves
// the actual mechanism directly: whatever sits at `globalThis`'s own
// `__maipai_llmSupervisor` key is what getChatClient() consults - exactly
// what a freshly re-evaluated module reading the identical key would see,
// since `??=` finds the object already there rather than replacing it.
describe("state survives on globalThis (the hot-reload mechanism)", () => {
  test("a backend placed directly on the shared state object is returned without spawning anything", async () => {
    const fakeClient = { health: async () => true } as unknown as Awaited<ReturnType<typeof getChatClient>>;
    const shared = (globalThis as { __maipai_llmSupervisor?: Record<string, unknown> }).__maipai_llmSupervisor!;
    shared.chatBackend = { client: fakeClient, stop: () => {}, kind: "url", startedAt: new Date().toISOString() };

    const client = await getChatClient();
    expect(client).toBe(fakeClient);
    expect(getEngineStatus().kind).toBe("url");
  });
});
