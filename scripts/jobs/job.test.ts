// HOST-LAUNCH-01: the dev job launcher and watchdog (scripts/jobs/job.ts).
import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alive, decideLaunch, memoryAction, parseDuration, readAudit, type JobRecord } from "./lib";

const JOB = join(import.meta.dir, "job.ts");
const temps: string[] = [];
afterAll(() => { for (const t of temps) rmSync(t, { recursive: true, force: true }); });
function env(extra: Record<string, string> = {}) {
  const state = mkdtempSync(join(tmpdir(), "jobs-")); const guard = mkdtempSync(join(tmpdir(), "guard-")); temps.push(state, guard);
  return { PATH: process.env.PATH!, HOME: process.env.HOME!, MAIPAI_JOBS_DIR: state, MAIPAI_HOST_GUARD_STATE_DIR: guard, MAIPAI_HOSTMEM_PRESSURE: "1", MAIPAI_JOBS_TICK_MS: "100", MAIPAI_JOBS_MIN_DISK_GB: "0", ...extra };
}
const job = (e: Record<string, string>, ...args: string[]) => Bun.spawnSync(["bun", JOB, ...args], { env: e, stdout: "pipe", stderr: "pipe" });
const actions = (e: Record<string, string>) => { const was = process.env.MAIPAI_JOBS_DIR; process.env.MAIPAI_JOBS_DIR = e.MAIPAI_JOBS_DIR; const a = readAudit(); process.env.MAIPAI_JOBS_DIR = was; if (was === undefined) delete process.env.MAIPAI_JOBS_DIR; return a; };
const calm = { loadPerCore: 0.3, running: 0, progressing: 0, pressure: { level: 1, devShed: false }, freeDiskGb: 100, cap: 4, minDiskGb: 5 };

describe("launch decision (pure)", () => {
  test("a calm Mac under the cap goes; at the cap it waits", () => {
    expect(decideLaunch(calm).go).toBe(true);
    expect(decideLaunch({ ...calm, running: 4 }).go).toBe(false);
  });
  test("high load with every job progressing lowers concurrency instead of stopping everything", () => {
    const hot = { ...calm, loadPerCore: 2.5, cap: 4 };
    expect(decideLaunch({ ...hot, running: 1, progressing: 1 })).toMatchObject({ go: true, limit: 2 });
    expect(decideLaunch({ ...hot, running: 2, progressing: 2 }).go).toBe(false);
  });
  test("high load with a job that is not progressing pauses new launches, naming it", () => {
    const d = decideLaunch({ ...calm, loadPerCore: 2.5, running: 2, progressing: 1 });
    expect(d.go).toBe(false); expect(d.why).toContain("1 running job(s) are not progressing");
  });
  test("memory pressure, the host guard's shed flag and a nearly full disk each hold launches", () => {
    expect(decideLaunch({ ...calm, pressure: { level: 2, devShed: false } }).go).toBe(false);
    expect(decideLaunch({ ...calm, pressure: { level: 1, devShed: true } }).go).toBe(false);
    expect(decideLaunch({ ...calm, freeDiskGb: 2 }).go).toBe(false);
  });
  test("memory rule: pause first; only the largest, still-growing job is stopped; a hard cap always stops", () => {
    expect(memoryAction({ rssMb: 900, growthMb: 10 }, 900, false, 24000)).toBe("none");
    expect(memoryAction({ rssMb: 500, growthMb: 900 }, 9000, true, 24000)).toBe("pause");
    expect(memoryAction({ rssMb: 9000, growthMb: 10 }, 9000, true, 24000)).toBe("pause");
    expect(memoryAction({ rssMb: 9000, growthMb: 4000 }, 9000, true, 24000)).toBe("stop");
    expect(memoryAction({ rssMb: 30000, growthMb: 0 }, 30000, false, 24000)).toBe("stop");
  });
  test("durations", () => { expect(parseDuration("90")).toBe(90); expect(parseDuration("2h")).toBe(7200); expect(() => parseDuration("soon")).toThrow(); });
});

