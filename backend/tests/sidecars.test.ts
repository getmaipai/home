import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  registerSidecar,
  getSidecar,
  listSidecars,
  startSidecar,
  stopSidecar,
  spawnAndWaitHealthy,
  freePort,
  sweepOrphanProcesses,
  watchEngine,
  probeAlive,
  cancelEngineRespawn,
  engineRespawnState,
  registerGracefulExit,
  __resetSidecarsForTests,
  __setSidecarTimingForTestsOnly,
  blockedPortReason,
  ForeignPortHolderError,
  __recordOwnedPortForTests,
  __resetPortOwnershipForTests,
} from "@/lib/sidecars";
import { listIssues, fixIssue, __resetFixHandlersForTests } from "@/lib/issues";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { join } from "node:path";
import { getChatClient, getChatLivePid, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { logsDir } from "@/lib/paths";

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
  __resetSidecarsForTests();
});

afterEach(() => {
  __resetSidecarsForTests();
});

async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitUntil() timed out");
}

describe("registerSidecar/getSidecar/listSidecars", () => {
  test("a registered sidecar starts stopped with no base URL until given a port", () => {
    registerSidecar({ id: "no-port", command: ["true"] });
    expect(getSidecar("no-port")).toEqual({ status: "stopped", baseUrl: null });
  });

  test("baseUrl is derived from the declared port", () => {
    registerSidecar({ id: "with-port", command: ["true"], port: 9999 });
    expect(getSidecar("with-port")!.baseUrl).toBe("http://127.0.0.1:9999");
  });

  test("an unregistered id returns undefined, not a default row", () => {
    expect(getSidecar("nope")).toBeUndefined();
  });

  test("listSidecars orders by startupOrder ascending", () => {
    registerSidecar({ id: "third", command: ["true"], startupOrder: 3 });
    registerSidecar({ id: "first", command: ["true"], startupOrder: 1 });
    registerSidecar({ id: "second", command: ["true"], startupOrder: 2 });
    expect(listSidecars().map((s) => s.id)).toEqual(["first", "second", "third"]);
  });
});

