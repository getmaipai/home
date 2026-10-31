import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { data, main, env, run, makeWorktree, commit, queueFiles, setup, cleanup } = fixtures.createLanderFixtures();

beforeAll(setup, 60_000);

describe("land queue", () => {
  test("replaces an earlier request for the same branch", () => {
    const wt = makeWorktree("replace");
    writeFileSync(join(wt, "file.txt"), "first request\n");
    commit(wt, "first request");
    const first = run("land.sh", ["--detach"], wt);
    expect(first.status).toBe(0);
    const second = run("land.sh", ["--detach"], wt);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("replaced earlier request for wt/replace");
    expect(queueFiles()).toHaveLength(1);
    for (const file of queueFiles()) rmSync(join(data, "queue", file), { force: true });
  });

  test("wait accepts an origin/main ancestor even with a stale bounced note", () => {
    const wt = makeWorktree("wait_fallback");
    writeFileSync(join(wt, "file.txt"), "wait fallback\n");
    const sha = commit(wt, "wait fallback commit");
    const pushed = Bun.spawnSync(["git", "-C", main, "push", "origin", `${sha}:refs/heads/main`]);
    expect(pushed.exitCode).toBe(0);
    const notePath = join(data, "notes", "wt-wait_fallback.json");
    writeFileSync(notePath, JSON.stringify({ branch: "wt/wait_fallback", sha, status: "bounced", reason: "stale" }));
    const result = run("land.sh", ["wait", "--timeout", "1"], wt);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`landed: ${sha.slice(0, 7)} is on origin/main`);
  });
});

afterAll(cleanup);
