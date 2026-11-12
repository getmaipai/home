#!/usr/bin/env bun
// HOST-LAUNCH-01: the dev job launcher and watchdog. Every dev test, build and temporary server runs through it (bash scripts/jobs/job.sh).
//
//   job.sh run [--type test|build|server|other] [--timeout 15m] [--lifetime 8h] [--session name] [--max-rss-mb N] -- <command...>
//   job.sh list | audit [n] | orphans [--stop]
//
// What it does: runs the command as its own process group (so every worker it spawns is cleaned up when it ends or is stopped);
// waits at launch while the machine is saturated or short of memory (progress-aware, see lib.ts decideLaunch); enforces a timeout per
// job type and on timeout captures the output tail and the process tree and reports UNFINISHED (exit 124, never a pass); on memory
// pressure pauses the group, captures, and stops only the job that is the largest and still growing (by its recorded pid); watches
// free disk and file churn; writes one audit line per action. A server must say how long it may live (--lifetime). Runs as the user.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, statfsSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { basename, join, resolve } from "node:path";
import { DEFAULT_TIMEOUT_S, alive, audit, decideLaunch, ensureDirs, jobTypeOf, jobsDir, memoryAction, parseDuration, readAudit, readJobs, readPressure, writeJob, type JobRecord } from "./lib";

const repoRoot = resolve(import.meta.dir, "..", "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: string | undefined, d: number) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
const TICK_MS = num(process.env.MAIPAI_JOBS_TICK_MS, 2000);

/** pids of one process group with their RSS in MB, from ps (the launcher's own view, no root needed). */
function groupProcs(pgid: number): Array<{ pid: number; rssMb: number; cpu: number; line: string }> {
  const out = spawnSync("/bin/ps", ["-axo", "pid=,pgid=,rss=,pcpu=,etime=,command="], { encoding: "utf-8" }).stdout ?? "";
  const procs: Array<{ pid: number; rssMb: number; cpu: number; line: string }> = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m && Number(m[2]) === pgid) procs.push({ pid: Number(m[1]), rssMb: Number(m[3]) / 1024, cpu: Number(m[4]), line: line.trim() });
  }
  return procs;
}
const killGroup = (pgid: number, sig: NodeJS.Signals) => { try { process.kill(-pgid, sig); } catch { /* already gone */ } };

async function stopGroup(pgid: number): Promise<void> {
  killGroup(pgid, "SIGCONT"); killGroup(pgid, "SIGTERM");
  for (let i = 0; i < 20 && groupProcs(pgid).length; i++) await sleep(250);
  killGroup(pgid, "SIGKILL");
}

function freeDiskGb(path: string): number { try { const s = statfsSync(path); return (Number(s.bavail) * Number(s.bsize)) / 1e9; } catch { return 1e6; } }

/** Files changed under the worktree since the job started (a runaway writer is the file-event daemon's food); capped, never a cost itself. */
function churnCount(worktree: string, sinceEpoch: number): number {
  if (!existsSync(worktree)) return 0;
  const marker = join(jobsDir(), `.churn-${process.pid}`);
  writeFileSync(marker, ""); const t = new Date(sinceEpoch * 1000);
  try { utimesSync(marker, t, t); } catch { return 0; }
  const out = spawnSync("/usr/bin/find", [worktree, "-type", "f", "-newer", marker, "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*"], { encoding: "utf-8", timeout: 10_000, maxBuffer: 8e6 }).stdout ?? "";
  return Math.min(out.split("\n").filter(Boolean).length, 100000);
}

function capture(rec: JobRecord, reason: string): string {
  const file = join(jobsDir(), `${rec.id}.capture.txt`);
  const tree = groupProcs(rec.pgid).map((p) => `${p.rssMb.toFixed(0)}MB ${p.cpu}%cpu  ${p.line}`).join("\n");
  let tail = ""; try { tail = spawnSync("/usr/bin/tail", ["-n", "80", rec.log], { encoding: "utf-8" }).stdout ?? ""; } catch { /* no log yet */ }
  appendFileSync(file, `== ${new Date().toISOString()} ${reason}\n-- process tree\n${tree}\n-- last output\n${tail}\n`);
  return file;
}

