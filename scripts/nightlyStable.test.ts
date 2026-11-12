import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { scratch, origin, main, env, git, setup, cleanup } = fixtures.createLanderFixtures();

// STABLE-01: `stable` is the last version to pass the required checks. It moves only on a full pass of one fixed commit, never on a failure or
// an unfinished (time-capped) run; landings go on during the run; the commits a run passes over are recorded as "untested (superseded)".
const nightlyData = () => join(scratch, "nightly-data");
const pipelineMain = () => git(main, "rev-parse", "refs/pipeline/main");
const stable = () => { try { return git(main, "rev-parse", "refs/heads/stable"); } catch { return ""; } };
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" };
function integrate(message: string) {
  const tip = pipelineMain();
  const next = Bun.spawnSync(["git", "-C", main, "commit-tree", `${tip}^{tree}`, "-p", tip, "-m", message], { env: gitEnv }).stdout.toString().trim();
  git(main, "update-ref", "refs/pipeline/main", next, tip);
  return next;
}
function nightly(suite: string, extra: Record<string, string> = {}) {
  const r = Bun.spawnSync(["bash", join(main, "scripts", "nightly-stable.sh"), "run"], { cwd: main, env: { ...env, MAIPAI_NIGHTLY_SUITE_CMD: suite, ...extra } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  return { status: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}
const latest = () => JSON.parse(readFileSync(join(nightlyData(), "latest.json"), "utf8"));

beforeAll(() => {
  setup();
  copyFileSync(join(import.meta.dir, "nightly-stable.sh"), join(main, "scripts", "nightly-stable.sh"));
  // The override is scrubbed from the base env: this file decides per test whether a run ignores OFF, whatever started bun.
  Object.assign(env, { MAIPAI_NIGHTLY_DATA: nightlyData(), MAIPAI_NIGHTLY_CHECKOUT: join(scratch, "nightly-checkout"), MAIPAI_NIGHTLY_SKIP_INSTALL: "1", MAIPAI_NIGHTLY_IGNORE_OFF: "", GITNET_TIMEOUT: "10", GITNET_TRIES: "1" });
  git(main, "update-ref", "refs/pipeline/main", git(main, "rev-parse", "origin/main"));
}, 60_000);
afterAll(() => cleanup());

describe("nightly stable", () => {
  test("a pass moves stable to exactly the commit it tested, here and on GitHub, while new work keeps landing", () => {
    const tested = integrate("candidate");
    // The suite lands another commit while it runs: stable must still be the commit picked at the start.
    const r = nightly(`GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test git -C ${main} update-ref refs/pipeline/main $(git -C ${main} commit-tree ${tested}^{tree} -p ${tested} -m "landed during the run") ${tested}`);
    expect(r.status).toBe(0);
    expect(stable()).toBe(tested);
    expect(git(origin, "rev-parse", "refs/heads/stable")).toBe(tested);
    expect(pipelineMain()).not.toBe(tested);
    expect(latest().result).toBe("passed");
    expect(readFileSync(join(nightlyData(), "latest.md"), "utf8")).toContain("last version to pass the required checks");
  }, 60_000);

  test("a failure leaves stable where it was and writes the report", () => {
    const before = stable();
    integrate("broken");
    const r = nightly("echo 'a test failed'; exit 1");
    expect(r.status).not.toBe(0);
    expect(stable()).toBe(before);
    expect(latest().result).toBe("failed");
    const log = r.out.match(/^log: (.+)\/suite\.log$/m)?.[1];
    expect(log && existsSync(join(log, "report.md"))).toBe(true);
  }, 60_000);

  test("a run that hits its time cap is 'unfinished', not a pass, and stable stays", () => {
    const before = stable();
    integrate("slow");
    const r = nightly("sleep 30", { MAIPAI_NIGHTLY_SECONDS: "1" });
    expect(r.status).not.toBe(0);
    expect(latest().result).toBe("unfinished");
    expect(stable()).toBe(before);
  }, 60_000);

  test("it tests the newest integrated commit and records the ones it passed over as untested (superseded)", () => {
    const skipped1 = integrate("skipped one");
    const skipped2 = integrate("skipped two");
    const newest = integrate("newest");
    expect(nightly("true").status).toBe(0);
    expect(stable()).toBe(newest);
    expect(latest().untested_superseded).toEqual(expect.arrayContaining([skipped1, skipped2]));
    expect(latest().untested_superseded).not.toContain(newest);
    const untested = readFileSync(join(nightlyData(), "untested.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(untested.find((u) => u.sha === skipped2)).toMatchObject({ label: "untested (superseded)", superseded_by: newest });
  }, 60_000);

  test("it never shares the watcher's checkout: with the lock held it tests nothing and stable stays", () => {
    const before = stable();
    integrate("while the watcher runs");
    const lock = join(env.MAIPAI_WATCH_DATA!, "checkout.lock.d");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "pid"), `${process.pid}\n`);
    const r = nightly("true", { MAIPAI_NIGHTLY_LOCK_WAIT: "0" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("still holds");
    expect(stable()).toBe(before);
    rmSync(lock, { recursive: true, force: true });
  }, 60_000);

  test("NIGHTLY-ENV-01: run-now's OFF override and the op-file settings never reach the suite under test", () => {
    // The first real nightly (2026-11-12) failed its own off-switch test: every test inherited MAIPAI_NIGHTLY_IGNORE_OFF=1 from nightly.sh,
    // so the test's run ignored its OFF file and waited on the lock the test above holds (60 s timeout, twice).
    writeFileSync(join(nightlyData(), "OFF"), "");
    integrate("checked with the override");
    const r = nightly('[[ -z "${MAIPAI_NIGHTLY_IGNORE_OFF:-}" && -z "${GITNET_OPS_DIR:-}" && -z "${GITNET_STUCK_LOG:-}" ]]', { MAIPAI_NIGHTLY_IGNORE_OFF: "1" });
    expect(r.out).not.toContain("nightly: off");
    expect(latest().result).toBe("passed");
  }, 60_000);

  test("the off switch stops a run before it does anything", () => {
    writeFileSync(join(nightlyData(), "OFF"), "");
    const before = stable();
    integrate("while off");
    expect(nightly("true").out).toContain("nightly: off");
    expect(stable()).toBe(before);
  }, 60_000);
});