describe("spawnAndWaitHealthy", () => {
  test("returns the process once healthCheck passes", async () => {
    const port = 39201;
    const proc = await spawnAndWaitHealthy({
      command: ["bun", "-e", `Bun.serve({ port: ${port}, fetch: () => new Response("ok") });`],
      port,
      healthCheck: () => fetch(`http://127.0.0.1:${port}`).then(() => true, () => false),
      label: "test server",
    });
    try {
      expect(proc.exitCode).toBeNull();
    } finally {
      proc.kill();
    }
  });

  test("fails fast when the process exits before ever becoming healthy, rather than waiting out the full timeout", async () => {
    const started = Date.now();
    await expect(
      spawnAndWaitHealthy({
        command: ["bun", "-e", "process.exit(1)"],
        healthCheck: async () => false,
        timeoutMs: 30_000,
        label: "doomed process",
      }),
    ).rejects.toThrow(/exited early/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  // LAT-00: the engine's own stdout, "neither shows in the logs today" -
  // a rotating file beside hub.log (reusing hub.log's own createLogger,
  // never a second rotation implementation), while still visible in the
  // terminal (unchanged debug visibility under `bun run dev`).
  test("logName pipes stdout/stderr into a rotating <logName>.log, still visible on the real terminal", async () => {
    const port = 39202;
    const proc = await spawnAndWaitHealthy({
      command: ["bun", "-e", `console.log("hello from the engine"); console.error("a warning"); Bun.serve({ port: ${port}, fetch: () => new Response("ok") });`],
      port,
      healthCheck: () => fetch(`http://127.0.0.1:${port}`).then(() => true, () => false),
      label: "logged test server",
      logName: "test-engine",
    });
    try {
      expect(proc.exitCode).toBeNull();
      // The write is async (a piped stream, read line by line) - polled
      // rather than a fixed sleep, the same reasoning every other
      // eventually-consistent check in this suite already uses.
      const logPath = join(logsDir, "test-engine.log");
      let content = "";
      for (let i = 0; i < 30; i++) {
        content = await Bun.file(logPath).text().catch(() => "");
        if (content.includes("hello from the engine")) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(content).toContain("hello from the engine");
      expect(content).toContain("a warning");
    } finally {
      proc.kill();
    }
  });
});

describe("startSidecar/stopSidecar", () => {
  test("reaches running with a real health check, then stops and frees its port", async () => {
    const port = 39202;
    registerSidecar({
      id: "health-server",
      command: ["bun", "-e", `Bun.serve({ port: ${port}, fetch: () => new Response("ok") });`],
      port,
      healthUrl: `http://127.0.0.1:${port}`,
    });
    await startSidecar("health-server");
    expect(getSidecar("health-server")).toEqual({ status: "running", baseUrl: `http://127.0.0.1:${port}` });

    await stopSidecar("health-server");
    expect(getSidecar("health-server")!.status).toBe("stopped");

    // The port must actually free up - a fresh listener can bind it.
    // proc.kill() only sends the signal; the kernel's own socket teardown
    // isn't guaranteed synchronous with it, so this retries the bind
    // briefly rather than asserting on the very next tick.
    function tryBind(): ReturnType<typeof Bun.serve> | null {
      try {
        return Bun.serve({ port, fetch: () => new Response("new") });
      } catch {
        return null;
      }
    }
    let server = tryBind();
    const deadline = Date.now() + 5_000;
    while (!server && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      server = tryBind();
    }
    expect(server).not.toBeNull();
    try {
      const res = await fetch(`http://127.0.0.1:${port}`);
      expect(await res.text()).toBe("new");
    } finally {
      server?.stop(true);
    }
  });

  test("a sidecar with no health URL is considered running once its process is up", async () => {
    registerSidecar({ id: "no-health-url", command: ["bun", "-e", "setTimeout(() => {}, 60000)"] });
    await startSidecar("no-health-url");
    expect(getSidecar("no-health-url")!.status).toBe("running");
    await stopSidecar("no-health-url");
  });

  test("a command that can never spawn ends crashed and raises a real Repairs issue with a working fix", async () => {
    registerSidecar({ id: "bad-command", command: ["definitely-not-a-real-binary-xyz"] });
    await startSidecar("bad-command");
    expect(getSidecar("bad-command")!.status).toBe("crashed");

    const issues = listIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.source).toBe("sidecar:bad-command");
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.fix).toEqual({ label: "Restart bad-command", action: "restart_sidecar:bad-command" });

    // The fix handler is real: running it (still against the same broken
    // command) fails - fixIssue()'s own contract (tests/issues.test.ts)
    // is that a throwing handler rejects rather than resolving to
    // { ok: false }, leaving the issue open rather than marking a
    // still-broken sidecar fixed.
    await expect(fixIssue(issues[0]!.id)).rejects.toThrow(/did not come back up/);
    expect(listIssues()).toHaveLength(1);
  });

  test("fixIssue's restart action genuinely brings a since-repaired sidecar back and resolves the issue", async () => {
    const port = 39203;
    // Registered with a command that fails the first time (a script
    // whose behavior depends on an env var this test flips), proving the
    // fix handler doesn't just report success unconditionally.
    registerSidecar({ id: "flaky", command: ["bun", "-e", "process.exit(1)"] });
    await startSidecar("flaky");
    const issue = listIssues()[0]!;
    expect(issue.source).toBe("sidecar:flaky");

    // "Repair" it by re-registering with a command that actually works,
    // the same way a real fix action would swap in a working config.
    registerSidecar({
      id: "flaky",
      command: ["bun", "-e", `Bun.serve({ port: ${port}, fetch: () => new Response("ok") });`],
      port,
      healthUrl: `http://127.0.0.1:${port}`,
    });
    const result = await fixIssue(issue.id);
    expect(result.ok).toBe(true);
    expect(getSidecar("flaky")!.status).toBe("running");
    expect(listIssues()).toHaveLength(0);
    await stopSidecar("flaky");
  });

  // A code review (2026-09-06) found startSidecar() never re-checked
  // `stopping` after its await: a stopSidecar() call landing while the
  // spawn was still in flight found entry.proc still null (its own
  // kill() was a no-op) and left status "stopped", but the start then
  // resolved anyway and unconditionally overwrote that back to "running"
  // - resurrecting a sidecar someone had just explicitly stopped, with
  // no health loop watching it (startHealthLoop() would see `stopping`
  // already true and refuse to poll).
  test("a stopSidecar() call that races a still-starting spawn wins - the sidecar stays stopped and its process is killed", async () => {
    const port = 39207;
    registerSidecar({
      id: "racy",
      // Deliberately slow to become healthy, so there's a real window to
      // race a stop into: this only starts listening after a delay, not
      // instantly, matching how a real sidecar (a search index warming
      // up, a model loading) can take real time between spawn and health.
      command: ["bun", "-e", `setTimeout(() => Bun.serve({ port: ${port}, fetch: () => new Response("ok") }), 700);`],
      port,
      healthUrl: `http://127.0.0.1:${port}`,
    });

    const startPromise = startSidecar("racy");
    await new Promise((r) => setTimeout(r, 50)); // let the spawn actually begin
    expect(getSidecar("racy")!.status).toBe("starting");

    await stopSidecar("racy");
    expect(getSidecar("racy")!.status).toBe("stopped");

    await startPromise; // the original start resolves once the delayed server comes up

    // The race must not have flipped this back to "running".
    expect(getSidecar("racy")!.status).toBe("stopped");

    // And the process the delayed spawn eventually produced must
    // actually have been killed, not merely un-tracked.
    await waitUntil(async () => {
      const up = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(300) }).then(() => true, () => false);
      return !up;
    }, 5_000);
  }, 10_000);
});

