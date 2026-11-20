import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/watcherFixtures";
const { roots, git, fixture, commit, run, records } = fixtures.createWatcherFixtures();

// WATCHER-STARVED-01: the watcher never stops testing main. A T2 entry never blocks the main run, a red T2 is rerun at most once per six
// hours, an obligation is discharged only by a finished main run at a head that contains it, and a long gap files one issue.
type F = ReturnType<typeof fixture>;
// A commit that is not on main (its own branch pushed to origin), so a T2 run for it is a real run and main does not contain it.
function sideCommit(f: F, n: number): string {
  const sha = git(f.main, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", `side ${n}`);
  git(f.main, "branch", `side${n}`, sha);
  git(f.main, "push", "origin", `side${n}`);
  return sha;
}
function wanted(f: F, sha: string, branch: string, stamp: string) {
  mkdirSync(join(f.data, "t2-wanted"), { recursive: true });
  writeFileSync(join(f.data, "t2-wanted", sha), `${branch}\nbackend/src/lib/safety.ts\n${stamp}\n`);
}
function failingT2(f: F) {
  const calls = join(f.scratch, "t2.calls");
  const stub = join(f.scratch, "t2.sh");
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$(git rev-parse HEAD)" >> '${calls}'\nexit 1\n`); chmodSync(stub, 0o755);
  return { calls, env: { ...f.env, MAIPAI_LAND_T2_CMD: `bash ${stub}`, MAIPAI_WATCH_T2_RERUN_SECONDS: "21600" } };
}
const lines = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").trim().split("\n") : []);

describe("watcher starvation protection", () => {
  test("main is tested in the first tick even with twenty stale T2 obligations, and a green main discharges them (moved, not deleted)", () => {
    const f = fixture();
    const base = git(f.main, "rev-parse", "HEAD");
    mkdirSync(join(f.data, "t2-wanted"), { recursive: true });
    for (let i = 0; i < 20; i++) wanted(f, `${base.slice(0, -2)}${String(i).padStart(2, "0")}`.replace(/.$/, "0"), `branch-${i}`, `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`);
    // Entries whose sha is the real base commit are on main; the fabricated ones are not commits at all and stay as obligations.
    wanted(f, base, "landed-branch", "2026-01-01T00:01:00Z");
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    expect(records(f).some((r) => r.sha === base && r.result === "green")).toBe(true);
    expect(existsSync(join(f.data, "t2-wanted", base))).toBe(false);
    expect(existsSync(join(f.data, "t2-discharged", base))).toBe(true);
  });

  test("a red T2 is rerun at most once per six hours, the oldest eligible entry goes first, and a newer entry is not starved", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0); // main is tested first, so the next ticks are T2 ticks
    const older = sideCommit(f, 1), newer = sideCommit(f, 2);
    wanted(f, newer, "side2", "2026-01-02T00:00:00Z");
    wanted(f, older, "side1", "2026-01-01T00:00:00Z");
    const t2 = failingT2(f);
    run(f, "watcher.sh", ["run-once"], t2.env);
    expect(lines(t2.calls)).toEqual([older]);
    run(f, "watcher.sh", ["run-once"], t2.env);
    expect(lines(t2.calls)).toEqual([older, newer]); // the red older one is suppressed, so the newer one is not starved
    run(f, "watcher.sh", ["run-once"], t2.env);
    expect(lines(t2.calls)).toHaveLength(2); // both are red and inside six hours: nothing reruns
    for (const sha of [older, newer]) writeFileSync(join(f.data, "t2-red", sha), `${Math.floor(Date.now() / 1000) - 21601}\n`);
    run(f, "watcher.sh", ["run-once"], t2.env);
    expect(lines(t2.calls)).toEqual([older, newer, older]);
    expect(existsSync(join(f.data, "t2-wanted", older))).toBe(true); // a red T2 keeps its obligation
  });

  test("a red main names the T2 obligations it discharged and still moves them", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const landed = git(f.main, "rev-parse", "HEAD");
    wanted(f, landed, "landed-branch", "2026-01-01T00:00:00Z");
    const broken = commit(f, "break tests", { RED: "red\n" });
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    expect(records(f).at(-1).result).toBe("red");
    const note = readFileSync(join(f.data, "reds", `${broken}.md`), "utf8");
    expect(note).toContain("T2 obligations discharged by this run");
    expect(note).toContain(landed.slice(0, 7));
    expect(existsSync(join(f.data, "t2-wanted", landed))).toBe(false);
    expect(existsSync(join(f.data, "t2-discharged", landed))).toBe(true);
  });

  test("a T2 red files one issue per sha; a 24 hour gap files one issue that the next green closes; status prints the gap", () => {
    const f = fixture();
    const issues = join(f.scratch, "issue.calls"), closes = join(f.scratch, "close.calls");
    const closer = join(f.scratch, "close.sh");
    writeFileSync(closer, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${closes}'\n`); chmodSync(closer, 0o755);
    expect(run(f, "watcher.sh", ["run-once"], f.env).status).toBe(0);
    const head = git(f.main, "rev-parse", "HEAD");
    const sha = sideCommit(f, 3);
    wanted(f, sha, "side3", "2026-01-01T00:00:00Z");
    const t2 = failingT2(f);
    const tenv = { ...t2.env, MAIPAI_WATCH_CLOSE_ISSUE_CMD: `bash ${closer}` };
    run(f, "watcher.sh", ["run-once"], tenv);
    writeFileSync(join(f.data, "t2-red", sha), `${Math.floor(Date.now() / 1000) - 21601}\n`);
    run(f, "watcher.sh", ["run-once"], tenv);
    expect(lines(t2.calls)).toHaveLength(2);
    expect(lines(issues).filter((line) => line.includes("T2 red"))).toHaveLength(1);
    // A 30 hour gap: the only finished run is old.
    writeFileSync(join(f.data, "runs.jsonl"), JSON.stringify({ ts: new Date(Date.now() - 30 * 3600 * 1000).toISOString(), sha: head, result: "green", seconds: 1, failing: [], culprit: null }) + "\n");
    run(f, "watcher.sh", ["run-once"], tenv);
    run(f, "watcher.sh", ["run-once"], tenv);
    expect(lines(issues).filter((line) => line.includes("unverified"))).toHaveLength(1);
    expect(run(f, "pipeline.sh", ["status"], { ...tenv, MAIPAI_WATCH_DATA: f.data }).stdout).toContain("main unverified for 30 h");
    appendFileSync(join(f.data, "runs.jsonl"), JSON.stringify({ ts: new Date().toISOString(), sha: head, result: "green", seconds: 1, failing: [], culprit: null }) + "\n");
    run(f, "watcher.sh", ["run-once"], tenv);
    expect(lines(closes).some((line) => line.includes("unverified"))).toBe(true);
  });

  test("a red main files its own issue even when an old open issue has a similar title (no comment on a stale issue)", () => {
    const f = fixture();
    const gh = join(f.scratch, "ghbin"); mkdirSync(gh);
    const calls = join(f.scratch, "gh2.calls");
    const similar = JSON.stringify([{ number: 292, title: "Watcher: main red at cca428c: scripts/watcherExecution.test.ts" }]);
    writeFileSync(join(gh, "gh"), `#!/bin/sh\necho "$*" >> '${calls}'\ncase "$*" in *"issue list"*) echo '${similar}';; esac\nexit 0\n`); chmodSync(join(gh, "gh"), 0o755);
    const env = { ...f.env, MAIPAI_WATCH_ISSUE_CMD: "", PATH: `${gh}:${process.env.PATH}` };
    expect(run(f, "watcher.sh", ["run-once"], env).status).toBe(0);
    commit(f, "break tests", { RED: "red\n" });
    expect(run(f, "watcher.sh", ["run-once"], env).status).toBe(0);
    expect(records(f).at(-1).result).toBe("red");
    const all = lines(calls);
    expect(all.some((line) => line.startsWith("issue create"))).toBe(true);
    expect(all.some((line) => line.startsWith("issue comment"))).toBe(false);
  });

  test("the log rotates over 5 MB (the duplicate-start quieting has no automated test: it needs a live second watcher process)", () => {
    const f = fixture();
    mkdirSync(f.data, { recursive: true });
    writeFileSync(join(f.data, "watcher.log"), "x".repeat(5 * 1024 * 1024 + 10));
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    expect(existsSync(join(f.data, "watcher.log.1"))).toBe(true);
    expect(readFileSync(join(f.data, "watcher.log.1"), "utf8").length).toBeGreaterThan(5 * 1024 * 1024); // copy-truncate: the descriptor launchd holds keeps working
    expect(statSync(join(f.data, "watcher.log")).size).toBeLessThan(100_000);
  });
});
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
