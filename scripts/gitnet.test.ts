import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// GITNET-01: a hung remote git operation or long step is bounded, killed by its own process group, and reported, so it cannot block the landing queue.
const lib = join(import.meta.dir, "lib", "gitnet.sh");
let scratch = "";
let fakeBin = "";
let ops = "";
let stuck = "";

function sh(script: string, extraEnv: Record<string, string> = {}) {
  const started = Date.now();
  const result = Bun.spawnSync(["bash", "-c", `source ${JSON.stringify(lib)}\n${script}`], {
    env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, HOME: scratch, TMPDIR: scratch, GITNET_OPS_DIR: ops, GITNET_STUCK_LOG: stuck, GITNET_STATE_DIR: join(scratch, "state"), ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { status: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString(), seconds: (Date.now() - started) / 1000 };
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "gitnet-")));
  fakeBin = join(scratch, "bin");
  ops = join(scratch, "ops");
  stuck = join(scratch, "stuck.log");
  mkdirSync(fakeBin);
  mkdirSync(ops);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function stubGit(body: string) {
  writeFileSync(join(fakeBin, "git"), `#!/bin/bash\n${body}\n`);
  chmodSync(join(fakeBin, "git"), 0o755);
}

describe("bounded_run", () => {
  test("passes the command's own exit status", () => {
    expect(sh("bounded_run 5 ok true").status).toBe(0);
    expect(sh("bounded_run 5 three bash -c 'exit 3'").status).toBe(3);
  });

  test("a hung command is killed with its children, returns 124, leaves a stuck record and no op file", () => {
    const pidfile = join(scratch, "grandchild.pid");
    const run = sh(`bounded_run 2 "hung step" bash -c 'sleep 600 & echo $! > ${pidfile}; wait'`);
    expect(run.status).toBe(124);
    expect(run.seconds).toBeLessThan(8);
    const grandchild = Number(readFileSync(pidfile, "utf8").trim());
    expect(grandchild).toBeGreaterThan(1);
    expect(alive(grandchild)).toBe(false);
    expect(readdirSync(ops).filter((f) => f.endsWith(".op"))).toEqual([]);
    const line = JSON.parse(readFileSync(stuck, "utf8").trim().split("\n").at(-1)!);
    expect(line.op).toBe("hung step");
    expect(line.seconds).toBe(2);
  });

  test("a running command is named in the ops directory while it runs", async () => {
    const proc = Bun.spawn(["bash", "-c", `source ${JSON.stringify(lib)}; bounded_run 20 "long step" sleep 5`], { env: { PATH: process.env.PATH ?? "", HOME: scratch, GITNET_OPS_DIR: ops, GITNET_STUCK_LOG: stuck } });
    let record = "";
    const deadline = Date.now() + 4000;
    while (!record && Date.now() < deadline) {
      const files = readdirSync(ops).filter((f) => f.endsWith(".op"));
      if (files[0]) record = readFileSync(join(ops, files[0]), "utf8");
      else await Bun.sleep(50);
    }
    expect(record).toMatch(/^\d+\t\d+\t20\tlong step\n$/);
    proc.kill();
    await proc.exited;
  });
});

describe("gitnet", () => {
  test("a timed-out operation is tried three times, then fails as a timeout", () => {
    const counter = join(scratch, "calls-timeout");
    writeFileSync(counter, "");
    stubGit(`echo x >> ${counter}\nsleep 600`);
    const run = sh(`GITNET_TIMEOUT=1 GITNET_BACKOFF=0 gitnet push origin main; echo "rc=$? timedout=$GITNET_TIMED_OUT"`);
    expect(run.out).toContain("rc=124 timedout=1");
    expect(readFileSync(counter, "utf8").trim().split("\n")).toHaveLength(3);
    expect(run.err).toContain("timed out after 1s; retry 2 of 3");
    expect(run.seconds).toBeLessThan(15);
  });

  test("a rejected push is not retried", () => {
    const counter = join(scratch, "calls-rejected");
    writeFileSync(counter, "");
    stubGit(`echo x >> ${counter}\necho ' ! [rejected] main -> main (non-fast-forward)' >&2\nexit 1`);
    const run = sh(`GITNET_BACKOFF=0 gitnet push origin main; echo "rc=$? timedout=$GITNET_TIMED_OUT"`);
    expect(run.out).toContain("rc=1 timedout=0");
    expect(readFileSync(counter, "utf8").trim().split("\n")).toHaveLength(1);
    expect(run.err).toContain("non-fast-forward");
  });

  test("a connection reset is retried and a later success returns 0", () => {
    const counter = join(scratch, "calls-reset");
    writeFileSync(counter, "");
    stubGit(`echo x >> ${counter}\nif [ "$(wc -l < ${counter})" -lt 2 ]; then echo 'fatal: unable to access: Connection reset by peer' >&2; exit 128; fi\necho fetched`);
    const run = sh(`GITNET_BACKOFF=0 gitnet -C /nonexistent fetch origin; echo "rc=$?"`);
    expect(run.out).toContain("fetched");
    expect(run.out).toContain("rc=0");
    expect(readFileSync(counter, "utf8").trim().split("\n")).toHaveLength(2);
  });

  test("a hung ssh child of a real git push is killed with the bound (stub ssh sleeps ten minutes)", () => {
    const realGit = Bun.spawnSync(["bash", "-c", "command -v git"]).stdout.toString().trim();
    rmSync(join(fakeBin, "git"), { force: true });
    const repo = join(scratch, "repo");
    for (const args of [["init", "-q", repo], ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "x"]]) Bun.spawnSync([realGit, ...args]);
    const sshPid = join(scratch, "stub-ssh.pid");
    writeFileSync(join(scratch, "stub-ssh"), `#!/bin/bash\necho $$ > ${sshPid}\nsleep 600\n`);
    chmodSync(join(scratch, "stub-ssh"), 0o755);
    const run = sh(`cd ${repo}; GITNET_ENV_SET=ssh GIT_SSH_COMMAND=${join(scratch, "stub-ssh")} GITNET_TIMEOUT=2 GITNET_TRIES=1 gitnet push git@github.com:example/none.git HEAD:refs/heads/probe; echo "rc=$? timedout=$GITNET_TIMED_OUT"`);
    expect(run.out).toContain("rc=124 timedout=1");
    expect(run.seconds).toBeLessThan(10);
    const pid = Number(readFileSync(sshPid, "utf8").trim());
    expect(pid).toBeGreaterThan(1);
    expect(alive(pid)).toBe(false);
  });
});