describe("the health-poll loop", () => {
  test("detects a crash, raises an issue, and auto-restarts with backoff", async () => {
    __setSidecarTimingForTestsOnly({ healthPollMs: 100, backoffMs: [50] });
    const port = 39204;
    // A marker file makes it crash exactly once, on its first boot -
    // without it, the identical command would also self-destruct on the
    // auto-restart's respawn (and every respawn after that), making
    // "comes back and stays up" nondeterministic to observe from outside.
    const markerPath = `${require("node:os").tmpdir()}/maipai-sidecar-test-crash-once-${port}`;
    require("node:fs").rmSync(markerPath, { force: true });
    registerSidecar({
      id: "crashes-soon",
      command: [
        "bun",
        "-e",
        `const fs = require("node:fs"); const p = ${JSON.stringify(markerPath)}; Bun.serve({ port: ${port}, fetch: () => new Response("ok") }); if (!fs.existsSync(p)) { fs.writeFileSync(p, "1"); setTimeout(() => process.exit(1), 300); }`,
      ],
      port,
      healthUrl: `http://127.0.0.1:${port}`,
    });
    try {
      await startSidecar("crashes-soon");
      expect(getSidecar("crashes-soon")!.status).toBe("running");

      await waitUntil(() => listIssues().some((i) => i.source === "sidecar:crashes-soon"), 5_000);
      const issue = listIssues().find((i) => i.source === "sidecar:crashes-soon")!;
      expect(issue.severity).toBe("error");

      // The marker is already written, so the auto-restart's respawn
      // stays up this time - the health loop's own retry, not a person
      // clicking Fix, should bring it back and resolve the issue on its
      // own.
      await waitUntil(() => getSidecar("crashes-soon")!.status === "running", 5_000);
      await waitUntil(() => listIssues().length === 0, 5_000);
    } finally {
      await stopSidecar("crashes-soon");
      require("node:fs").rmSync(markerPath, { force: true });
    }
  }, 15_000);
});

describe("registerGracefulExit", () => {
  test("kills every running sidecar's process on the exit event", async () => {
    const port = 39205;
    registerSidecar({
      id: "exit-victim",
      command: ["bun", "-e", `Bun.serve({ port: ${port}, fetch: () => new Response("ok") });`],
      port,
      healthUrl: `http://127.0.0.1:${port}`,
    });
    await startSidecar("exit-victim");
    expect(getSidecar("exit-victim")!.status).toBe("running");

    registerGracefulExit();
    // Synthetic, not a real process exit: this only invokes the
    // listeners registerGracefulExit() attached to "exit" (a plain
    // EventEmitter event on `process`), so the test process itself
    // keeps running - only the child sidecar process this test spawned
    // is expected to die.
    process.emit("exit", 0);

    await waitUntil(async () => {
      const up = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(300) }).then(() => true, () => false);
      return !up;
    }, 5_000);
  });
});

