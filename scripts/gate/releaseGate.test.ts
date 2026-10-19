import { describe, expect, test } from "bun:test";
import { decideReuse, parseRuns, sameExceptVersion } from "./releaseGate";
import type { GateRun } from "./stats";

const now = new Date("2026-10-19T22:00:00Z");

function run(over: Partial<GateRun>): GateRun {
  return {
    ts: "2026-10-19T21:00:00Z",
    ended_at: "2026-10-19T21:08:00Z",
    worktree: "/work/home",
    scope: "full",
    scope_reason: "full",
    run_kind: "gate",
    seconds: 470,
    exit: 0,
    first_red_stage: null,
    failing_test_names: [],
    flaky_tests: [],
    load_at_lock_time: null,
    lock_wait_seconds: 0,
    head: "aaaa1111",
    merge_base: "",
    lane: "none",
    clean: true,
    stages: [],
    ...over,
  };
}

const deps = (changed: string[], ancestors = ["aaaa1111", "bbbb2222"], versionOnly = true) => ({
  exists: (sha: string) => ancestors.includes(sha),
  changedSince: () => changed,
  versionOnlyBump: () => versionOnly,
});

describe("release gate reuse", () => {
  test("reuses a recent clean green run when only the changelog changed since", () => {
    const d = decideReuse([run({})], deps(["CHANGELOG.md", "docs/user/news.md"]), now);
    expect(d.reuse).toBe(true);
  });

  test("reuses a run of the exact release commit", () => {
    expect(decideReuse([run({})], deps([]), now).reuse).toBe(true);
  });

  test("runs the full gate when code changed since the green run", () => {
    const d = decideReuse([run({})], deps(["CHANGELOG.md", "backend/src/turn.ts"]), now);
    expect(d).toMatchObject({ reuse: false });
    expect(d.why).toContain("code differs");
  });

  test("never reuses a red, pre, narrow-scope or stale run", () => {
    const runs = [
      run({ exit: 1 }),
      run({ run_kind: "pre" }),
      run({ scope: "backend" }),
      run({ ended_at: "2026-10-19T17:00:00Z" }),
    ];
    expect(decideReuse(runs, deps([]), now).reuse).toBe(false);
  });

  test("skips a run that had uncommitted files and uses an older clean one", () => {
    const runs = [run({ head: "bbbb2222", clean: false, ended_at: "2026-10-19T21:30:00Z" }), run({})];
    const d = decideReuse(runs, deps(["CHANGELOG.md"]), now);
    expect(d.reuse && d.run.head).toBe("aaaa1111");
  });

  test("treats a run recorded before the clean flag existed as not reusable", () => {
    const legacy = run({}) as Partial<GateRun>;
    delete legacy.clean;
    expect(decideReuse([legacy as GateRun], deps([]), now).reuse).toBe(false);
  });

  test("names the clean run that differs, not a newer unclean run it skipped", () => {
    const runs = [run({ head: "bbbb2222", clean: false, ended_at: "2026-10-19T21:30:00Z" }), run({})];
    const d = decideReuse(runs, deps(["scripts/check.sh"]), now);
    expect(d.reuse).toBe(false);
    expect(d.why).toContain("code differs from the newest usable green run (aaaa1111)");
  });

  test("skips a green run whose commit is not in this repository", () => {
    expect(decideReuse([run({ head: "cccc3333" })], deps([]), now).reuse).toBe(false);
  });

  test("falls back to an older green run whose code matches when the newest one differs", () => {
    const runs = [run({ head: "bbbb2222", ended_at: "2026-10-19T21:30:00Z" }), run({})];
    const d = decideReuse(runs, {
      exists: () => true,
      changedSince: (sha: string) => (sha === "bbbb2222" ? ["backend/src/turn.ts"] : ["CHANGELOG.md"]),
      versionOnlyBump: () => true,
    }, now);
    expect(d.reuse && d.run.head).toBe("aaaa1111");
  });

  test("treats the release version bump as metadata but any other package.json change as code", () => {
    expect(decideReuse([run({})], deps(["CHANGELOG.md", "package.json"]), now).reuse).toBe(true);
    expect(decideReuse([run({})], deps(["CHANGELOG.md", "package.json"], undefined, false), now).reuse).toBe(false);
    expect(sameExceptVersion('{"name":"h","version":"0.2.34"}', '{"name":"h","version":"0.2.35"}')).toBe(true);
    expect(sameExceptVersion('{"name":"h","version":"0.2.34"}', '{"name":"h","version":"0.2.35","x":1}')).toBe(false);
  });

  test("parses runs.jsonl and ignores a torn line", () => {
    expect(parseRuns(`${JSON.stringify(run({}))}\n{"ts":\n`)).toHaveLength(1);
  });
});
