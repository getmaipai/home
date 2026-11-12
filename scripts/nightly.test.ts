import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { scratch, origin, main, env, git, setup, cleanup } = fixtures.createLanderFixtures();

// NIGHTLY-01: scripts/nightly.sh wraps nightly-stable.sh: host-guard gate (defer, never a pass), a dated report under data-scratch/reports,
// run-now for testing, a schedule that is written but never loaded without --load.
const nightlyData = () => join(scratch, "nightly-data");
const reports = () => join(scratch, "reports");
const day = () => new Date().toLocaleDateString("sv");
const report = () => readFileSync(join(reports(), `nightly-${day()}.md`), "utf8");
const pipelineMain = () => git(main, "rev-parse", "refs/pipeline/main");
const stable = () => { try { return git(main, "rev-parse", "refs/heads/stable"); } catch { return ""; } };
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" };
function integrate(message: string) {
  const tip = pipelineMain();
  const next = Bun.spawnSync(["git", "-C", main, "commit-tree", `${tip}^{tree}`, "-p", tip, "-m", message], { env: gitEnv }).stdout.toString().trim();
  git(main, "update-ref", "refs/pipeline/main", next, tip);
  return next;
}
function nightly(sub: string, suite: string, extra: Record<string, string> = {}) {
  const r = Bun.spawnSync(["bash", join(main, "scripts", "nightly.sh"), sub], { cwd: main, env: { ...env, MAIPAI_NIGHTLY_SUITE_CMD: suite, ...extra } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  return { status: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

beforeAll(() => {
  setup();
  for (const f of ["nightly.sh", "nightly-stable.sh", "pipeline.sh"]) copyFileSync(join(import.meta.dir, f), join(main, "scripts", f));
  for (const f of ["hostmem.sh", "mode.sh"]) copyFileSync(join(import.meta.dir, "lib", f), join(main, "scripts", "lib", f));
  Object.assign(env, { MAIPAI_NIGHTLY_DATA: nightlyData(), MAIPAI_REPORTS_DIR: reports(), MAIPAI_NIGHTLY_CHECKOUT: join(scratch, "nightly-checkout"), MAIPAI_NIGHTLY_SKIP_INSTALL: "1", MAIPAI_HOSTMEM_PRESSURE: "1", MAIPAI_HOST_GUARD_STATE_DIR: join(scratch, "guard"), GITNET_TIMEOUT: "10", GITNET_TRIES: "1" });
  git(main, "update-ref", "refs/pipeline/main", git(main, "rev-parse", "origin/main"));
}, 60_000);
afterAll(() => cleanup());

describe("nightly.sh", () => {
  test("run-now on a pass moves stable and writes the dated report", () => {
    const tested = integrate("good night");
    const r = nightly("run-now", "true");
    expect(r.status).toBe(0);
    expect(stable()).toBe(tested);
    expect(report()).toContain("PASSED");
    expect(report()).toContain(tested.slice(0, 12));
  }, 60_000);

  test("a failing run leaves stable and the report names the failing test", () => {
    const before = stable();
    integrate("bad night");
    const r = nightly("run-now", "echo '(fail) scripts/example.test.ts > it breaks'; exit 1");
    expect(r.status).not.toBe(0);
    expect(stable()).toBe(before);
    expect(report()).toContain("FAILED");
    expect(report()).toContain("it breaks");
  }, 60_000);

  test("under memory pressure the suite never starts: deferred, reported, stable unchanged", () => {
    const before = stable();
    integrate("pressure night");
    const marker = join(scratch, "suite-ran");
    const r = nightly("run-now", `touch ${marker}`, { MAIPAI_HOSTMEM_PRESSURE: "2", MAIPAI_NIGHTLY_DEFER_SECONDS: "0" });
    expect(r.status).toBe(75);
    expect(existsSync(marker)).toBe(false);
    expect(stable()).toBe(before);
    expect(report()).toContain("DEFERRED");
    expect(report()).not.toContain("PASSED");
  }, 60_000);

  test("a retry after pressure clears runs the suite", () => {
    integrate("pressure cleared");
    const r = nightly("run-now", "true");
    expect(r.status).toBe(0);
    expect(report()).toContain("PASSED");
  }, 60_000);

  test("the scheduled run honours the OFF switch, run-now ignores it", () => {
    writeFileSync(join(nightlyData(), "OFF"), "");
    const before = stable();
    integrate("while off");
    expect(nightly("run", "true").out).toContain("nightly: off");
    expect(stable()).toBe(before);
    expect(report()).toContain("OFF");
    expect(nightly("run-now", "true").status).toBe(0);
    expect(stable()).not.toBe(before);
  }, 60_000);

  test("a failed run calls the fixer, a passing run does not", () => {
    const marker = join(scratch, "fixer-ran");
    const fixer = join(scratch, "fake-fixer.sh");
    writeFileSync(fixer, `#!/bin/bash\necho ran >> ${marker}\n`);
    integrate("fixer night");
    nightly("run-now", "true", { MAIPAI_NIGHTLY_FIXER_SH: fixer });
    expect(existsSync(marker)).toBe(false);
    integrate("fixer night 2");
    nightly("run-now", "exit 1", { MAIPAI_NIGHTLY_FIXER_SH: fixer });
    expect(existsSync(marker)).toBe(true);
  }, 60_000);

  test("install-service writes the 04:00 LaunchAgent for nightly.sh and loads nothing", () => {
    const agents = join(scratch, "agents");
    const ctl = join(scratch, "ctl-log");
    const stub = join(scratch, "fake-launchctl.sh");
    writeFileSync(stub, `#!/bin/bash\necho "$@" >> ${ctl}\n`);
    Bun.spawnSync(["chmod", "+x", stub]);
    const r = nightly("install-service", "true", { MAIPAI_LAUNCH_AGENTS_DIR: agents, MAIPAI_LAUNCHCTL: stub });
    expect(r.status).toBe(0);
    expect(r.out).toContain("not loaded");
    const plist = readFileSync(join(agents, "com.maipai.nightly.plist")).toString("latin1");
    expect(plist).toContain("nightly.sh");
    expect(existsSync(ctl)).toBe(false);
  }, 60_000);
});
