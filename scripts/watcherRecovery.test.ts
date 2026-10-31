import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import * as fixtures from "./tests/watcherFixtures";
const { roots, git, fixture, pushScriptChange, commit, run, records } = fixtures.createWatcherFixtures();

describe("main watcher", () => {
  test("bisect ignores a candidate that fails only one isolated rerun", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const innocent = commit(f, "innocent intermittent", { "one.txt": "one\n" });
    const culprit = commit(f, "true culprit", { RED: "red\n" });
    commit(f, "after culprit", { "two.txt": "two\n" });
    const counters = join(f.scratch, "candidate-counters");
    mkdirSync(counters);
    const rerunScript = join(f.scratch, "candidate-rerun.sh");
    writeFileSync(rerunScript, `#!/usr/bin/env bash\nsha=$(git rev-parse HEAD); n=0; [[ -f '${counters}/'"$sha" ]] && n=$(cat '${counters}/'"$sha"); n=$((n+1)); echo "$n" > '${counters}/'"$sha"; if [[ -f RED ]]; then exit 1; fi; [[ "$sha" != '${innocent}' || "$n" -gt 1 ]]\n`);
    const out = run(f, "watcher.sh", ["run-once"], {
      ...f.env,
      MAIPAI_WATCH_RERUN_CMD: `bash ${rerunScript}`,
      MAIPAI_WATCH_RERUNS: "3",
      MAIPAI_WATCH_BISECT_RERUNS: "3",
    });
    expect(out.status).toBe(0);
    expect(records(f).at(-1).culprit).toBe(culprit);
  }, 60_000);

  test("files one issue on the third flaky run and remembers the file", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    for (let i = 1; i <= 4; i++) {
      commit(f, `flaky run ${i}`, { RED: "red\n", FLAKY: "yes\n", [`run-${i}.txt`]: `${i}\n` });
      expect(run(f, "watcher.sh", ["run-once"], { ...f.env, MAIPAI_WATCH_RERUN_CMD: "true" }).status).toBe(0);
      if (i < 3) expect(existsSync(join(f.scratch, "issue.calls"))).toBe(false);
    }
    const calls = readFileSync(join(f.scratch, "issue.calls"), "utf8").trim().split(/\r?\n/);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStartWith("Flaky: backend/tests/broken.test.ts failed with the suite and passed alone 3 times in 7 days");
    expect(readFileSync(join(f.data, "flake-issues.json"), "utf8")).toContain("backend/tests/broken.test.ts");
  }, 60_000);

  test("marks a failure flaky when the isolated rerun passes", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const sha = commit(f, "flaky tests", { RED: "red\n", FLAKY: "yes\n" });
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    expect(records(f).at(-1).result).toBe("flaky");
    expect(existsSync(join(f.data, "green", sha))).toBe(true);
    expect(existsSync(join(f.scratch, "issue.calls"))).toBe(false);
  }, 60_000);

  test("pipeline status reports watcher and latest green or red main result", () => {
    const green = fixture();
    expect(run(green, "watcher.sh", ["run-once"]).status).toBe(0);
    const greenStatus = run(green, "pipeline.sh", ["status"]).stdout;
    expect(greenStatus).toContain("watcher: stopped");
    expect(greenStatus).toContain("main: green at");

    const red = fixture();
    expect(run(red, "watcher.sh", ["run-once"]).status).toBe(0);
    const sha = commit(red, "break tests", { RED: "red\n" });
    expect(run(red, "watcher.sh", ["run-once"]).status).toBe(0);
    const redStatus = run(red, "pipeline.sh", ["status"]).stdout;
    expect(redStatus).toContain("watcher: stopped");
    expect(redStatus).toContain(`main: red at ${sha.slice(0, 7)}`);
    expect(redStatus).toContain(sha.slice(0, 7));
  }, 60_000);

  test("pipeline stop succeeds when neither service has a pid file", () => {
    const f = fixture();
    const out = run(f, "pipeline.sh", ["stop"]);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("lander already stopped");
    expect(out.stdout).toContain("watcher already stopped");
  });

  test("bisect budget exhaustion records an unknown culprit in the red note", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    for (let i = 1; i <= 3; i++) commit(f, `slow candidate ${i}`, { [`slow-${i}.txt`]: `${i}\n` });
    const sha = commit(f, "break with slow isolated rerun", { RED: "red\n" });
    const out = run(f, "watcher.sh", ["run-once"], {
      ...f.env,
      MAIPAI_WATCH_RERUN_CMD: "sleep 1; exit 1",
      MAIPAI_WATCH_RERUNS: "1",
      MAIPAI_WATCH_BISECT_MAX_SECONDS: "1",
    });
    expect(out.status).toBe(0);
    expect(records(f).at(-1).culprit).toBeNull();
    expect(readFileSync(join(f.data, "reds", `${sha}.md`), "utf8")).toContain("unknown (bisect budget spent)");
  }, 20_000);

  test("bisect candidate cap limits rerun calls", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    for (let i = 1; i <= 6; i++) commit(f, `candidate ${i}`, { [`candidate-${i}.txt`]: `${i}\n` });
    const sha = commit(f, "break after candidates", { RED: "red\n" });
    const calls = join(f.scratch, "bisect.calls");
    const stub = join(f.scratch, "bisect-rerun.sh");
    writeFileSync(stub, `#!/usr/bin/env bash\necho "$(git rev-parse HEAD)" >> '${calls}'\nexit 1\n`);
    const out = run(f, "watcher.sh", ["run-once"], {
      ...f.env,
      MAIPAI_WATCH_RERUN_CMD: `bash ${stub}`,
      MAIPAI_WATCH_RERUNS: "1",
      MAIPAI_WATCH_BISECT_CANDIDATES: "2",
    });
    expect(out.status).toBe(0);
    expect(readFileSync(calls, "utf8").trim().split(/\r?\n/)).toHaveLength(2);
    expect(records(f).at(-1).sha).toBe(sha);
  }, 20_000);
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
