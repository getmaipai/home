import { describe, expect, test, afterEach } from "bun:test";
import { getChatClient, restartChatBackend, stopChatBackend, getEngineStatus, sweepOrphanEngineProcesses, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { enginesDir } from "@/lib/paths";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setCrashBootHoldForTests } from "@/lib/dirtyBoot";
import { listIssues } from "@/lib/issues";

afterEach(() => {
  __resetLlmSupervisorForTests();
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
});