async function run(argv: string[]): Promise<number> {
  const dd = argv.indexOf("--");
  if (dd < 0 || dd === argv.length - 1) { console.error("job.sh run: put the command after --, for example: job.sh run --type test -- bun test"); return 2; }
  const opts = argv.slice(0, dd); const cmd = argv.slice(dd + 1);
  const get = (name: string) => { const i = opts.indexOf(name); return i >= 0 ? opts[i + 1] : undefined; };
  const type = jobTypeOf(get("--type"));
  const session = get("--session") ?? process.env.MAIPAI_SESSION ?? process.env.CLAUDE_SESSION_ID ?? basename(process.cwd());
  const worktree = process.cwd();
  const command = cmd.join(" ");
  let timeoutS = get("--timeout") ? parseDuration(get("--timeout")!) : DEFAULT_TIMEOUT_S[type];
  let lifetimeS = 0;
  if (type === "server") {
    if (!get("--lifetime")) { console.error("job.sh run: a server must say how long it may live. Add --lifetime 8h (or 30m, 2d); nothing runs forever by accident."); return 2; }
    lifetimeS = parseDuration(get("--lifetime")!); timeoutS = 0;
  }
  const id = `${Date.now().toString(36)}-${process.pid}`;
  ensureDirs(jobsDir());
  const log = join(jobsDir(), `${id}.log`);
  const base = { session, command, worktree, job: id };

  // Launch gate: wait (bounded) while saturated or short of memory.
  const cap = num(process.env.MAIPAI_JOBS_MAX_CONCURRENT, Math.max(2, Math.floor(cpus().length / 3)));
  const waitMaxS = num(process.env.MAIPAI_JOBS_WAIT_S, 1800);
  let waited = 0, lastWhy = "";
  for (;;) {
    const running = readJobs().filter((j) => (j.state === "running" || j.state === "paused") && alive(j.pid));
    const progressing = running.filter((j) => j.state === "running" && ((j.cpu ?? 0) > 1 || Date.now() / 1000 - (statMtime(j.log) ?? 0) < 120)).length;
    const d = decideLaunch({ loadPerCore: loadavg()[0]! / cpus().length, running: running.length, progressing, pressure: readPressure(repoRoot), freeDiskGb: freeDiskGb(worktree), cap, minDiskGb: num(process.env.MAIPAI_JOBS_MIN_DISK_GB, 5) });
    if (d.go) break;
    if (d.why !== lastWhy) { console.error(`job.sh: waiting to start: ${d.why}`); audit({ ...base, trigger: d.why, action: "launch-deferred" }); lastWhy = d.why; }
    if (waited >= waitMaxS) { console.error("job.sh: UNFINISHED: never started (the machine stayed saturated). This is not a pass."); audit({ ...base, trigger: "wait limit", action: "launch-gave-up" }); return 75; }
    await sleep(Math.min(TICK_MS * 2, 5000)); waited += Math.min(TICK_MS * 2, 5000) / 1000;
  }

  const out = createWriteStream(log);
  const child = spawn(cmd[0]!, cmd.slice(1), { detached: true, stdio: ["inherit", "pipe", "pipe"], env: { ...process.env, MAIPAI_JOB_ID: id } });
  child.stdout!.on("data", (b: Buffer) => { out.write(b); process.stdout.write(b); });
  child.stderr!.on("data", (b: Buffer) => { out.write(b); process.stderr.write(b); });
  const pgid = child.pid!;
  const rec: JobRecord = { id, type, session, worktree, command, pid: child.pid!, pgid, startedAt: Math.floor(Date.now() / 1000), state: "running", log, ...(lifetimeS ? { until: Math.floor(Date.now() / 1000) + lifetimeS } : {}) };
  writeJob(rec); audit({ ...base, trigger: "start", action: "launched" });
  let exitCode: number | null = null; let signalled = false;
  child.on("exit", (code, sig) => { exitCode = code ?? (sig ? 128 + 15 : 1); });
  child.on("error", (e) => { console.error(`job.sh: could not start "${cmd[0]}": ${e.message}`); exitCode = 127; });
  const onSignal = (sig: NodeJS.Signals) => () => { signalled = true; audit({ ...base, trigger: `launcher got ${sig}`, action: "group-stopped" }); void stopGroup(pgid); };
  for (const s of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(s, onSignal(s));

  const maxRssMb = num(get("--max-rss-mb"), num(process.env.MAIPAI_JOBS_MAX_RSS_MB, 24_000));
  const startRss = { v: -1 }; let verdict: "ok" | "unfinished" | "stopped" = "ok"; let verdictWhy = "";
  let lastChurn = 0, pausedSince = 0;
  const t0 = Date.now();
  while (exitCode === null) {
    await sleep(TICK_MS);
    const procs = groupProcs(pgid); const rssMb = procs.reduce((a, p) => a + p.rssMb, 0);
    if (startRss.v < 0) startRss.v = rssMb;
    writeJob({ ...rec, state: pausedSince ? "paused" : "running", rssMb, cpu: procs.reduce((a, p) => a + p.cpu, 0) });
    const elapsed = (Date.now() - t0) / 1000;
    // Lifetime or timeout.
    if (rec.until && Date.now() / 1000 > rec.until) { verdict = "stopped"; verdictWhy = "server lifetime ended"; capture(rec, verdictWhy); audit({ ...base, trigger: verdictWhy, action: "group-stopped" }); await stopGroup(pgid); break; }
    if (timeoutS && elapsed > timeoutS && !pausedSince) {
      verdict = "unfinished"; verdictWhy = `${type} job passed its ${timeoutS}s limit`;
      const f = capture(rec, verdictWhy); audit({ ...base, trigger: verdictWhy, action: "captured-and-stopped", detail: f }); await stopGroup(pgid); break;
    }
    // Memory: pause first, capture, stop only the responsible job.
    const p = readPressure(repoRoot); const on = p.devShed || p.level >= 2;
    const biggest = Math.max(rssMb, ...readJobs().filter((j) => j.id !== id && alive(j.pid)).map((j) => j.rssMb ?? 0));
    const act = memoryAction({ rssMb, growthMb: rssMb - startRss.v }, biggest, on, maxRssMb);
    if (act === "stop") { verdict = "stopped"; verdictWhy = on ? `memory pressure and this job is the largest and still growing (${rssMb.toFixed(0)} MB)` : `over its ${maxRssMb} MB limit`; capture(rec, verdictWhy); audit({ ...base, trigger: verdictWhy, action: "captured-and-stopped" }); await stopGroup(pgid); break; }
    if (act === "pause" && !pausedSince) { pausedSince = Date.now(); killGroup(pgid, "SIGSTOP"); capture(rec, "memory pressure: paused"); audit({ ...base, trigger: `memory pressure level ${p.level}${p.devShed ? " (host guard shed)" : ""}`, action: "paused" }); }
    if (pausedSince && !on) { killGroup(pgid, "SIGCONT"); audit({ ...base, trigger: "pressure cleared", action: "resumed", detail: `${Math.round((Date.now() - pausedSince) / 1000)}s` }); pausedSince = 0; }
    if (pausedSince && Date.now() - pausedSince > num(process.env.MAIPAI_JOBS_PAUSE_MAX_S, 900) * 1000) { verdict = "unfinished"; verdictWhy = "paused too long under memory pressure"; capture(rec, verdictWhy); audit({ ...base, trigger: verdictWhy, action: "captured-and-stopped" }); await stopGroup(pgid); break; }
    // Disk and churn: warn into the audit; never kills.
    if (Date.now() - lastChurn > 30_000) {
      lastChurn = Date.now();
      const free = freeDiskGb(worktree); if (free < num(process.env.MAIPAI_JOBS_MIN_DISK_GB, 5)) audit({ ...base, trigger: `${free.toFixed(1)} GB free`, action: "disk-low-warning" });
      const churn = churnCount(worktree, rec.startedAt); if (churn > num(process.env.MAIPAI_JOBS_CHURN_FILES, 20000)) audit({ ...base, trigger: `${churn} files changed under the worktree`, action: "churn-warning" });
    }
  }
  void signalled;
  // Whatever ended the main command, no worker outlives it.
  const left = groupProcs(pgid).length;
  if (left) { audit({ ...base, trigger: "command ended", action: "workers-cleaned", detail: `${left} process(es)` }); await stopGroup(pgid); }
  out.end();
  const code = verdict === "ok" ? (exitCode ?? 1) : verdict === "unfinished" ? 124 : 143;
  writeJob({ ...rec, state: verdict === "ok" ? (code === 0 ? "done" : "failed") : verdict, exitCode: code, endedAt: Math.floor(Date.now() / 1000) });
  audit({ ...base, trigger: verdictWhy || `exit ${code}`, action: "finished" });
  if (verdict === "unfinished") console.error(`job.sh: UNFINISHED: ${verdictWhy}. Output and process tree saved in ${join(jobsDir(), `${id}.capture.txt`)}. This is not a pass.`);
  if (verdict === "stopped") console.error(`job.sh: STOPPED: ${verdictWhy}. Saved in ${join(jobsDir(), `${id}.capture.txt`)}. This is not a pass.`);
  return code;
}
function statMtime(f: string): number | null { try { return statSync(f).mtimeMs / 1000; } catch { return null; } }

/** Dev servers whose working folder is gone. Listing is always safe; --stop acts only on servers this launcher recorded (pid and command still match). */
function orphans(stop: boolean): number {
  const found: Array<{ pid: number; why: string; recorded?: JobRecord }> = [];
  const recorded = readJobs().filter((j) => j.type === "server" && alive(j.pid) && !existsSync(j.worktree));
  for (const j of recorded) found.push({ pid: j.pid, why: `recorded server, worktree gone: ${j.worktree}`, recorded: j });
  const ps = spawnSync("/bin/ps", ["-axo", "pid=,command="], { encoding: "utf-8" }).stdout ?? "";
  for (const line of ps.split("\n")) {
    const m = /^\s*(\d+)\s+(.*(?:bun|vite|node)\b.*(?:dev|vite|server).*)$/.exec(line);
    if (!m || found.some((f) => f.pid === Number(m[1]))) continue;
    const cwd = spawnSync("/usr/sbin/lsof", ["-a", "-d", "cwd", "-p", m[1]!, "-Fn"], { encoding: "utf-8" }).stdout?.split("\n").find((l) => l.startsWith("n"))?.slice(1);
    if (cwd && /\/(\.claude\/worktrees|wt)\//.test(cwd) && !existsSync(cwd)) found.push({ pid: Number(m[1]), why: `unrecorded dev server, folder gone: ${cwd}` });
  }
  if (!found.length) { console.log("no orphan dev servers"); return 0; }
  for (const f of found) {
    console.log(`${f.pid}  ${f.why}${f.recorded ? "" : "  (not started by job.sh: listed only)"}`);
    if (stop && f.recorded) {
      const cmdNow = spawnSync("/bin/ps", ["-o", "command=", "-p", String(f.pid)], { encoding: "utf-8" }).stdout.trim();
      if (cmdNow && f.recorded.command.split(" ")[0] && cmdNow.includes(basename(f.recorded.command.split(" ")[0]!))) {
        killGroup(f.recorded.pgid, "SIGTERM");
        audit({ session: f.recorded.session, command: f.recorded.command, worktree: f.recorded.worktree, trigger: "worktree gone", action: "orphan-stopped", job: f.recorded.id });
        console.log(`  stopped (recorded pid ${f.pid}, worktree gone)`);
      }
    }
  }
  return 0;
}

const [sub, ...rest] = process.argv.slice(2);
if (sub === "run") process.exit(await run(rest));
else if (sub === "list") { for (const j of readJobs().sort((a, b) => a.startedAt - b.startedAt)) console.log(`${j.id}  ${j.state.padEnd(10)} ${j.type.padEnd(6)} ${j.session}  ${j.command}${j.until ? `  until ${new Date(j.until * 1000).toISOString()}` : ""}`); }
else if (sub === "audit") { for (const a of readAudit().slice(-(Number(rest[0]) || 30))) console.log(JSON.stringify(a)); }
else if (sub === "orphans") process.exit(orphans(rest.includes("--stop")));
else { console.error("usage: job.sh run [--type test|build|server|other] [--timeout D] [--lifetime D] [--session S] [--max-rss-mb N] -- <command...>\n       job.sh list | audit [n] | orphans [--stop]"); process.exit(2); }
