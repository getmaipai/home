import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendGateRun, makeGateRun, parseFailures, parseStages } from "./stats";

describe("gate run statistics", () => {
  test("parses stage timings and preserves the first red stage and test names", () => {
    expect(parseStages("install\t2\nfrontend: typecheck\t11\n")).toEqual([
      { stage: "install", seconds: 2 },
      { stage: "frontend: typecheck", seconds: 11 },
    ]);
    expect(parseFailures("fail\tbackend: bun test\t1\ntest\t(fail) sample > rejects bad input\ntest\t(fail) sample > rejects bad input\n")).toEqual({
      stage: "backend: bun test",
      tests: ["(fail) sample > rejects bad input"],
    });
  });

  test("records one run with timing, scope, lock and failure details", () => {
    const record = makeGateRun({
      ts: "2026-10-07T00:00:00.000Z",
      run_kind: "gate",
      start_epoch: 100,
      ended_at: "",
      worktree: "/work/home",
      scope: "backend",
      scope_reason: "only backend changed",
      exit: 1,
      load_at_lock_time: "3.1 2.8 2.2",
      lock_wait_seconds: 9,
      head: "abc",
      merge_base: "def",
      lane: "gf1",
      stages_log: "backend: typecheck\t12\nbackend: bun test\t30\n",
      failures_log: "fail\tbackend: bun test\t1\ntest\t(fail) fixture > fails\n",
    }, new Date(125_000));

    expect(record).toMatchObject({
      scope: "backend",
      scope_reason: "only backend changed",
      seconds: 25,
      exit: 1,
      first_red_stage: "backend: bun test",
      failing_test_names: ["(fail) fixture > fails"],
      load_at_lock_time: "3.1 2.8 2.2",
      lock_wait_seconds: 9,
      stages: [{ stage: "backend: typecheck", seconds: 12 }, { stage: "backend: bun test", seconds: 30 }],
    });
  });

  test("appends one JSON object per run", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-stats-test-"));
    try {
      const path = join(dir, "gate-stats", "runs.jsonl");
      const input = {
        ts: "2026-10-07T00:00:00.000Z",
        run_kind: "gate" as const,
        start_epoch: 100,
        ended_at: "",
        worktree: "/work/home",
        scope: "docs",
        scope_reason: "docs only",
        exit: 0,
        load_at_lock_time: "",
        lock_wait_seconds: 0,
        head: "abc",
        merge_base: "def",
        lane: "gf1",
        stages_log: "standards core\t3\n",
        failures_log: "",
      };
      appendGateRun(path, input, new Date(103_000));
      appendGateRun(path, input, new Date(104_000));
      const rows = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(rows).toHaveLength(2);
      expect(rows[0].stages).toEqual([{ stage: "standards core", seconds: 3 }]);
      expect(rows[1].exit).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
