import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { scratch, origin, main, data, pipelineBin, env, git, run, makeWorktree, commit, note, queueFiles, setup, cleanup } = fixtures.createLanderFixtures();

beforeAll(setup, 60_000);

describe("pipeline resilience", () => {
  test("launch services write plists, load twice, and uninstall cleanly", () => {
    const agents = join(scratch, "launch-agents");
    const calls = join(scratch, "launchctl-calls");
    const fake = join(scratch, "launchctl");
    writeFileSync(fake, "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$MAIPAI_LAUNCHCTL_CALLS\"\n");
    chmodSync(fake, 0o755);
    const prior = { dir: env.MAIPAI_LAUNCH_AGENTS_DIR, command: env.MAIPAI_LAUNCHCTL, calls: env.MAIPAI_LAUNCHCTL_CALLS };
    env.MAIPAI_LAUNCH_AGENTS_DIR = agents;
    env.MAIPAI_LAUNCHCTL = fake;
    env.MAIPAI_LAUNCHCTL_CALLS = calls;

    const installed = run("pipeline.sh", ["install-service", "--load"]);
    expect(installed.status).toBe(0);
    const lander = readFileSync(join(agents, "com.maipai.lander.plist"), "utf8");
    const watcher = readFileSync(join(agents, "com.maipai.watcher.plist"), "utf8");
    for (const [xml, label, script, log] of [
      [lander, "com.maipai.lander", join(pipelineBin, "lander.sh"), join(data, "lander.log")],
      [watcher, "com.maipai.watcher", join(pipelineBin, "watcher.sh"), join(env.MAIPAI_WATCH_DATA!, "watcher.log")],
    ]) {
      expect(xml).toContain(`<string>${label}</string>`);
      expect(xml).toContain(`<string>${script}</string>`);
      expect(xml).toContain(`<string>${realpathSync(main)}</string>`);
      expect(xml).toContain("<key>RunAtLoad</key>");
      expect(xml).toContain("<key>KeepAlive</key>");
      expect(xml).toContain("<integer>10</integer>");
      expect(xml).toContain(`<string>${log}</string>`);
      expect(xml).toContain("<key>PATH</key>");
      expect(xml).toContain("<key>HOME</key>");
    }
    expect(installed.stdout).toContain(`would run: /bin/bash ${pipelineBin}/lander.sh serve`);
    expect(readFileSync(calls, "utf8").match(/bootstrap/g)).toHaveLength(2);
    const removed = run("pipeline.sh", ["uninstall-service"]);
    expect(removed.status).toBe(0);
    expect(readFileSync(calls, "utf8").match(/bootout/g)).toHaveLength(2);
    expect(existsSync(join(agents, "com.maipai.lander.plist"))).toBe(false);
    expect(existsSync(join(agents, "com.maipai.watcher.plist"))).toBe(false);
    env.MAIPAI_LAUNCH_AGENTS_DIR = prior.dir;
    env.MAIPAI_LAUNCHCTL = prior.command;
    env.MAIPAI_LAUNCHCTL_CALLS = prior.calls;
  });

  test("land.sh fails before pushing when the lander is absent and --queue-anyway queues", () => {
    const wt = makeWorktree("no_lander");
    writeFileSync(join(wt, "file.txt"), "no lander\n");
    const sha = commit(wt, "queue without daemon");
    const denied = run("land.sh", ["--detach"], wt, true);
    expect(denied.status).toBe(3);
    expect(denied.stderr).toContain("the lander is not running: start it with bash scripts/pipeline.sh start (or install-service)");
    expect(Bun.spawnSync(["git", "--git-dir", origin, "show-ref", "--verify", "refs/heads/wt/no_lander"]).exitCode).not.toBe(0);
    expect(queueFiles()).toHaveLength(0);
    const queued = run("land.sh", ["--detach", "--queue-anyway"], wt, true);
    expect(queued.status).toBe(0);
    expect(queued.stdout).toContain(`queued: wt/no_lander at ${sha}`);
    for (const file of queueFiles()) rmSync(join(data, "queue", file), { force: true });
  });

  test("a hand start refuses politely while the launch style daemon is running", async () => {
    const prior = env.MAIPAI_LAND_POLL_SECONDS;
    const priorPath = env.PATH;
    const fakeBin = join(scratch, "fake-process-tools");
    mkdirSync(fakeBin, { recursive: true });
    const fakePs = join(fakeBin, "ps");
    writeFileSync(fakePs, "#!/bin/bash\nprintf '%s\\n' 'bash /fixture/scripts/lander.sh serve'\n");
    chmodSync(fakePs, 0o755);
    env.MAIPAI_LAND_POLL_SECONDS = "1";
    env.PATH = `${fakeBin}:${priorPath ?? ""}`;
    const server = Bun.spawn(["bash", join(main, "scripts", "lander.sh"), "serve"], { cwd: main, env, stdout: "pipe", stderr: "pipe" });
    const pidfile = join(data, "lander.pid");
    try {
      const deadline = Date.now() + 10_000;
      while (!existsSync(pidfile) && Date.now() < deadline) await Bun.sleep(25);
      expect(existsSync(pidfile)).toBe(true);
      const duplicate = run("lander.sh", ["serve"]);
      expect(duplicate.status).toBe(1);
      expect(duplicate.stderr).toContain("already running as pid");
    } finally {
      if (existsSync(pidfile)) process.kill(Number(readFileSync(pidfile, "utf8").trim()), "SIGTERM");
      expect(await server.exited).toBe(0);
      env.MAIPAI_LAND_POLL_SECONDS = prior;
      env.PATH = priorPath;
    }
  }, 60_000);

  test("clean main checkout fast-forwards and tracked dirt is left alone", () => {
    const prior = env.MAIPAI_LAND_UPDATE_MAIN;
    env.MAIPAI_LAND_UPDATE_MAIN = "1";
    const clean = makeWorktree("main_update");
    writeFileSync(join(clean, "file.txt"), "main update\n");
    commit(clean, "main checkout fast forward");
    expect(run("land.sh", ["--detach"], clean).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(git(main, "rev-parse", "HEAD")).toBe(git(origin, "rev-parse", "main"));
    expect(readFileSync(join(data, "lander.log"), "utf8")).toContain("main checkout fast-forwarded");

    const dirty = makeWorktree("main_dirty");
    writeFileSync(join(dirty, "file.txt"), "main dirty landing\n");
    commit(dirty, "landing while main dirty");
    writeFileSync(join(main, "file.txt"), "local tracked edit\n");
    const before = git(main, "rev-parse", "HEAD");
    expect(run("land.sh", ["--detach"], dirty).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(git(main, "rev-parse", "HEAD")).toBe(before);
    expect(readFileSync(join(main, "file.txt"), "utf8")).toBe("local tracked edit\n");
    expect(readFileSync(join(data, "lander.log"), "utf8")).toContain("main checkout update skipped: dirty tracked tree");
    env.MAIPAI_LAND_UPDATE_MAIN = prior;
  });

  test("safety surface runs T2 and bounces on failure; docs changes stay on the static path", () => {
    const calls = join(scratch, "t2-calls");
    env.MAIPAI_T2_CALLS_FILE = calls;
    env.MAIPAI_LAND_T2_CMD = "echo called >> \"$MAIPAI_T2_CALLS_FILE\"; if [[ -f T2_FAIL ]]; then echo 'fake T2 failure'; exit 1; fi";
    const safety = makeWorktree("safety_t2");
    mkdirSync(join(safety, "backend/src/auth"), { recursive: true });
    writeFileSync(join(safety, "backend/src/auth/x.ts"), "export {};\n");
    writeFileSync(join(safety, "T2_FAIL"), "fail\n");
    commit(safety, "safety surface failure");
    expect(run("land.sh", ["--detach"], safety).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(readFileSync(calls, "utf8").trim()).toBe("called");
    expect(note("safety_t2").status).toBe("bounced");
    expect(note("safety_t2").reason).toBe("safety-surface tests failed: backend/src/auth/x.ts");

    rmSync(calls, { force: true });
    const docs = makeWorktree("docs_only");
    mkdirSync(join(docs, "docs"), { recursive: true });
    writeFileSync(join(docs, "docs/readme.md"), "docs change\n");
    commit(docs, "docs only change");
    expect(run("land.sh", ["--detach"], docs).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(existsSync(calls)).toBe(false);
    expect(note("docs_only").status).toBe("landed");

    env.MAIPAI_LAND_T2_CMD = "echo called >> \"$MAIPAI_T2_CALLS_FILE\"";
    const passing = makeWorktree("safety_t2_pass");
    mkdirSync(join(passing, "backend/src/auth"), { recursive: true });
    writeFileSync(join(passing, "backend/src/auth/pass.ts"), "export {};\n");
    commit(passing, "safety surface passes");
    expect(run("land.sh", ["--detach"], passing).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(note("safety_t2_pass").status).toBe("landed");
    expect(note("safety_t2_pass").note).toMatch(/tier: T2; safety-surface tests took \d+s/);
    delete env.MAIPAI_LAND_T2_CMD;
    delete env.MAIPAI_T2_CALLS_FILE;
  });
});

afterAll(cleanup);
