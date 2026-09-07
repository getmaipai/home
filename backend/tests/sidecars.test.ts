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
  registerGracefulExit,
  __resetSidecarsForTests,
  __setSidecarTimingForTestsOnly,
} from "@/lib/sidecars";
import { listIssues, fixIssue, __resetFixHandlersForTests } from "@/lib/issues";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

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
    const body = (await res.json()) as { sidecars: unknown[] };
    expect(body.sidecars).toEqual([{ id: "reported", status: "stopped", baseUrl: "http://127.0.0.1:12345" }]);
  });
});

describe("freePort", () => {
  // A real, separate child process (not Bun.serve() in this test process
  // itself - freePort kills by pid, and killing the test runner's own pid
  // would kill the whole suite) proves the actual mechanism this guards
  // against the live incident lib/sidecars.ts's own header documents: an
  // orphaned process left bound to a fixed port after a `--hot` reload
  // wiped a supervisor's tracking.
  test("kills a real process bound to the port and frees it for a new listener", async () => {
    const port = 39172; // arbitrary, unlikely to collide with anything else in CI
    // Trailing "--port <N>" args (unused by the script itself) are still
    // part of the OS-level argv the SEC-9 user-scoped `ps -u <uid> -o
    // pid=,command=` shows - freePort matches on exactly that substring,
    // the same shape a real sidecar spawn always has, so this exercises
    // the real matching logic rather than a differently-shaped stand-in
    // for it.
    const child = Bun.spawn(
      ["bun", "-e", `Bun.serve({ port: ${port}, fetch: () => new Response("ok") });`, "--port", String(port)],
      { stdout: "ignore", stderr: "ignore" },
    );
    try {
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