describe("GET /api/health", () => {
  test("requires a signed-in person and reports every registered sidecar", async () => {
    const client = new TestClient();
    const anon = await client.get("/api/health");
    expect(anon.status).toBe(401);

    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    registerSidecar({ id: "reported", command: ["true"], port: 12345, startupOrder: 1 });
    const res = await client.get("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sidecars: unknown[]; ok: boolean; engines: Record<string, { kind: string; alive: boolean | null }> };
    expect(body.sidecars).toEqual([{ id: "reported", status: "stopped", baseUrl: "http://127.0.0.1:12345" }]);
    // Nothing has been asked to start yet, so there is nothing to probe
    // and nothing wrong: `alive` is null (not false) and the page reads ok.
    expect(body.ok).toBe(true);
    expect(body.engines.chat!.alive).toBeNull();
  });

  // The Health page kept saying fine while the chat engine was dead
  // (2026-09-07): it showed the engine's configured kind, never a probe.
  test("reports a dead chat engine as not alive and the hub as not ok", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    process.env.MAIPAI_LLAMA_SERVER_BIN = join(import.meta.dir, "fixtures", "fakeLlamaServer.ts");
    process.env.MAIPAI_CHAT_MODEL_PATH = "/dev/null";
    try {
      await getChatClient();
      const up = (await (await client.get("/api/health")).json()) as { ok: boolean; engines: { chat: { alive: boolean | null; pid: number | null } } };
      expect(up.ok).toBe(true);
      expect(up.engines.chat.alive).toBe(true);

      // Kill it and wait for the watch's own drop to land - a fixed sleep
      // here flaked under load (a code review, 2026-09-07): too short and
      // the exit hadn't been observed yet, too long and the default
      // backoff timer could already have fired.
      process.kill(up.engines.chat.pid!, "SIGKILL");
      await waitUntil(() => engineRespawnState("chat") === "pending");
      const down = (await (await client.get("/api/health")).json()) as { ok: boolean; engines: { chat: { kind: string; alive: boolean | null } } };
      // The watch has already dropped the dead backend by now and is in
      // its backoff: the route says so by name, never "not started yet".
      expect(down.ok).toBe(false);
      expect(down.engines.chat.kind).toBe("restarting");
    } finally {
      __resetLlmSupervisorForTests();
      delete process.env.MAIPAI_LLAMA_SERVER_BIN;
      delete process.env.MAIPAI_CHAT_MODEL_PATH;
    }
  }, 15_000);
});

describe("probeAlive (what the Health page asks)", () => {
  // The 2026-09-07 Health-page bug in one assertion: a cached client to a
  // process that has since died must probe false, not read as fine.
  test("a stale client to a killed process probes false", async () => {
    process.env.MAIPAI_LLAMA_SERVER_BIN = join(import.meta.dir, "fixtures", "fakeLlamaServer.ts");
    process.env.MAIPAI_CHAT_MODEL_PATH = "/dev/null";
    try {
      const staleClient = await getChatClient();
      expect(await probeAlive(staleClient)).toBe(true);
      const pid = getChatLivePid()!;
      process.kill(pid, "SIGKILL");
      await waitUntil(async () => (await probeAlive(staleClient)) === false);
    } finally {
      __resetLlmSupervisorForTests();
      delete process.env.MAIPAI_LLAMA_SERVER_BIN;
      delete process.env.MAIPAI_CHAT_MODEL_PATH;
    }
  }, 10_000);

  test("nothing to probe is null, not a failure", async () => {
    expect(await probeAlive(null)).toBeNull();
  });
});