describe("gitnet_env", () => {
  test("keeps the repo's deploy key command, adds the 443 ssh config once, and is per-process", () => {
    const repo = join(scratch, "envrepo");
    Bun.spawnSync(["git", "init", "-q", repo]);
    Bun.spawnSync(["git", "-C", repo, "config", "core.sshCommand", "ssh -i /keys/deploy -o IdentitiesOnly=yes"]);
    const run = sh(`gitnet_env ${repo}; gitnet_env ${repo}; printf '%s\\n' "$GIT_SSH_COMMAND" "$GIT_HTTP_LOW_SPEED_TIME" "$GIT_TERMINAL_PROMPT"`);
    const [command, lowSpeed, prompt] = run.out.trim().split("\n");
    expect(command).toMatch(/^ssh -i \/keys\/deploy -o IdentitiesOnly=yes -F \S+\/ssh_config$/);
    expect(command!.match(/-F /g)).toHaveLength(1);
    expect(lowSpeed).toBe("30");
    expect(prompt).toBe("0");
    const cfg = readFileSync(join(scratch, "state", "ssh_config"), "utf8");
    expect(cfg).toContain("HostName ssh.github.com");
    expect(cfg).toContain("Port 443");
    expect(cfg).toContain("ServerAliveInterval 10");
    expect(Bun.spawnSync(["git", "-C", repo, "config", "--get", "core.sshCommand"]).stdout.toString()).toContain("/keys/deploy -o IdentitiesOnly=yes\n");
  });

  test("the https-only form leaves GIT_SSH_COMMAND alone so each repo's own deploy key stays in charge, and a later full call still adds the ssh part", () => {
    const run = sh(`GITNET_NO_SSH_COMMAND=1 gitnet_env /nonexistent; echo "first=[\${GIT_SSH_COMMAND:-}] low=$GIT_HTTP_LOW_SPEED_TIME set=$GITNET_ENV_SET"; gitnet_env /nonexistent; echo "second=[$GIT_SSH_COMMAND] set=$GITNET_ENV_SET"`);
    expect(run.out).toContain("first=[] low=30 set=https");
    expect(run.out).toMatch(/second=\[ssh -F \S+\/ssh_config\] set=ssh/);
  });

  test("ssh resolves github.com to ssh.github.com on port 443 and keeps the other hosts' settings", () => {
    if (!existsSync("/usr/bin/ssh")) return;
    const cfg = join(scratch, "state", "ssh_config");
    const resolved = (host: string) => Bun.spawnSync(["ssh", "-F", cfg, "-G", host], { env: { PATH: process.env.PATH ?? "", HOME: scratch } }).stdout.toString();
    const gh = resolved("github.com");
    expect(gh).toMatch(/^hostname ssh\.github\.com$/m);
    expect(gh).toMatch(/^port 443$/m);
    expect(gh).toMatch(/^hostkeyalias github\.com$/m);
    expect(gh).toMatch(/^connecttimeout 15$/m);
    expect(gh).toMatch(/^batchmode yes$/m);
    const other = resolved("example.com");
    expect(other).toMatch(/^hostname example\.com$/m);
    expect(other).toMatch(/^port 22$/m);
    expect(other).toMatch(/^batchmode no$/m);
    expect(other).toMatch(/^serveraliveinterval 10$/m);
  });
});
