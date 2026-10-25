import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as fixtures from "./tests/landerFixtures";
const { scratch, origin, main, data, watchData, pipelineBin, warm, env, git, run, makeWorktree, commit, pushScriptChange, note, queueFiles, setup, cleanup, awaitQueueName } = fixtures.createLanderFixtures();

beforeAll(setup, 60_000);

describe("lander pipeline", () => {
  test("--done marks the named backlog item, records the note and commits as lander", () => {
    const wt = makeWorktree("done");
    writeFileSync(join(wt, "file.txt"), "done\n");
    commit(wt, "done change");
    const queued = run("land.sh", ["--detach", "--done", "ALPHA-01", "--note", "first item"], wt);
    expect(queued.status).toBe(0);
    expect(queued.stdout).toContain("done: ALPHA-01");
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    const backlog = git(origin, "show", "main:docs/BACKLOG.md");
    expect(backlog).toMatch(/^- \[x\] \*\*ALPHA-01:.* Landed \d{4}-\d{2}-\d{2} \([0-9a-f]{7}\)\.$/m);
    expect(backlog).toContain("- [ ] **BETA-02: second** (S).");
    const landedCommits = git(main, "log", "origin/main", "--format=%s|%an|%ae");
    expect(landedCommits).toContain("Backlog: ALPHA-01 done (landed by the lander)|MaiPai lander|lander@users.noreply.github.com");
    expect(note("done").note).toBe("first item");
    expect(readFileSync(join(data, "notes", "wt-done.md"), "utf8")).toContain("- Note: first item");
  }, 60_000);

  test("unknown --done item bounces without moving main", () => {
    const wt = makeWorktree("unknown_done");
    writeFileSync(join(wt, "file.txt"), "unknown\n");
    commit(wt, "unknown done change");
    const oldMain = git(origin, "rev-parse", "main");
    expect(run("land.sh", ["--detach", "--done", "NOPE-99"], wt).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(note("unknown_done").status).toBe("bounced");
    expect(note("unknown_done").reason).toContain("NOPE-99");
    expect(git(origin, "rev-parse", "main")).toBe(oldMain);
  }, 60_000);

  test("generator changes are committed, unchanged outputs add no commit", () => {
    const generated = makeWorktree("generated");
    writeFileSync(join(generated, "GEN"), "yes\n");
    const sourceSha = commit(generated, "generate output");
    expect(run("land.sh", ["--detach"], generated).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(git(origin, "log", "main", "--format=%s")).toContain("Generated: docs/api/openapi.json (lander, for wt/generated)");
    expect(git(origin, "show", "main:docs/api/openapi.json")).toBe(sourceSha);

    const generatedCommitCount = git(origin, "log", "main", "--format=%s").split("\n").filter((message) => message.startsWith("Generated:")).length;
    const unchanged = makeWorktree("no_generated");
    unlinkSync(join(unchanged, "GEN"));
    writeFileSync(join(unchanged, "file.txt"), "no generated\n");
    commit(unchanged, "no generated output");
    expect(run("land.sh", ["--detach"], unchanged).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(git(origin, "log", "main", "--format=%s").split("\n").filter((message) => message.startsWith("Generated:")).length).toBe(generatedCommitCount);
  }, 60_000);

  test("serve replaces its code between requests without changing pid and continues landing", async () => {
    expect(run("lander.sh", ["refresh"]).status).toBe(0);
    const serveEnv = { ...env, MAIPAI_LAND_POLL_SECONDS: "1", MAIPAI_PIPELINE_REFRESH_SECONDS: "1" };
    const server = Bun.spawn(["bash", join(main, "scripts", "lander.sh"), "serve"], {
      cwd: main,
      env: serveEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const pidfile = join(data, "lander.pid");
    try {
      const startupDeadline = Date.now() + 10_000;
      while (!existsSync(pidfile) && Date.now() < startupDeadline) await Bun.sleep(25);
      expect(existsSync(pidfile)).toBe(true);
      const pid = readFileSync(pidfile, "utf8").trim();

      pushScriptChange("lander.sh", "live lander replacement");
      const refreshDeadline = Date.now() + 10_000;
      while ((!existsSync(join(data, "lander.log")) || !readFileSync(join(data, "lander.log"), "utf8").includes("code refreshed from origin/main; restarting lander")) && Date.now() < refreshDeadline) await Bun.sleep(50);
      expect(readFileSync(pidfile, "utf8").trim()).toBe(pid);
      expect(readFileSync(join(data, "lander.log"), "utf8")).toContain("code refreshed from origin/main; restarting lander");

      const wt = makeWorktree("after_snapshot_swap");
      writeFileSync(join(wt, "file.txt"), "after swap\n");
      const sha = commit(wt, "landing after snapshot swap");
      expect(run("land.sh", ["--detach"], wt).status).toBe(0);
      const landingDeadline = Date.now() + 15_000;
      while (!existsSync(join(data, "notes", "wt-after_snapshot_swap.json")) && Date.now() < landingDeadline) await Bun.sleep(50);
      expect(note("after_snapshot_swap").status).toBe("landed");
      expect(note("after_snapshot_swap").sha).toBe(sha);

      process.kill(Number(pid), "SIGTERM");
      expect(await server.exited).toBe(0);
      expect(existsSync(pidfile)).toBe(false);
    } finally {
      if (existsSync(pidfile)) process.kill(Number(readFileSync(pidfile, "utf8").trim()), "SIGTERM");
    }
  }, 60_000);
});

afterAll(cleanup);
