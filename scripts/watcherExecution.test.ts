import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import * as fixtures from "./tests/watcherFixtures";
const { roots, git, fixture, pushScriptChange, commit, run, records } = fixtures.createWatcherFixtures();

describe("main watcher", () => {
  test("refresh copies watcher code from origin/main and status reports its age", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["refresh"]).stdout.trim()).toBe("changed");
    const original = readFileSync(join(f.pipelineBin, "watcher.sh"), "utf8");
    expect(run(f, "watcher.sh", ["refresh"]).stdout.trim()).toBe("unchanged");
    expect(run(f, "pipeline.sh", ["status"]).stdout).toContain("watcher code: current");

    pushScriptChange(f, "snapshot watcher update");
    expect(run(f, "watcher.sh", ["refresh"]).stdout.trim()).toBe("changed");
    expect(readFileSync(join(f.pipelineBin, "watcher.sh"), "utf8")).toBe(`${git(f.main, "show", "origin/main:scripts/watcher.sh")}\n`);
    expect(readFileSync(join(f.pipelineBin, "watcher.sh"), "utf8")).not.toBe(original);
    pushScriptChange(f, "snapshot watcher newer");
    expect(run(f, "pipeline.sh", ["status"]).stdout).toContain("watcher code: older than origin/main");
  }, 60_000);

  test("waits for a queued landing, then runs and records the suite after the cap", () => {
    const f = fixture();
    mkdirSync(join(f.env.MAIPAI_LAND_DATA!, "queue"), { recursive: true });
    writeFileSync(join(f.env.MAIPAI_LAND_DATA!, "queue", "pending.json"), "{}\n");
    const started = Date.now();
    const out = run(f, "watcher.sh", ["run-once"], {
      ...f.env,
      MAIPAI_WATCH_QUIET_MAX_SECONDS: "2",
      MAIPAI_WATCH_QUIET_POLL_SECONDS: "1",
    });
    expect(out.status).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1300);
    expect(records(f)[0].result).toBe("green");
    expect(readFileSync(join(f.data, "watcher.log"), "utf8")).toContain("waiting: lander busy");
    expect(readFileSync(join(f.data, "watcher.log"), "utf8")).toContain("waited 2s; waiting: lander busy; running anyway");
  }, 60_000);

  test("takes and releases the machine gate lock around the suite, and continues when acquire fails", () => {
    const f = fixture();
    const lock = join(f.scratch, "gate-lock.sh");
    const calls = join(f.scratch, "lock.calls");
    writeFileSync(lock, `#!/usr/bin/env bash\nprintf '%s %s\\n' "$1" "${"$"}{2:-}" >> '${calls}'\n`);
    commit(f, "lock suite marker", {
      "scripts/suite.sh": `#!/usr/bin/env bash\necho suite >> '${calls}'\necho 'all green'\n`,
    });
    const env = { ...f.env, MAIPAI_WATCH_NO_LOCK: "", MAIPAI_GATE_LOCK: lock };
    expect(run(f, "watcher.sh", ["run-once"], env).status).toBe(0);
    const lockCalls = readFileSync(calls, "utf8").trim().split(/\r?\n/);
    expect(lockCalls[0]).toMatch(/^acquire watcher-[0-9]+$/);
    expect(lockCalls[1]).toBe("suite");
    expect(lockCalls[2]).toMatch(/^release watcher-[0-9]+$/);
    expect(lockCalls[0]!.slice("acquire ".length)).toBe(lockCalls[2]!.slice("release ".length));

    const failed = fixture();
    const badLock = join(failed.scratch, "bad-lock.sh");
    writeFileSync(badLock, "#!/usr/bin/env bash\n[[ \"$1\" != acquire ]]\n");
    const bad = run(failed, "watcher.sh", ["run-once"], { ...failed.env, MAIPAI_WATCH_NO_LOCK: "", MAIPAI_GATE_LOCK: badLock });
    expect(bad.status).toBe(0);
    expect(records(failed)[0].result).toBe("green");
    expect(readFileSync(join(failed.data, "watcher.log"), "utf8")).toContain("gate lock acquire failed; running watcher suite without it");
  }, 60_000);

  test("waits for high work CPU until the cap and skips waiting for low or unknown CPU", () => {
    const high = fixture();
    const started = Date.now();
    const highOut = run(high, "watcher.sh", ["run-once"], {
      ...high.env,
      MAIPAI_WATCH_QUIET_MAX_SECONDS: "2",
      MAIPAI_WATCH_QUIET_POLL_SECONDS: "1",
      MAIPAI_WATCH_MAX_CPU: "60",
      MAIPAI_WATCH_CPU_CMD: "echo 99",
    });
    expect(highOut.status).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1800);
    expect(records(high)[0].result).toBe("green");
    expect(readFileSync(join(high.data, "watcher.log"), "utf8")).toContain("waiting: our work uses 99% cpu, above 60%");

    const low = fixture();
    const lowOut = run(low, "watcher.sh", ["run-once"], {
      ...low.env,
      MAIPAI_WATCH_CPU_CMD: "echo 0.1",
    });
    expect(lowOut.status).toBe(0);
    expect(records(low)[0].result).toBe("green");
    expect(existsSync(join(low.data, "watcher.log"))).toBe(false);

    const unknown = fixture();
    const unknownOut = run(unknown, "watcher.sh", ["run-once"], {
      ...unknown.env,
      MAIPAI_WATCH_CPU_CMD: "echo unknown",
    });
    expect(unknownOut.status).toBe(0);
    expect(records(unknown)[0].result).toBe("green");
    expect(existsSync(join(unknown.data, "watcher.log"))).toBe(false);
  }, 60_000);

  test("work_cpu_percent sums suite processes and excludes machine and watcher load", () => {
    const scratch = mkdtempSync(join(tmpdir(), "maipai-work-cpu-"));
    roots.push(scratch);
    const functionFile = join(scratch, "work-cpu.sh");
    const psBin = join(scratch, "bin");
    mkdirSync(psBin);
    const script = readFileSync(join(import.meta.dir, "watcher.sh"), "utf8");
    const match = script.match(/^work_cpu_percent\(\) \{[\s\S]*?^\}/m);
    expect(match).not.toBeNull();
    writeFileSync(functionFile, `${match![0]}\n`);
    const fakePs = join(psBin, "ps");
    writeFileSync(fakePs, "#!/bin/sh\ncat <<'ROWS'\n101 1 150.0 /opt/homebrew/bin/bun bun\n102 1 120.0 /opt/homebrew/bin/bun bun\n103 1 400.0 /usr/libexec/kernel_task kernel_task\n104 1 90.0 /bin/bash bash scripts/watcher.sh serve\nROWS\n");
    chmodSync(fakePs, 0o755);
    const result = spawnSync("bash", ["-c", ". \"$1\"; work_cpu_percent", "bash", functionFile], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${psBin}:${process.env.PATH ?? ""}` },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("270");
  });
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
