import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import * as fixtures from "./tests/watcherFixtures";
const { roots, git, fixture, run, records } = fixtures.createWatcherFixtures();

describe("watcher suite scheduling", () => {
  test("runs legs in order, continues after a failure, and defaults to 8/10/12 shards", () => {
    const f = fixture();
    const bin = join(f.scratch, "fake-bin");
    const calls = join(f.scratch, "legs.log");
    mkdirSync(bin);
    writeFileSync(join(bin, "bun"), "#!/usr/bin/env bash\ndir=''; shards=''; while (($#)); do case \"$1\" in --dir) dir=\"$2\"; shift 2 ;; --shards) shards=\"$2\"; shift 2 ;; *) shift ;; esac; done\nprintf '%s %s\\n' \"$dir\" \"$shards\" >> '" + calls + "'\nif [[ \"$dir\" == backend ]]; then echo 'shard: failing files: failed.test.ts'; exit 1; fi\necho 'all green'\n");
    chmodSync(join(bin, "bun"), 0o755);
    const result = run(f, "watcher.sh", ["run-once"], {
      ...f.env,
      PATH: bin + ":" + (process.env.PATH ?? ""),
      MAIPAI_WATCH_SUITE_CMD: "",
      MAIPAI_WATCH_LEGS: "frontend backend scripts",
      MAIPAI_WATCH_RERUN_CMD: "false",
    });
    expect(result.status).toBe(0);
    expect(readFileSync(calls, "utf8").trim().split(/\r?\n/)).toEqual(["scripts 8", "backend 10", "frontend 12"]);
    const sha = git(f.warm, "rev-parse", "origin/main");
    const red = readFileSync(join(f.data, "reds", sha + ".md"), "utf8");
    expect(red).toContain("== leg: scripts (exit 0,");
    expect(red).toContain("== leg: backend (exit 1,");
    expect(red).toContain("== leg: frontend (exit 0,");
  }, 60_000);

  test("records a leg without a status file as exit 137 and unknown", () => {
    const f = fixture();
    const bin = join(f.scratch, "fake-bin");
    const calls = join(f.scratch, "legs.log");
    mkdirSync(bin);
    writeFileSync(join(bin, "bun"), "#!/usr/bin/env bash\ndir=''; while (($#)); do case \"$1\" in --dir) dir=\"$2\"; shift 2 ;; *) shift ;; esac; done\nprintf '%s\\n' \"$dir\" >> '" + calls + "'\necho 'all green'\n");
    chmodSync(join(bin, "bun"), 0o755);

    const source = readFileSync(join(import.meta.dir, "watcher.sh"), "utf8");
    const runSuite = source.match(/^run_suite\(\) \{[\s\S]*?^\}/m);
    expect(runSuite).not.toBeNull();
    const functionPath = join(f.scratch, "run-suite.sh");
    const outputPath = join(f.scratch, "suite.out");
    writeFileSync(functionPath, runSuite![0] + "\n");
    const result = spawnSync("bash", [
      "-c",
      '. "$1"; function wait() { builtin wait "$1"; rm -f "$output.$leg.status"; }; main="$2"; checkout="$2"; run_suite "$3"',
      "bash", functionPath, f.main, outputPath,
    ], {
      cwd: f.main,
      env: {
        ...f.env,
        PATH: bin + ":" + (process.env.PATH ?? ""),
        MAIPAI_WATCH_SUITE_CMD: "",
        MAIPAI_WATCH_LEGS: "scripts backend",
      },
      encoding: "utf8",
    });
    const output = readFileSync(outputPath, "utf8");
    expect(result.status).toBe(1);
    expect(readFileSync(calls, "utf8").trim().split(/\r?\n/)).toEqual(["scripts", "backend"]);
    expect(output).toContain("== leg: scripts (exit 137, 0 s)");
    expect(output).toContain("shard: failing files: unknown");
    expect(output).toContain("== leg: backend (exit 137, 0 s)");
  });

  test("waits on low free memory, and proceeds for high or unknown readings", () => {
    const low = fixture();
    const count = join(low.scratch, "memory.calls");
    const started = Date.now();
    const result = run(low, "watcher.sh", ["run-once"], {
      ...low.env,
      MAIPAI_WATCH_QUIET_MAX_SECONDS: "3",
      MAIPAI_WATCH_QUIET_POLL_SECONDS: "1",
      MAIPAI_WATCH_CPU_CMD: "echo 0",
      MAIPAI_WATCH_MIN_FREE_GB: "40",
      MAIPAI_WATCH_FREE_GB_CMD: "n=0; [[ ! -f '" + count + "' ]] || n=$(cat '" + count + "'); n=$((n+1)); echo $n > '" + count + "'; if (( n == 1 )); then echo 22; else echo 50; fi",
    });
    expect(result.status).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(readFileSync(join(low.data, "watcher.log"), "utf8")).toContain("waiting: free memory 22 GB below 40 GB");

    for (const reading of ["80", "unknown"]) {
      const f = fixture();
      const begin = Date.now();
      expect(run(f, "watcher.sh", ["run-once"], {
        ...f.env,
        MAIPAI_WATCH_CPU_CMD: "echo 0",
        MAIPAI_WATCH_FREE_GB_CMD: "echo " + reading,
      }).status).toBe(0);
      expect(Date.now() - begin).toBeLessThan(1500);
      expect(existsSync(join(f.data, "watcher.log"))).toBe(false);
    }
  }, 60_000);

  test("stalls a leg that exceeds its watchdog without red or green side effects", () => {
    const f = fixture();
    const bin = join(f.scratch, "fake-bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "bun"), "#!/usr/bin/env bash\nsleep 30\n");
    chmodSync(join(bin, "bun"), 0o755);
    const result = run(f, "watcher.sh", ["run-once"], {
      ...f.env,
      PATH: bin + ":" + (process.env.PATH ?? ""),
      MAIPAI_WATCH_SUITE_CMD: "",
      MAIPAI_WATCH_LEGS: "backend",
      MAIPAI_WATCH_LEG_MAX_SECONDS: "2",
    });
    const sha = git(f.warm, "rev-parse", "origin/main");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`stalled at ${sha.slice(0, 7)}: leg backend timed out`);
    expect(records(f).at(-1).result).toBe("stalled");
    expect(readFileSync(join(f.data, "last-run"), "utf8").trim()).toBe(sha);
    expect(existsSync(join(f.data, "reds", `${sha}.md`))).toBe(false);
    expect(existsSync(join(f.data, "green", sha))).toBe(false);
    expect(existsSync(join(f.scratch, "issue.calls"))).toBe(false);
  }, 20_000);

  test("ignores a queued lander after its configurable busy window", () => {
    const f = fixture();
    const queue = join(f.env.MAIPAI_LAND_DATA!, "queue");
    mkdirSync(queue, { recursive: true });
    writeFileSync(join(queue, "pending.json"), "{}\n");
    const count = join(f.scratch, "cpu.calls");
    const started = Date.now();
    const result = run(f, "watcher.sh", ["run-once"], {
      ...f.env,
      MAIPAI_WATCH_QUIET_MAX_SECONDS: "5",
      MAIPAI_WATCH_LANDER_BUSY_SECONDS: "1",
      MAIPAI_WATCH_QUIET_POLL_SECONDS: "1",
      MAIPAI_WATCH_CPU_CMD: `n=0; [[ ! -f '${count}' ]] || n=$(cat '${count}'); n=$((n+1)); echo $n > '${count}'; echo 0`,
      MAIPAI_WATCH_FREE_GB_CMD: "echo 100",
    });
    expect(result.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(readFileSync(join(f.data, "watcher.log"), "utf8")).toContain("waiting: lander busy");
  }, 10_000);
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