describe("watchEngine (the engines' auto-heal)", () => {
  // #73: a supervisor's stop is SIGTERM, then SIGKILL after its timeout.
  // The child ignores SIGTERM and says so on stdout before the stop is
  // sent (a SIGTERM that lands before the handler is installed would
  // end the child politely and prove nothing).
  test("escalates a supervisor stop to SIGKILL after its timeout", async () => {
    const proc = Bun.spawn(["bun", "-e", "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"], { stdout: "pipe" });
    const reader = proc.stdout.getReader();
    let seen = "";
    while (!seen.includes("ready")) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    const watch = watchEngine({ proc, role: "stop-timeout", label: "the test engine", healthCheck: async () => true, drop: () => {}, respawn: async () => {}, title: "Test engine stopped" });
    await watch.stop(200);
    expect(proc.signalCode).toBe("SIGKILL");
  });
  // Real child processes, real SIGKILLs, real health fetches - the same
  // "no mocked child_process" rule the rest of this file follows. A
  // watched process is one of this suite's own throwaway servers, and
  // `respawn` here records the call and spawns a replacement the way a
  // supervisor's get*Client() would.
  // One port per test: these servers carry no `--port` flag for
  // freePort() to match, so a process from the previous test that has
  // not finished exiting yet would otherwise still hold the port.
  let port = 39240;
  beforeEach(() => {
    port++;
  });
  function serve(): Promise<Bun.Subprocess> {
    const p = port;
    return spawnAndWaitHealthy({
      command: ["bun", "-e", `Bun.serve({ port: ${p}, fetch: () => Response.json({ status: "ok" }) });`],
      healthCheck: () => fetch(`http://127.0.0.1:${p}`).then((r) => r.ok, () => false),
      label: "watched server",
    });
  }
  const health = () => fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }).then((r) => r.ok, () => false);

  test("a SIGKILLed engine is dropped, reported on Repairs, and started again on its own", async () => {
    __setSidecarTimingForTestsOnly({ backoffMs: [50] });
    const proc = await serve();
    let dropped = 0;
    const replacement: { proc: Bun.Subprocess | null } = { proc: null };
    watchEngine({
      proc,
      role: "test",
      label: "the test engine",
      healthCheck: health,
      drop: () => void dropped++,
      // A supervisor's real respawn spawns AND watches the replacement;
      // the watch on the new process is what closes out the death.
      respawn: async () => {
        replacement.proc = await serve();
        watchEngine({ proc: replacement.proc, role: "test", label: "the test engine", healthCheck: health, drop: () => {}, respawn: async () => {}, title: "Test engine stopped" });
      },
      title: "Test engine stopped",
    });
    try {
      process.kill(proc.pid, "SIGKILL");
      await waitUntil(() => replacement.proc !== null);
      expect(dropped).toBe(1);
      // The issue was raised with how it died, then resolved by the respawn.
      await waitUntil(() => !listIssues().some((i) => i.source === "test-engine"));
      const all = listIssues({ includeResolved: true }).find((i) => i.source === "test-engine" && i.key === "died");
      expect(all?.detail).toContain("SIGKILL");
      expect(all?.detail).toContain("starting it again");
    } finally {
      replacement.proc?.kill();
      await replacement.proc?.exited;
    }
  }, 10_000);

  test("a deliberate stop is never reported or respawned", async () => {
    __setSidecarTimingForTestsOnly({ backoffMs: [50] });
    const proc = await serve();
    let respawns = 0;
    const watch = watchEngine({ proc, role: "test", label: "the test engine", healthCheck: health, drop: () => {}, respawn: async () => void respawns++, title: "Test engine stopped" });
    watch.stop();
    await proc.exited;
    await new Promise((r) => setTimeout(r, 300));
    expect(respawns).toBe(0);
    expect(listIssues().some((i) => i.source === "test-engine")).toBe(false);
  });

  test("markDown() on an engine that is really dead, and the exit that follows, count as one death, not two", async () => {
    __setSidecarTimingForTestsOnly({ backoffMs: [50] });
    const proc = await serve();
    let dropped = 0;
    let respawns = 0;
    const watch = watchEngine({ proc, role: "test", label: "the test engine", healthCheck: health, drop: () => void dropped++, respawn: async () => void respawns++, title: "Test engine stopped" });
    process.kill(proc.pid, "SIGKILL");
    watch.markDown("stopped answering (could not reach it)");
    await proc.exited;
    await waitUntil(() => respawns === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(dropped).toBe(1);
    expect(respawns).toBe(1);
  });

  // A code review (2026-09-07): a client that disconnected before the
  // engine answered fails with the same "could not reach" a dead engine
  // does. On that word alone, the engine must not be killed for everyone.
  test("markDown() on an engine that still answers health checks is ignored", async () => {
    __setSidecarTimingForTestsOnly({ backoffMs: [50] });
    const proc = await serve();
    let dropped = 0;
    const watch = watchEngine({ proc, role: "test", label: "the test engine", healthCheck: health, drop: () => void dropped++, respawn: async () => {}, title: "Test engine stopped" });
    try {
      watch.markDown("stopped answering (could not reach it)");
      await new Promise((r) => setTimeout(r, 300));
      expect(dropped).toBe(0);
      expect(proc.exitCode).toBeNull();
      expect(listIssues().some((i) => i.source === "test-engine")).toBe(false);
    } finally {
      watch.stop();
      await proc.exited;
    }
  });

  // A code review (2026-09-07): an admin's stop landing inside the
  // backoff window used to let the armed respawn fire anyway, count its
  // own "it is stopped" rejection as a crash, and walk the role to
  // "gave up" for an action that was never a failure.
  test("a deliberate stop inside the backoff window cancels the armed respawn", async () => {
    __setSidecarTimingForTestsOnly({ backoffMs: [200] });
    const proc = await serve();
    let respawns = 0;
    watchEngine({ proc, role: "test", label: "the test engine", healthCheck: health, drop: () => {}, respawn: async () => void respawns++, title: "Test engine stopped" });
    process.kill(proc.pid, "SIGKILL");
    await proc.exited;
    await waitUntil(() => engineRespawnState("test") === "pending");
    cancelEngineRespawn("test"); // what stopChatBackend()/restartChatBackend() call
    await new Promise((r) => setTimeout(r, 400));
    expect(respawns).toBe(0);
    expect(engineRespawnState("test")).toBeNull();
  });

  test("a respawn that fails is not retried on a timer: the issue says why and keeps the Start-it-again fix", async () => {
    __setSidecarTimingForTestsOnly({ backoffMs: [20] });
    const proc = await serve();
    let respawns = 0;
    watchEngine({
      proc,
      role: "test",
      label: "the test engine",
      healthCheck: health,
      drop: () => {},
      respawn: async () => {
        respawns++;
        throw new Error("the test engine is stopped - restart it from Household");
      },
      title: "Test engine stopped",
    });
    process.kill(proc.pid, "SIGKILL");
    await waitUntil(() => engineRespawnState("test") === "gave_up");
    await new Promise((r) => setTimeout(r, 200));
    expect(respawns).toBe(1);
    const issue = listIssues().find((i) => i.source === "test-engine")!;
    expect(issue.detail).toContain("could not: the test engine is stopped");
    expect(issue.fix?.action).toBe("restart_engine:test");
  });

  test("a fresh healthy spawn clears a prior gave-up state and its issue, whoever started it", async () => {
    __setSidecarTimingForTestsOnly({ backoffMs: [20] });
    const first = await serve();
    watchEngine({ proc: first, role: "test", label: "the test engine", healthCheck: health, drop: () => {}, respawn: async () => { throw new Error("no"); }, title: "Test engine stopped" });
    process.kill(first.pid, "SIGKILL");
    await waitUntil(() => engineRespawnState("test") === "gave_up");
    // An admin restart, say: a new healthy process, watched again.
    const second = await serve();
    const watch = watchEngine({ proc: second, role: "test", label: "the test engine", healthCheck: health, drop: () => {}, respawn: async () => {}, title: "Test engine stopped" });
    try {
      expect(engineRespawnState("test")).toBeNull();
      expect(listIssues().some((i) => i.source === "test-engine")).toBe(false);
    } finally {
      watch.stop();
      await second.exited;
    }
  });

  test("a live process that stops answering health checks is treated as down and killed", async () => {
    __setSidecarTimingForTestsOnly({ healthPollMs: 30, backoffMs: [50] });
    const proc = await serve();
    let healthy = true;
    let respawns = 0;
    watchEngine({ proc, role: "test", label: "the test engine", healthCheck: async () => healthy, drop: () => {}, respawn: async () => void respawns++, title: "Test engine stopped" });
    healthy = false;
    await waitUntil(() => respawns === 1);
    await proc.exited;
    expect(proc.exitCode ?? proc.signalCode).not.toBeNull();
    const issue = listIssues({ includeResolved: true }).find((i) => i.source === "test-engine");
    expect(issue?.detail).toContain("health checks");
  });

  test("a crash loop stops after five respawns in ten minutes and leaves a one-click fix", async () => {
    __setSidecarTimingForTestsOnly({ backoffMs: [10] });
    let respawns = 0;
    let testActive = true;
    const procs: Bun.Subprocess[] = [];
    // Each respawn hands back a process that dies at once, watched again -
    // the shape a supervisor's get*Client() produces for a binary that
    // keeps crashing. The fix handler below calls this fresh with an
    // empty history, so it genuinely crash-loops again if the underlying
    // command is still broken - correct auto-heal behavior, but a code
    // review (2026-09-07) found the ORIGINAL version of this test let
    // that second loop keep spawning real processes past the test's own
    // lifetime. `testActive` is this test's own teardown flag, not
    // anything sidecars.ts exposes: once false, a respawn already
    // in flight becomes a no-op instead of starting another cycle.
    async function crashy(): Promise<void> {
      if (!testActive) return;
      respawns++;
      const proc = Bun.spawn(["bun", "-e", "process.exit(1)"]);
      procs.push(proc);
      watchEngine({ proc, role: "loop", label: "the looping engine", healthCheck: async () => true, drop: () => {}, respawn: crashy, title: "Looping engine stopped" });
    }
    const first = Bun.spawn(["bun", "-e", "process.exit(1)"]);
    procs.push(first);
    watchEngine({ proc: first, role: "loop", label: "the looping engine", healthCheck: async () => true, drop: () => {}, respawn: crashy, title: "Looping engine stopped" });
    try {
      await waitUntil(() => listIssues().some((i) => i.source === "loop-engine" && i.fix !== null), 10_000);
      const count = respawns;
      await new Promise((r) => setTimeout(r, 300));
      expect(respawns).toBe(count); // no longer trying on its own
      expect(respawns).toBe(5);
      const issue = listIssues().find((i) => i.source === "loop-engine")!;
      expect(issue.detail).toContain("keeps stopping");
      expect(issue.fix?.action).toBe("restart_engine:loop");
      // The fix is a real respawn, counted fresh.
      const fixed = await fixIssue(issue.id);
      expect(fixed.ok).toBe(true);
      expect(respawns).toBe(6);
    } finally {
      testActive = false;
      cancelEngineRespawn("loop");
      for (const proc of procs) {
        proc.kill();
        await proc.exited;
      }
    }
  }, 15_000);
});

