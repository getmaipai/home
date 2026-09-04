import { describe, expect, test, afterEach } from "bun:test";
import { getChatClient, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { setHouseholdSettingValue } from "@/lib/settings";

afterEach(() => {
  __resetLlmSupervisorForTests();
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

  test("getChatClient falls back to the stub backend when nothing is configured", async () => {
    const client = await getChatClient();
    expect(await client.health()).toBe(true);
    // A second call reuses the same cached backend, not a new one.
    const second = await getChatClient();
    expect(second).toBe(client);
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
});