describe("running jobs", () => {
  test("passes the exit code through and audits launch and finish with session, command and worktree", () => {
    const e = env();
    const ok = job(e, "run", "--session", "s-one", "--", "bash", "-c", "echo hello; exit 0");
    expect(ok.exitCode).toBe(0); expect(ok.stdout.toString()).toContain("hello");
    expect(job(e, "run", "--", "bash", "-c", "exit 3").exitCode).toBe(3);
    const a = actions(e);
    expect(a.map((x) => x.action)).toEqual(["launched", "finished", "launched", "finished"]);
    expect(a[0]).toMatchObject({ session: "s-one", command: "bash -c echo hello; exit 0", trigger: "start" });
    expect(a[0]!.worktree).toBe(process.cwd());
  });

  test("a hung job is stopped at its limit, with output and process tree saved, and reported UNFINISHED (never a pass)", () => {
    const e = env();
    const r = job(e, "run", "--type", "test", "--timeout", "1", "--", "bash", "-c", "echo started; sleep 60");
    expect(r.exitCode).toBe(124);
    expect(r.stderr.toString()).toContain("UNFINISHED");
    expect(r.stderr.toString()).toContain("not a pass");
    const cap = readdirSync(e.MAIPAI_JOBS_DIR + "/jobs").find((n) => n.endsWith(".capture.txt"))!;
    const text = readFileSync(join(e.MAIPAI_JOBS_DIR, "jobs", cap), "utf-8");
    expect(text).toContain("process tree"); expect(text).toContain("sleep 60"); expect(text).toContain("started");
    expect(actions(e).some((x) => x.action === "captured-and-stopped")).toBe(true);
    const rec = JSON.parse(readFileSync(join(e.MAIPAI_JOBS_DIR, "jobs", readdirSync(e.MAIPAI_JOBS_DIR + "/jobs").find((n) => /^[^.]+\.json$/.test(n))!), "utf-8")) as JobRecord;
    expect(rec.state).toBe("unfinished");
  });

  test("workers a finished command left behind are cleaned up", () => {
    const e = env(); const pidFile = join(e.MAIPAI_JOBS_DIR, "worker.pid");
    const r = job(e, "run", "--", "bash", "-c", `sleep 60 & echo $! > ${pidFile}; exit 0`);
    expect(r.exitCode).toBe(0);
    const pid = Number(readFileSync(pidFile, "utf-8"));
    expect(alive(pid)).toBe(false);
    expect(actions(e).some((x) => x.action === "workers-cleaned")).toBe(true);
  });

  test("a server must state its lifetime, and is stopped when it ends", () => {
    const e = env();
    const refused = job(e, "run", "--type", "server", "--", "sleep", "30");
    expect(refused.exitCode).toBe(2); expect(refused.stderr.toString()).toContain("--lifetime");
    const r = job(e, "run", "--type", "server", "--lifetime", "1", "--", "sleep", "60");
    expect(r.exitCode).toBe(143); expect(r.stderr.toString()).toContain("server lifetime ended");
  });

  test("memory pressure pauses the job, the audit says so, and it resumes and finishes when the pressure clears", async () => {
    const e = env(); delete (e as Record<string, string>).MAIPAI_HOSTMEM_PRESSURE;
    const p = Bun.spawn(["bun", JOB, "run", "--", "bash", "-c", "sleep 3; echo done"], { env: { ...e, MAIPAI_HOSTMEM_PRESSURE: "1" }, stdout: "pipe", stderr: "pipe" });
    await Bun.sleep(1000);
    writeFileSync(join(e.MAIPAI_HOST_GUARD_STATE_DIR, "dev-shed"), "{}");
    await Bun.sleep(1200);
    rmSync(join(e.MAIPAI_HOST_GUARD_STATE_DIR, "dev-shed"));
    expect(await p.exited).toBe(0);
    const a = actions(e).map((x) => x.action);
    expect(a).toContain("paused"); expect(a).toContain("resumed");
  }, 20000);

  test("a launch under memory pressure waits, then gives up as not started (never a pass)", () => {
    const e = env({ MAIPAI_HOSTMEM_PRESSURE: "2", MAIPAI_JOBS_WAIT_S: "1" });
    const r = job(e, "run", "--", "bash", "-c", "echo should-not-run");
    expect(r.exitCode).toBe(75); expect(r.stdout.toString()).not.toContain("should-not-run");
    expect(r.stderr.toString()).toContain("UNFINISHED");
    expect(actions(e).map((x) => x.action)).toEqual(["launch-deferred", "launch-gave-up"]);
  });
});

describe("orphan dev servers", () => {
  test("a recorded server whose worktree is gone is listed, and stopped only with --stop", async () => {
    const e = env();
    const victim = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
    const ended = new Promise<void>((res) => victim.on("exit", () => res()));
    const dir = join(e.MAIPAI_JOBS_DIR, "jobs"); Bun.spawnSync(["mkdir", "-p", dir]);
    const rec: JobRecord = { id: "orph", type: "server", session: "gone", worktree: "/nonexistent/worktree", command: "sleep 60", pid: victim.pid!, pgid: victim.pid!, startedAt: 1, state: "running", log: join(dir, "orph.log") };
    writeFileSync(join(dir, "orph.json"), JSON.stringify(rec));
    const listed = job(e, "orphans"); expect(listed.stdout.toString()).toContain(String(victim.pid)); expect(alive(victim.pid!)).toBe(true);
    job(e, "orphans", "--stop"); await ended;
    expect(victim.signalCode).toBe("SIGTERM");
    expect(actions(e).some((x) => x.action === "orphan-stopped")).toBe(true);
  });
  test("a server whose worktree still exists is not an orphan", () => {
    const e = env(); const dir = join(e.MAIPAI_JOBS_DIR, "jobs"); Bun.spawnSync(["mkdir", "-p", dir]);
    writeFileSync(join(dir, "ok.json"), JSON.stringify({ id: "ok", type: "server", session: "s", worktree: tmpdir(), command: "sleep 1", pid: process.pid, pgid: process.pid, startedAt: 1, state: "running", log: "x" }));
    expect(job(e, "orphans").stdout.toString()).toContain("no orphan dev servers");
    expect(existsSync(dir)).toBe(true);
  });
});
