import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { scratch, origin, data, main, env, git, run, makeWorktree, commit, note, queueFiles, setup, cleanup } = fixtures.createLanderFixtures();

// SINGLE-WRITER-01, FAIR-LANE-01, QUEUE-TIME-01, UNFINISHED-01, BATCH-BACKUP-01, CHECK-REUSE-01 (2026-11-12). The lander is the only
// writer of main; the express lane (land.sh --express, what rush-ship.sh uses) goes through it between landing transactions; records keep
// queue time apart from run time; a time cap is "unfinished", never a pass; backups are batched and push nothing when nothing is new.
const originMain = () => git(origin, "rev-parse", "refs/heads/main");
const pipelineMain = () => git(main, "rev-parse", "refs/pipeline/main");
const pushLog = () => join(scratch, "push-log");
const pushes = () => (existsSync(pushLog()) ? readFileSync(pushLog(), "utf8").trim().split("\n").filter(Boolean) : []);
const realGit = () => Bun.spawnSync(["bash", "-c", "command -v git"]).stdout.toString().trim();
const stubBin = () => join(scratch, "express-bin");
let pathBefore = "";

function stubGit(mode: "fail" | "pass") {
  mkdirSync(stubBin(), { recursive: true });
  writeFileSync(
    join(stubBin(), "git"),
    `#!/bin/bash
if [[ " $* " == *" push "* && "$*" == *":refs/heads/main"* ]]; then
  echo "$*" >> ${pushLog()}
  if [[ ${JSON.stringify(mode)} == fail ]]; then echo "fatal: unable to access 'https://github.com/example/home.git/': Connection reset by peer" >&2; exit 128; fi
fi
exec ${realGit()} "$@"
`,
  );
  chmodSync(join(stubBin(), "git"), 0o755);
  env.PATH = `${stubBin()}:${pathBefore}`;
}
function change(name: string, file = `${name}.txt`, body = `${name}\n`) {
  const w = makeWorktree(name);
  mkdirSync(join(w, file, ".."), { recursive: true });
  writeFileSync(join(w, file), body);
  return { w, sha: commit(w, `entry ${name}`) };
}
// A queue file exactly as land.sh writes it; `ageMs` back-dates it (the lander's fairness clock is the file name).
function enqueue(name: string, sha: string, w: string, opts: { express?: boolean; ageMs?: number; safetyOk?: boolean } = {}) {
  const ms = Date.now() - (opts.ageMs ?? 0);
  const req: Record<string, unknown> = { branch: `wt/${name}`, sha, worktree: w, session: "", requested_at: new Date(ms).toISOString().replace(/\.\d+Z$/, "Z"), note: "", done: [] };
  if (opts.express) req.express = true;
  if (opts.safetyOk) req.safety_ok = true;
  const file = join(data, "queue", `${opts.express ? "0-" : ""}${ms}-wt-${name}.json`);
  writeFileSync(file, `${JSON.stringify(req)}\n`);
  return file;
}
const landings = () => readFileSync(join(data, "landings.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

beforeAll(() => {
  setup();
  mkdirSync(join(data, "queue"), { recursive: true });
  mkdirSync(join(data, "notes"), { recursive: true });
  pathBefore = env.PATH ?? process.env.PATH ?? "";
  env.GITNET_TIMEOUT = "5";
  env.GITNET_TRIES = "1";
  env.GITNET_BACKOFF = "0";
  env.MAIPAI_LAND_BOOT_CMD = "echo booted";
  stubGit("pass");
}, 60_000);
afterAll(() => cleanup());

describe("the express lane", () => {
  test("land.sh --express waits, lands the rebased commit, pushes it to GitHub before it answers, and says what was checked (never 'tested')", async () => {
    const { w } = change("ex_basic");
    const lander = Bun.spawn(["bash", join(main, "scripts", "land.sh"), "--queue-anyway", "--express", "--timeout", "60"], { cwd: w, env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
    for (let i = 0; i < 100 && queueFiles().length === 0; i++) await Bun.sleep(100);
    expect(queueFiles()[0]).toMatch(/^0-\d+-wt-ex_basic\.json$/);
    expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/ex_basic");
    expect(await lander.exited).toBe(0);
    const out = await new Response(lander.stdout).text();
    const landed = out.match(/^landed-sha: ([0-9a-f]{40})$/m)?.[1];
    expect(landed).toBe(pipelineMain());
    expect(originMain()).toBe(landed!);
    const n = note("ex_basic") as Record<string, unknown>;
    expect(n.label).toBe("starts and typechecks on top of main (express: no tests run)");
    expect(String(n.label)).not.toContain("tested");
    expect(String(n.github)).toMatch(/^pushed/);
    expect(existsSync(join(data, "boot-ok", landed!))).toBe(true);
    expect(readFileSync(join(data, "notes", "wt-ex_basic.md"), "utf8")).toContain("What was checked: starts and typechecks on top of main");
  }, 120_000);

  test("LAND-FIRST-01: in direct mode a landing waits for no check: a failing typecheck and a failing boot check do not bounce it, no boot-ok is written, the note says checks run after; gated still bounces", () => {
    copyFileSync(join(import.meta.dir, "lib", "mode.sh"), join(main, "scripts", "lib", "mode.sh"));
    const prior = { c: env.MAIPAI_LAND_CHECK_CMD, b: env.MAIPAI_LAND_BOOT_CMD, m: env.MAIPAI_MODE };
    env.MAIPAI_LAND_CHECK_CMD = "echo typecheck would fail; exit 1"; env.MAIPAI_LAND_BOOT_CMD = "echo boot would fail; exit 1";
    try {
      env.MAIPAI_MODE = "direct";
      const d = change("direct_first");
      enqueue("direct_first", d.sha, d.w, { express: true });
      expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/direct_first");
      const n = note("direct_first") as Record<string, unknown>;
      expect(String(n.label)).toContain("checks run after");
      expect(String(n.label)).not.toContain("tested");
      expect(existsSync(join(data, "boot-ok", pipelineMain()))).toBe(false);
      env.MAIPAI_MODE = "gated";
      const g = change("gated_first");
      enqueue("gated_first", g.sha, g.w);
      expect(run("lander.sh", ["run-once"]).stdout).toContain("bounced: wt/gated_first");
    } finally { env.MAIPAI_LAND_CHECK_CMD = prior.c; env.MAIPAI_LAND_BOOT_CMD = prior.b; if (prior.m === undefined) delete env.MAIPAI_MODE; else env.MAIPAI_MODE = prior.m; }
  }, 120_000);

  test("DIRECT-FAST-02: in direct mode land.sh --detach queues an express entry; gated and unset keep the normal lane; explicit --express --detach stays refused", () => {
    const land = (name: string, args: string[], mode: string) => {
      const { w } = change(name);
      return { w, r: Bun.spawnSync(["bash", join(main, "scripts", "land.sh"), "--queue-anyway", ...args], { cwd: w, env: { ...(env as Record<string, string>), MAIPAI_MODE: mode }, stdout: "pipe", stderr: "pipe" }) };
    };
    copyFileSync(join(import.meta.dir, "lib", "mode.sh"), join(main, "scripts", "lib", "mode.sh"));
    const direct = land("ex_dd", ["--detach"], "direct");
    expect(direct.r.exitCode).toBe(0);
    expect(direct.r.stdout.toString()).toContain("landing through the express lane");
    const f = queueFiles().find((q) => q.endsWith("-wt-ex_dd.json"))!;
    expect(f).toMatch(/^0-\d+-/);
    expect(JSON.parse(readFileSync(join(data, "queue", f), "utf8")).express).toBe(true);
    const unset = land("ex_dn", ["--detach"], "");
    expect(unset.r.exitCode).toBe(0);
    expect(queueFiles().find((q) => q.endsWith("-wt-ex_dn.json"))).toMatch(/^\d+-/);
    const gated = land("ex_dg", ["--detach"], "gated");
    expect(gated.r.exitCode).toBe(0);
    expect(queueFiles().find((q) => q.endsWith("-wt-ex_dg.json"))).toMatch(/^\d+-/);
    const both = land("ex_db", ["--express", "--detach"], "direct");
    expect(both.r.exitCode).toBe(2);
    expect(both.r.stderr.toString()).toContain("drop --detach");
    rmSync(join(main, "scripts", "lib", "mode.sh"), { force: true }); // the lander in this fixture runs without the mode switch
    run("lander.sh", ["run-once"]); run("lander.sh", ["run-once"]); run("lander.sh", ["run-once"]);
    const n = note("ex_dd") as Record<string, unknown>;
    expect(n.label).toBe("starts and typechecks on top of main (express: no tests run)");
  }, 120_000);

  test("queue time and run time are recorded apart, with the seconds of each step", () => {
    const { w, sha } = change("ex_times");
    enqueue("ex_times", sha, w, { ageMs: 30_000 });
    run("lander.sh", ["run-once"]);
    const row = landings().at(-1)!;
    for (const key of ["requested_at", "started_at", "finished_at", "queue_seconds", "run_seconds", "phases", "generated_files"]) expect(row).toHaveProperty(key);
    expect(row.queue_seconds).toBeGreaterThanOrEqual(29);
    expect(Object.keys(row.phases)).toEqual(expect.arrayContaining(["fetching origin", "rebasing", "generating files", "static check", "landing on main"]));
    const n = note("ex_times") as Record<string, unknown>;
    expect(n.requested_at).toBe(row.requested_at);
    expect(n.queue_seconds).toBe(row.queue_seconds);
    expect(run("pipeline.sh", ["status"]).stdout).toMatch(/landed wt\/ex_times waited \d+s, ran \d+s landed \[static check on top of main\]/);
  }, 60_000);

  test("a rush while the outbox holds an unpushed landed commit lands on top of it and pushes both in order, without force", () => {
    stubGit("fail");
    env.MAIPAI_LAND_OUTBOX_BASE_SECONDS = "600";
    const a = change("ex_held");
    enqueue("ex_held", a.sha, a.w);
    expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/ex_held");
    expect(originMain()).not.toBe(pipelineMain());
    stubGit("pass");
    const b = change("ex_rush");
    enqueue("ex_rush", b.sha, b.w, { express: true });
    expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/ex_rush");
    expect(originMain()).toBe(pipelineMain());
    expect(git(origin, "log", "--format=%s", "-2", "refs/heads/main").split("\n")).toEqual(["entry ex_rush", "entry ex_held"]);
    for (const line of pushes()) expect(line).not.toMatch(/--force|\s-f\s|\+[0-9a-f]{7,}:/);
    expect(run("pipeline.sh", ["status"]).stdout).toContain("GitHub main: in sync");
  }, 60_000);

  test("GitHub ahead of the landed main: express is refused before any push, with the documented repair, and nothing is forced", () => {
    const other = makeWorktree("ex_direct");
    writeFileSync(join(other, "direct.txt"), "pushed around the lander\n");
    commit(other, "direct push");
    git(other, "push", origin, "HEAD:refs/heads/main");
    const githubBefore = originMain();
    // The landed main has a commit GitHub lacks, and GitHub has one the landed main lacks: diverged.
    const tip = pipelineMain();
    const landedOnly = Bun.spawnSync([realGit(), "-C", main, "commit-tree", `${tip}^{tree}`, "-p", tip, "-m", "landed only"], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" } }).stdout.toString().trim();
    git(main, "update-ref", "refs/pipeline/main", landedOnly);
    const before = pushes().length;
    const r = change("ex_diverged");
    enqueue("ex_diverged", r.sha, r.w, { express: true });
    const out = run("lander.sh", ["run-once"]).stdout;
    expect(out).toContain("bounced: wt/ex_diverged");
    expect(note("ex_diverged").reason).toContain("bash scripts/pipeline.sh outbox reset-to-github");
    expect(pushes().length).toBe(before);
    expect(originMain()).toBe(githubBefore);
    expect(run("lander.sh", ["outbox", "reset-to-github"]).status).toBe(0);
    expect(pipelineMain()).toBe(originMain());
  }, 60_000);

  test("the landed main moving during the checks (a concurrent writer) requeues the entry; nothing stale is moved or pushed", () => {
    const { w, sha } = change("ex_race");
    const before = pushes().length;
    // The boot check stands in for a second writer that moves the landed main while this entry is being validated.
    env.MAIPAI_LAND_BOOT_CMD = `t=$(git -C ${main} rev-parse refs/pipeline/main); n=$(GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test git -C ${main} commit-tree "$t^{tree}" -p "$t" -m "moved meanwhile"); git -C ${main} update-ref refs/pipeline/main "$n" "$t"; echo moved`;
    enqueue("ex_race", sha, w, { express: true });
    const moved = run("lander.sh", ["run-once"]);
    env.MAIPAI_LAND_BOOT_CMD = "echo booted";
    expect(moved.stdout).toContain("requeued: wt/ex_race");
    expect(git(main, "log", "--format=%s", "-1", "refs/pipeline/main")).toBe("moved meanwhile");
    expect(pushes().length).toBe(before);
    expect(queueFiles()).toHaveLength(1);
    expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/ex_race");
    expect(git(main, "log", "--format=%s", "-2", "refs/pipeline/main").split("\n")).toEqual(["entry ex_race", "moved meanwhile"]);
  }, 60_000);

  test("express refuses docs/design/RULES.md and an unapproved safety file", () => {
    const rules = change("ex_rules", "docs/design/RULES.md", "rule\n");
    enqueue("ex_rules", rules.sha, rules.w, { express: true });
    run("lander.sh", ["run-once"]);
    expect(note("ex_rules").status).toBe("bounced");
    expect(note("ex_rules").reason).toContain("only the owner changes a rule");
    const safety = change("ex_safety", "backend/src/lib/session.ts", "export {};\n");
    enqueue("ex_safety", safety.sha, safety.w, { express: true });
    run("lander.sh", ["run-once"]);
    expect(note("ex_safety").reason).toContain("MAIPAI_RUSH_SAFETY_OK=1");
  }, 60_000);
});

describe("the owner's word for a safety file (MAIPAI_RUSH_SAFETY_OK)", () => {
  const queueSafety = (name: string, extraEnv: Record<string, string>) => {
    const { w } = change(name, "backend/src/lib/session.ts", `export const ${name} = 1;\n`);
    copyFileSync(join(import.meta.dir, "lib", "mode.sh"), join(main, "scripts", "lib", "mode.sh"));
    const r = Bun.spawnSync(["bash", join(main, "scripts", "land.sh"), "--queue-anyway", "--detach"], { cwd: w, env: { ...(env as Record<string, string>), MAIPAI_MODE: "direct", ...extraEnv }, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    const f = queueFiles().find((q) => q.endsWith(`-wt-${name}.json`))!;
    return JSON.parse(readFileSync(join(data, "queue", f), "utf8"));
  };
  test("MAIPAI_RUSH_SAFETY_OK=1 reaches the request and the lander lands the safety file; any other value or none bounces it", () => {
    const yes = queueSafety("safe_yes", { MAIPAI_RUSH_SAFETY_OK: "1" });
    expect(yes.express).toBe(true);
    expect(yes.safety_ok).toBe(true);
    env.MAIPAI_MODE = "direct";
    try {
    const out = run("lander.sh", ["run-once"]).stdout;
    expect(out).toContain("landed: wt/safe_yes");
    const no = queueSafety("safe_no", { MAIPAI_RUSH_SAFETY_OK: "0" });
    expect(no.safety_ok).toBeUndefined();
    run("lander.sh", ["run-once"]);
    expect(note("safe_no").reason).toContain("MAIPAI_RUSH_SAFETY_OK=1");
    } finally { delete env.MAIPAI_MODE; }
  }, 120_000);
});

describe("land.sh --checked (CHECKED-LANE-01)", () => {
  const checked = (name: string, file: string, mode: string, extra: string[] = []) => {
    const { w } = change(name, file, `export const ${name} = 1;\n`);
    copyFileSync(join(import.meta.dir, "lib", "mode.sh"), join(main, "scripts", "lib", "mode.sh"));
    const r = Bun.spawnSync(["bash", join(main, "scripts", "land.sh"), "--queue-anyway", "--detach", "--checked", ...extra], { cwd: w, env: { ...(env as Record<string, string>), MAIPAI_MODE: mode }, stdout: "pipe", stderr: "pipe" });
    const f = queueFiles().find((q) => q.endsWith(`-wt-${name}.json`));
    return { r, f, req: f ? JSON.parse(readFileSync(join(data, "queue", f), "utf8")) : undefined };
  };
  test("in DIRECT mode a --checked landing takes the normal lane with the full checks and the safety tests; the mode file is untouched", () => {
    const modeFile = join(scratch, "mode-untouched");
    const prior = { c: env.MAIPAI_LAND_CHECK_CMD, t: env.MAIPAI_LAND_T2_CMD, f: env.MAIPAI_MODE_FILE, m: env.MAIPAI_MODE };
    env.MAIPAI_MODE_FILE = modeFile; env.MAIPAI_MODE = "direct";
    try {
      // A failing static check bounces it (a plain direct landing would have landed).
      env.MAIPAI_LAND_CHECK_CMD = "echo typecheck error; exit 1";
      const bad = checked("chk_bad", "chk_bad.txt", "direct");
      expect(bad.r.exitCode).toBe(0);
      expect(bad.req.checked).toBe(true);
      expect(bad.req.express).toBeUndefined();
      expect(bad.f).toMatch(/^\d+-wt-/);
      run("lander.sh", ["run-once"]);
      expect(note("chk_bad").status).toBe("bounced");
      expect(note("chk_bad").reason).toContain("static check failed");
      // A safety file runs the T2 tests in direct mode too: failing tests bounce it, passing tests land it.
      env.MAIPAI_LAND_CHECK_CMD = "echo checked";
      env.MAIPAI_LAND_T2_CMD = "echo t2 failed; exit 1";
      const t2bad = checked("chk_t2bad", "backend/src/lib/session.ts", "direct");
      run("lander.sh", ["run-once"]);
      expect(note("chk_t2bad").reason).toContain("safety-surface tests failed");
      env.MAIPAI_LAND_T2_CMD = "echo t2 ok";
      checked("chk_t2ok", "backend/src/lib/session.ts", "direct");
      expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/chk_t2ok");
      expect(String((note("chk_t2ok") as Record<string, unknown>).label)).toContain("safety-surface tests");
      expect(existsSync(modeFile)).toBe(false);
    } finally {
      for (const [k, v] of [["MAIPAI_LAND_CHECK_CMD", prior.c], ["MAIPAI_LAND_T2_CMD", prior.t], ["MAIPAI_MODE_FILE", prior.f], ["MAIPAI_MODE", prior.m]] as const) { if (v === undefined) delete env[k]; else env[k] = v; }
    }
  }, 180_000);

  test("--checked works in GATED mode, and --checked with --express is refused", () => {
    const g = checked("chk_gated", "chk_gated.txt", "gated");
    expect(g.r.exitCode).toBe(0);
    expect(g.req.checked).toBe(true);
    rmSync(join(data, "queue", g.f!), { force: true });
    const { w } = change("chk_both");
    const both = Bun.spawnSync(["bash", join(main, "scripts", "land.sh"), "--queue-anyway", "--checked", "--express"], { cwd: w, env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
    expect(both.exitCode).toBe(2);
    expect(both.stderr.toString()).toContain("exclude each other");
    const help = Bun.spawnSync(["bash", join(main, "scripts", "land.sh"), "--help"], { stdout: "pipe", stderr: "pipe" });
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("--checked");
  }, 60_000);
});

describe("fairness between the lanes", () => {
  test("an express request never starts while another landing transaction holds the tree; it runs right after", () => {
    const n = change("fair_normal");
    const x = change("fair_express");
    // While the normal entry is in its static check, an express request arrives.
    const xreq = JSON.stringify({ branch: "wt/fair_express", sha: x.sha, worktree: x.w, session: "", requested_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), note: "", done: [], express: true });
    writeFileSync(join(scratch, "xreq.json"), xreq);
    const priorCheck = env.MAIPAI_LAND_CHECK_CMD;
    env.MAIPAI_LAND_CHECK_CMD = `cp ${join(scratch, "xreq.json")} ${join(data, "queue")}/0-$(date +%s)000-wt-fair_express.json; echo checked`;
    enqueue("fair_normal", n.sha, n.w);
    const first = run("lander.sh", ["run-once"]);
    env.MAIPAI_LAND_CHECK_CMD = priorCheck;
    expect(first.stdout).toContain("landed: wt/fair_normal");
    expect(first.stdout).not.toContain("fair_express");
    expect(existsSync(join(data, "notes", "wt-fair_express.json"))).toBe(false);
    expect(git(main, "log", "--format=%s", "-1", "refs/pipeline/main")).toBe("entry fair_normal");
    expect(queueFiles()).toEqual([expect.stringMatching(/^0-\d+-wt-fair_express\.json$/)]);
    expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/fair_express");
  }, 60_000);

  test("express goes first, at most two in a row, and a normal entry that waited ten minutes goes next regardless", () => {
    const order: string[] = [];
    writeFileSync(join(data, "express-streak"), "0\n"); // earlier tests landed express entries; this one counts from zero
    const landNext = () => { const out = run("lander.sh", ["run-once"]).stdout; const m = out.match(/landed: wt\/(\S+)/); if (m) order.push(m[1]!); };
    const n1 = change("fq_n1"); enqueue("fq_n1", n1.sha, n1.w, { ageMs: 60_000 });
    for (const name of ["fq_x1", "fq_x2", "fq_x3"]) { const c = change(name); enqueue(name, c.sha, c.w, { express: true }); }
    for (let i = 0; i < 4; i++) landNext();
    expect(order).toEqual(["fq_x1", "fq_x2", "fq_n1", "fq_x3"]);
    const n2 = change("fq_n2"); enqueue("fq_n2", n2.sha, n2.w, { ageMs: 11 * 60_000 });
    const x4 = change("fq_x4"); enqueue("fq_x4", x4.sha, x4.w, { express: true });
    landNext(); landNext();
    expect(order.slice(4)).toEqual(["fq_n2", "fq_x4"]);
  }, 120_000);
});

describe("time caps and results", () => {
  test("a step that hits its time cap is 'unfinished', never landed, and the landed main does not move (express too)", () => {
    const tip = pipelineMain();
    env.MAIPAI_LAND_BOOT_CMD = "sleep 30"; env.MAIPAI_LAND_BOOT_SECONDS = "1";
    const x = change("cap_express"); enqueue("cap_express", x.sha, x.w, { express: true });
    expect(run("lander.sh", ["run-once"]).stdout).toContain("unfinished: wt/cap_express");
    env.MAIPAI_LAND_BOOT_CMD = "echo booted"; delete env.MAIPAI_LAND_BOOT_SECONDS;
    expect(note("cap_express").status).toBe("unfinished");
    expect(landings().at(-1)!.status).toBe("unfinished");
    expect(pipelineMain()).toBe(tip);
    // The normal lane under a capped static check is not switched to the express policy; it is unfinished too.
    const prior = env.MAIPAI_LAND_CHECK_CMD;
    env.MAIPAI_LAND_CHECK_CMD = "sleep 30"; env.MAIPAI_LAND_CHECK_SECONDS = "1";
    const n = change("cap_normal"); enqueue("cap_normal", n.sha, n.w);
    run("lander.sh", ["run-once"]);
    env.MAIPAI_LAND_CHECK_CMD = prior; delete env.MAIPAI_LAND_CHECK_SECONDS;
    expect(note("cap_normal").status).toBe("unfinished");
    expect((note("cap_normal") as Record<string, unknown>).express).toBe(false);
    expect(pipelineMain()).toBe(tip);
  }, 60_000);

  test("a passing static check is reused for the same tree on the same base; a failure is never reused", () => {
    const calls = join(scratch, "check-calls");
    const prior = { check: env.MAIPAI_LAND_CHECK_CMD, t2: env.MAIPAI_LAND_T2_CMD };
    env.MAIPAI_LAND_CHECK_CMD = `echo x >> ${calls}; echo checked`;
    env.MAIPAI_LAND_T2_CMD = "if [[ -f T2_FAIL ]]; then exit 1; fi";
    const s = change("reuse", "backend/src/db/migrations/0997_reuse.sql", "select 1;\n");
    writeFileSync(join(s.w, "T2_FAIL"), "x\n");
    const sha = commit(s.w, "fails its T2 tests");
    enqueue("reuse", sha, s.w);
    run("lander.sh", ["run-once"]);
    expect(note("reuse").status).toBe("bounced");
    expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
    // Same commit, same base, T2 now passing: the static check is not run again.
    env.MAIPAI_LAND_T2_CMD = "true";
    enqueue("reuse", sha, s.w);
    run("lander.sh", ["run-once"]);
    env.MAIPAI_LAND_CHECK_CMD = prior.check; env.MAIPAI_LAND_T2_CMD = prior.t2;
    expect(note("reuse").status).toBe("landed");
    expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
    expect((note("reuse") as Record<string, unknown>).static_check_reused_from).toBeTruthy();
  }, 60_000);
});

describe("memory deferral (HOST-GUARD-09)", () => {
  test("safety tests the sharder deferred for memory (exit 75) hold the entry: not landed, not bounced, retried later", () => {
    const tip = pipelineMain();
    const prior = env.MAIPAI_LAND_T2_CMD;
    env.MAIPAI_LAND_T2_CMD = "echo 'shard: deferred (memory): backend: memory pressure level 2 for 300 s; not a pass'; exit 75";
    const s = change("memdefer", "backend/src/db/migrations/0996_memdefer.sql", "select 1;\n");
    enqueue("memdefer", s.sha, s.w);
    const out = run("lander.sh", ["run-once"]).stdout;
    env.MAIPAI_LAND_T2_CMD = prior;
    expect(out).toContain("held: wt/memdefer: deferred (memory): backend: memory pressure level 2");
    expect(pipelineMain()).toBe(tip);
    expect(landings().some((l) => l.branch === "wt/memdefer")).toBe(false);
  }, 60_000);
});

describe("batched backup", () => {
  test("no push when nothing is new; nothing before the batch interval; one push of the newest tip after it", () => {
    stubGit("pass");
    run("lander.sh", ["outbox", "flush"]);
    expect(originMain()).toBe(pipelineMain());
    const before = pushes().length;
    env.MAIPAI_LAND_BACKUP_SECONDS = "0";
    expect(run("lander.sh", ["outbox", "batch"]).stdout).toContain("no batch due");
    expect(pushes().length).toBe(before);
    // Two landings in the daemon's way (serving: no per-landing push), simulated by landing with pushes failing, then batching.
    stubGit("fail"); env.MAIPAI_LAND_OUTBOX_BASE_SECONDS = "0";
    for (const name of ["bb_1", "bb_2"]) { const c = change(name); enqueue(name, c.sha, c.w); run("lander.sh", ["run-once"]); }
    stubGit("pass");
    writeFileSync(join(data, "outbox", "last-push"), `${Math.floor(Date.now() / 1000)}\n`);
    env.MAIPAI_LAND_BACKUP_SECONDS = "300";
    const mid = pushes().length;
    expect(run("lander.sh", ["outbox", "batch"]).stdout).toContain("no batch due");
    expect(pushes().length).toBe(mid);
    env.MAIPAI_LAND_BACKUP_SECONDS = "0";
    run("lander.sh", ["outbox", "batch"]);
    expect(pushes().length).toBe(mid + 1);
    expect(pushes().at(-1)).toContain(`${pipelineMain()}:refs/heads/main`);
    expect(originMain()).toBe(pipelineMain());
  }, 60_000);
});

describe("one writer", () => {
  test("wt.sh land goes to the lander's queue; the shared script's own push to main is never reached", () => {
    const fake = join(scratch, "fake-shared-push.sh");
    writeFileSync(fake, `#!/usr/bin/env bash\necho "shared wt.sh ran $1" >> ${join(scratch, "shared-calls")}\ngit push origin HEAD:main\n`);
    env.MAIPAI_WT_SHARED = fake;
    const c = change("one_writer");
    const githubBefore = originMain();
    const r = Bun.spawnSync(["bash", join(main, "scripts", "wt.sh"), "land", "--queue-anyway", "--detach"], { cwd: c.w, env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
    delete env.MAIPAI_WT_SHARED;
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("queued: wt/one_writer");
    expect(existsSync(join(scratch, "shared-calls"))).toBe(false);
    expect(originMain()).toBe(githubBefore);
    expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/one_writer");
  }, 60_000);
});

describe("pins go to GitHub before the main that names them", () => {
  test("a commons tag only this Mac has is pushed first; a tag nobody has holds main back with the reason", () => {
    stubGit("pass");
    const commonsOrigin = join(scratch, "commons-origin.git");
    const commons = join(scratch, "commons-clone");
    Bun.spawnSync(["git", "init", "-q", "--bare", "--initial-branch=main", commonsOrigin]);
    Bun.spawnSync(["git", "clone", "-q", commonsOrigin, commons]);
    git(commons, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "--allow-empty", "-m", "commons base");
    git(commons, "push", "-q", "origin", "HEAD:main");
    git(commons, "tag", "ui-v9.9.9");
    env.MAIPAI_COMMONS_REPO = commons; env.MAIPAI_STACK_REPO = join(scratch, "no-stack-here");
    env.MAIPAI_LAND_BACKUP_SECONDS = "0"; env.MAIPAI_LAND_OUTBOX_BASE_SECONDS = "0";
    const pin = change("pin_ok", "backend/package.json", `{"dependencies":{"@maipai/ui":"file:../../commons-tags/ui-ui-v9.9.9/ui"}}\n`);
    enqueue("pin_ok", pin.sha, pin.w);
    run("lander.sh", ["run-once"]);
    expect(git(commonsOrigin, "rev-parse", "refs/tags/ui-v9.9.9")).toBe(git(commons, "rev-parse", "ui-v9.9.9"));
    expect(originMain()).toBe(pipelineMain());
    const missing = change("pin_missing", "backend/package.json", `{"dependencies":{"@maipai/ui":"file:../../commons-tags/ui-ui-v0.0.404/ui"}}\n`);
    enqueue("pin_missing", missing.sha, missing.w);
    run("lander.sh", ["run-once"]);
    expect(originMain()).not.toBe(pipelineMain());
    expect(readFileSync(join(data, "outbox", "last-error"), "utf8")).toContain("ui-v0.0.404 is on neither GitHub nor this Mac");
    delete env.MAIPAI_COMMONS_REPO; delete env.MAIPAI_STACK_REPO;
  }, 60_000);
});
