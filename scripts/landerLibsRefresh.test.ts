import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { pipelineBin, main, git, run, setup, cleanup } = fixtures.createLanderFixtures();

beforeAll(setup, 60_000);
afterAll(cleanup);

// LIBS-REFRESH-01 (2026-11-02): a new lander.sh called deps_ensure, added to lib/deps.sh, but the daemon sourced the old copy of deps.sh from
// pipeline-bin and failed at startup. Every scripts/lib/*.sh helper must be copied from origin/main before any is sourced.
const oldDeps = "# old snapshot without the newer functions\ninstall_deps() { :; }\ndeps_current() { return 1; }\n";
const stray = () => (existsSync(pipelineBin) ? readdirSync(pipelineBin).filter((n) => n.includes(".new")) : []);

function seedOldBin() {
  mkdirSync(pipelineBin, { recursive: true });
  writeFileSync(join(pipelineBin, "deps.sh"), oldDeps);
  writeFileSync(join(pipelineBin, "gitnet.sh"), readFileSync(join(main, "scripts", "lib", "gitnet.sh")));
}

describe("pipeline-bin helper libraries", () => {
  test("lander.sh replaces an old deps.sh from origin/main before sourcing it, atomically", () => {
    // origin/main's deps.sh has deps_ensure; the snapshot in pipeline-bin does not.
    expect(readFileSync(join(main, "scripts", "lib", "deps.sh"), "utf8")).toContain("deps_ensure()");
    seedOldBin();
    const out = run("lander.sh", ["run-once"]);
    expect(out.status).toBe(0);
    expect(readFileSync(join(pipelineBin, "deps.sh"), "utf8")).toBe(git(main, "show", "origin/main:scripts/lib/deps.sh") + "\n");
    expect(`${out.stdout}${out.stderr}`).not.toContain("command not found");
    expect(stray()).toEqual([]);
  }, 60_000);

  test("watcher.sh refresh also updates every helper, including one the daemon did not know before", () => {
    seedOldBin();
    writeFileSync(join(main, "scripts", "lib", "extra.sh"), "extra_fn() { :; }\n");
    git(main, "add", "scripts/lib/extra.sh");
    git(main, "commit", "-m", "add extra helper");
    git(main, "push", "origin", "main");
    expect(run("watcher.sh", ["refresh"]).status).toBe(0);
    expect(readFileSync(join(pipelineBin, "extra.sh"), "utf8")).toContain("extra_fn");
    expect(readFileSync(join(pipelineBin, "deps.sh"), "utf8")).toContain("deps_ensure()");
    expect(stray()).toEqual([]);
  }, 60_000);

  test("when origin/main cannot be read the existing copies stay and the daemon still starts", () => {
    seedOldBin();
    git(main, "update-ref", "-d", "refs/remotes/origin/main");
    const out = run("lander.sh", ["run-once"]);
    expect(out.status).toBe(0);
    expect(readFileSync(join(pipelineBin, "deps.sh"), "utf8")).toBe(oldDeps);
    expect(stray()).toEqual([]);
  }, 60_000);
});