// A real, separate child process (not Bun.serve() in this test process
// itself - freePort kills by pid, and killing the test runner's own pid
// would kill the whole suite) proves the actual mechanism this guards
// against the live incident lib/sidecars.ts's own header documents: an
// orphaned process left bound to a fixed port after a `--hot` reload
// wiped a supervisor's tracking - now gated on ENGINE-PORT-01's own
// ownership record (dev.md 2026-09-23, "The generation_failed outage
// on the new path was a killed engine, not a prompt shape"). Module
// scope: both the freePort and engineHealthKind describe blocks below
// use it.
async function spawnRealListener(port: number, replyText: string): Promise<Bun.Subprocess> {
  const child = Bun.spawn(
    ["bun", "-e", `Bun.serve({ port: ${port}, fetch: () => new Response("${replyText}") });`, "--port", String(port)],
    { stdout: "ignore", stderr: "ignore" },
  );
  const deadline = Date.now() + 5_000;
  let up = false;
  while (Date.now() < deadline && !up) {
    up = await fetch(`http://127.0.0.1:${port}`)
      .then(() => true)
      .catch(() => false);
    if (!up) await new Promise((r) => setTimeout(r, 50));
  }
  expect(up).toBe(true);
  return child;
}

describe("freePort", () => {
  beforeEach(() => {
    __resetPortOwnershipForTests();
  });

  test("kills a pid this install's own record names as its previous instance, and frees the port", async () => {
    const port = 39172; // arbitrary, unlikely to collide with anything else in CI
    const child = await spawnRealListener(port, "ok");
    try {
      // Simulates a real prior spawn: spawnAndWaitHealthy() would have
      // called this itself once the health check passed. child.pid is
      // the exact pid `ps` will find bound to the port.
      __recordOwnedPortForTests(port, child.pid);

      await freePort(port);

      await expect(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
      expect(blockedPortReason(port)).toBeUndefined();

      const server = Bun.serve({ port, fetch: () => new Response("new") });
      try {
        const res = await fetch(`http://127.0.0.1:${port}`);
        expect(await res.text()).toBe("new");
      } finally {
        server.stop(true);
      }
    } finally {
      child.kill();
    }
  }, 10_000);

  // A code review caught the bootstrap gap this test proves is closed: an
  // install upgrading to this fix has no record yet for a port it has
  // spawned onto for months, so a genuine crash orphan sitting there the
  // moment this ships must still be recoverable - the old (unsafe, but
  // self-healing) behavior for exactly this one case, until the next
  // successful spawn records real ownership.
  test("a port with no ownership record at all is treated as a legacy orphan and killed (the bootstrap fallback)", async () => {
    const port = 39177;
    const child = await spawnRealListener(port, "legacy orphan, never recorded");
    try {
      await freePort(port);

      await expect(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
      expect(blockedPortReason(port)).toBeUndefined();
    } finally {
      child.kill();
    }
  }, 10_000);

  // ENGINE-PORT-01's own real fix, once ownership IS established (every
  // successful spawn records it - the actual live incident's own
  // steady state, an install that has spawned onto this port many
  // times already): a live process on the port whose pid the record
  // does NOT name - Fable's live diagnosis, dev.md 2026-09-23, was
  // exactly this shape, a perfectly healthy process on its own
  // production port a second, unrelated process's freePort() call
  // killed anyway - must survive. A record naming a pid that is NOT
  // the one currently there (the previously-owned pid already exited
  // on its own, something else now holds the port) is exactly as
  // foreign as no record at all being wrong would be; only an EXACT
  // pid match is ever killed.
  test("refuses to kill a live process a recorded (but non-matching) owner names, and reports it as blocked", async () => {
    const port = 39176;
    const child = await spawnRealListener(port, "not the recorded pid");
    try {
      __recordOwnedPortForTests(port, child.pid + 1);

      await expect(freePort(port)).rejects.toThrow(ForeignPortHolderError);

      const res = await fetch(`http://127.0.0.1:${port}`);
      expect(await res.text()).toBe("not the recorded pid");

      const blocked = blockedPortReason(port);
      expect(blocked?.pid).toBe(child.pid);
    } finally {
      child.kill();
    }
  }, 10_000);

  test("a port nothing is listening on is a safe no-op", async () => {
    await expect(freePort(39173)).resolves.toBeUndefined();
  });

  // A code review (2026-09-04, before this file existed) found the
  // original matcher used a plain substring test - true for "--port
  // 87889" when freeing port 8788, since 8788 is a numeric prefix of it.
  test("never kills a process whose port has the target port as a numeric prefix", async () => {
    const targetPort = 3917;
    const decoyPort = 39174;
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

      await freePort(targetPort);

      const res = await fetch(`http://127.0.0.1:${decoyPort}`);
      expect(await res.text()).toBe("decoy");
    } finally {
      decoy.kill();
    }
  }, 10_000);
});

// ENGINE-PORT-01's own BACKLOG row: "the health list carries the
// condition" - engineHealthKind() is what every probe*Engine() function
// (llmSupervisor.ts, embedSupervisor.ts, backgroundSupervisor.ts,
// ttsSupervisor.ts) calls to build GET /api/health's own per-engine
// `kind`, so this is the one place that check is provable without a
// live spawn.
describe("engineHealthKind: a blocked port reports \"blocked\"", () => {
  beforeEach(() => {
    __resetPortOwnershipForTests();
  });

  test("a port freePort() refused to touch reads back as blocked", async () => {
    const port = 39178;
    const child = await spawnRealListener(port, "blocked for this test");
    try {
      await expect(freePort(port)).rejects.toThrow(ForeignPortHolderError);
      expect(engineHealthKind("chat", "spawned", port)).toBe("blocked");
    } finally {
      child.kill();
    }
  }, 10_000);

  test("a port with no blocked reading falls through to the ordinary kind", () => {
    expect(engineHealthKind("chat", "spawned", 39179)).toBe("spawned");
  });

  test("with no port given at all (a role with no fixed port), behaves exactly as before ENGINE-PORT-01", () => {
    expect(engineHealthKind("chat", "spawned")).toBe("spawned");
  });
});

describe("sweepOrphanProcesses", () => {
  // A unique marker embedded in the script text itself (part of `ps
  // aux`'s own argv output for a `bun -e <script>` invocation) stands in
  // for a real installed engine's absolute path - the actual match
  // target in production (lib/llmSupervisor.ts's sweepOrphanEngineProcesses()
  // matches on `enginesDir`).
  test("kills every process whose command line contains the match string, and returns the count", async () => {
    const marker = `maipai-orphan-test-${crypto.randomUUID()}`;
    const orphan = Bun.spawn(["bun", "-e", `/* ${marker} */ setTimeout(() => {}, 60000);`], { stdout: "ignore", stderr: "ignore" });
    try {
      // Give `ps` a moment to actually see the new process.
      await new Promise((r) => setTimeout(r, 200));
      const killed = await sweepOrphanProcesses(marker);
      expect(killed).toBe(1);

      // `.exited` (not the `.exitCode` property, which Bun doesn't
      // always populate for a death it didn't itself initiate via
      // `.kill()`) is what actually confirms the OS process is gone.
      const exitSignal = await Promise.race([
        orphan.exited,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
      ]);
      expect(exitSignal).not.toBeNull();
    } finally {
      orphan.kill();
    }
  }, 10_000);

  test("a match string nothing's command line contains kills nothing", async () => {
    const killed = await sweepOrphanProcesses(`maipai-orphan-test-nothing-matches-${crypto.randomUUID()}`);
    expect(killed).toBe(0);
  });

  // Fix A2 (docs/dev.md's 2026-09-07 incident note): a matching process
  // whose pid is explicitly excluded survives - the mechanism that keeps
  // a `bun --hot` reload's own re-run of this exact sweep from SIGKILLing
  // its own still-healthy chat/embed/tts engines, which is what let ten
  // reloads in one evening respawn qwen3-8b eleven times and kill a reply
  // mid-turn.
  test("excludePids protects a matching process from being killed", async () => {
    const marker = `maipai-orphan-test-${crypto.randomUUID()}`;
    const survivor = Bun.spawn(["bun", "-e", `/* ${marker} */ setTimeout(() => {}, 60000);`], { stdout: "ignore", stderr: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 200));
      const killed = await sweepOrphanProcesses(marker, { excludePids: [survivor.pid] });
      expect(killed).toBe(0);
      expect(survivor.exitCode).toBeNull();
    } finally {
      survivor.kill();
    }
  }, 10_000);

  // Deliberately NOT tested with a broad pattern like the current
  // process's own binary name ("bun"): on this machine, several other
  // sessions' real bun processes are commonly running at the same time,
  // and matching that loosely would SIGKILL them too - the self-
  // exclusion (`pid !== process.pid` in the implementation) only protects
  // against matching this exact pid, not every process sharing a runtime.
  // The two tests above already prove targeted, marker-based matching
  // kills exactly (and only) what it should.
});
