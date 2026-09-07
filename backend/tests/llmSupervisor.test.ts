import { describe, expect, test, afterEach } from "bun:test";
import { getChatClient, restartChatBackend, stopChatBackend, getEngineStatus, getChatLivePid, sweepOrphanEngineProcesses, reportChatBackendUnreachable, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { enginesDir } from "@/lib/paths";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setCrashBootHoldForTests } from "@/lib/dirtyBoot";
import { listIssues } from "@/lib/issues";
import { __resetSidecarsForTests, __setSidecarTimingForTestsOnly } from "@/lib/sidecars";
import { join } from "node:path";
import { resetDb } from "./reset-db";

afterEach(() => {
  __resetLlmSupervisorForTests();
  // Also clears any engine watch timer and the respawn history a death
  // test left behind, and restores the real backoff.
  __resetSidecarsForTests();
  __setCrashBootHoldForTests(null);
  delete process.env.MAIPAI_LLAMA_SERVER_BIN;
  delete process.env.MAIPAI_CHAT_MODEL_PATH;
  // household settings persist in the one shared test-process db (bun
  // test runs every file in-process): reset explicitly so a later file's
  // "nothing configured" assumption isn't quietly broken by this one.
  setHouseholdSettingValue("chat.model_id", "");
});

describe("llmSupervisor getChatClient()", () => {
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

  // The crash-boot hold only gates a real spawn (trySpawnFromSelection) -
  // a fresh install with nothing selected yet must still get a working
  // (stubbed) chat surface right after a crash-boot, not an error.
  test("the crash-boot hold does not block the stub when nothing is selected", async () => {
    __setCrashBootHoldForTests(Date.now() + 60_000);
    const client = await getChatClient();
    expect(await client.health()).toBe(true);
  });

  // COR-1 (code review, 2026-09-06): embedSupervisor.ts's identical
  // getEmbedClient() already had this generation guard; getChatClient()
  // didn't. restartChatBackend()/stopChatBackend() have no `await` inside,
  // so calling one between starting and awaiting getChatClient() runs
  // synchronously, strictly before the in-flight spawn's own `.then()`
  // (always a microtask) can fire - the same deterministic
  // microtask-ordering trick embedSupervisor.test.ts's own equivalent
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

  async function spawnFakeEngine(): Promise<number> {
    resetDb();
    process.env.MAIPAI_LLAMA_SERVER_BIN = FAKE_BIN;
    process.env.MAIPAI_CHAT_MODEL_PATH = "/dev/null";
    const client = await getChatClient();
    expect(await client.health()).toBe(true);
    const pid = getEngineStatus().pid!;
    expect(pid).toBeGreaterThan(0);
    return pid;
  }

  test("a killed engine is noticed and started again on its own: status drops it, Repairs says how it died, then clears once it is back", async () => {
    __setSidecarTimingForTestsOnly({ backoffMs: [50] });
    const pid = await spawnFakeEngine();

    process.kill(pid, "SIGKILL");
    await waitUntil(() => getEngineStatus().pid !== pid);
    const issue = listIssues({ includeResolved: true }).find((i) => i.source === "chat-engine" && i.key === "died");
    expect(issue).toBeDefined();
    expect(issue!.title).toBe("MaiPai's AI stopped unexpectedly");
    expect(issue!.detail).toContain("SIGKILL");

    // No request needed: a fresh process comes up by itself and the
    // issue closes.
    await waitUntil(() => getEngineStatus().pid !== null && getEngineStatus().pid !== pid);
    const client = await getChatClient();
    expect(await client.health()).toBe(true);
    await waitUntil(() => !listIssues().some((i) => i.source === "chat-engine" && i.key === "died"));
  }, 15_000);

  // The code-review finding on this fix's first cut: a death DURING a
  // request reached llm.ts's "could not reach" handler first, which
  // restarted the backend and so made the exit look deliberate - no log,
  // no Repairs, in the one case that matters most.
  test("a death seen first by a failing request is still a death: reported and started again", async () => {
    __setSidecarTimingForTestsOnly({ backoffMs: [50] });
    const pid = await spawnFakeEngine();
    process.kill(pid, "SIGKILL");
    reportChatBackendUnreachable("could not reach http://127.0.0.1:48788");
    await waitUntil(() => getEngineStatus().pid !== null && getEngineStatus().pid !== pid);
    // Whichever signal won the race (the request's own failure, or the
    // exit itself), it was reported as a death and healed.
    const issue = listIssues({ includeResolved: true }).find((i) => i.source === "chat-engine" && i.key === "died");
    expect(issue?.detail).toMatch(/stopped answering|SIGKILL/);
  }, 15_000);

  test("a deliberate stop is never reported as a death", async () => {
    const pid = await spawnFakeEngine();
    stopChatBackend();
    // Long enough for the killed process's exit to be observed if it were
    // going to be mistaken for one.
    await new Promise((r) => setTimeout(r, 500));
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
