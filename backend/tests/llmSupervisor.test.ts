import { describe, expect, test, afterEach } from "bun:test";
import { getChatClient, freePort, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
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

describe("freePort", () => {
  // A real, separate child process (not Bun.serve() in this test process
  // itself - freePort kills by pid, and killing the test runner's own pid
  // would kill the whole suite) proves the actual mechanism this guards
  // against tonight's live incident: an orphaned process left bound to
  // llmSupervisor's fixed port after a `--hot` reload wiped its tracking.
  test("kills a real process bound to the port and frees it for a new listener", async () => {
    const port = 39172; // arbitrary, unlikely to collide with anything else in CI
    // Trailing "--port <N>" args (unused by the script itself) are still
    // part of the OS-level argv `ps aux` shows - freePort matches on
    // exactly that substring, the same shape spawnLlamaServer's real
    // invocation always has, so this exercises the real matching logic
    // rather than a differently-shaped stand-in for it.
    const child = Bun.spawn(
      ["bun", "-e", `Bun.serve({ port: ${port}, fetch: () => new Response("ok") });`, "--port", String(port)],
      { stdout: "ignore", stderr: "ignore" },
    );
    try {
      // Wait for the child to actually be listening before trying to free it.
      const deadline = Date.now() + 5_000;
      let up = false;
      while (Date.now() < deadline && !up) {
        up = await fetch(`http://127.0.0.1:${port}`)
          .then(() => true)
          .catch(() => false);
        if (!up) await new Promise((r) => setTimeout(r, 50));
      }
      expect(up).toBe(true);

      await freePort(port);

      await expect(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();

      // A fresh listener can now bind the same port - proves it was
      // actually released, not just that the old process stopped answering.
      const server = Bun.serve({ port, fetch: () => new Response("new") });
      try {
        const res = await fetch(`http://127.0.0.1:${port}`);
        expect(await res.text()).toBe("new");
      } finally {
        server.stop(true);
      }
    } finally {
      child.kill(); // in case the test failed before freePort got to it
    }
  }, 10_000);

  test("a port nothing is listening on is a safe no-op", async () => {
    await expect(freePort(39173)).resolves.toBeUndefined();
  });

  // A code review (2026-09-04) found the original matcher used a plain
  // substring test ("--port 8788".includes(...)) - true for a process
  // invoked with "--port 87889", since 8788 is a numeric prefix of it.
  // Freeing 8788 would have killed a real, unrelated process on 87889.
  test("never kills a process whose port has the target port as a numeric prefix", async () => {
    const targetPort = 3917; // freePort's argument
    const decoyPort = 39174; // has 3917 as a literal numeric prefix, still a valid TCP port (<= 65535)
    const decoy = Bun.spawn(
      ["bun", "-e", `Bun.serve({ port: ${decoyPort}, fetch: () => new Response("decoy") });`, "--port", String(decoyPort)],
      { stdout: "ignore", stderr: "ignore" },
    );
    try {
      const deadline = Date.now() + 5_000;
      let up = false;
      while (Date.now() < deadline && !up) {
        up = await fetch(`http://127.0.0.1:${decoyPort}`)
          .then(() => true)
          .catch(() => false);
        if (!up) await new Promise((r) => setTimeout(r, 50));
      }
      expect(up).toBe(true);

      await freePort(targetPort); // nothing is actually listening on this one

      // The decoy must still be alive and answering.
      const res = await fetch(`http://127.0.0.1:${decoyPort}`);
      expect(await res.text()).toBe("decoy");
    } finally {
      decoy.kill();
    }
  }, 10_000);
});
