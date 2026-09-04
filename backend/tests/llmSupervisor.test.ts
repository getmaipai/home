import { describe, expect, test, afterEach } from "bun:test";
import { getChatClient, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";

afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_BIN;
  delete process.env.MAIPAI_CHAT_MODEL_PATH;
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
