#!/usr/bin/env bun
// HOST-LAUNCH-01: the dev job launcher and watchdog. Every dev test, build and temporary server runs through it (bash scripts/jobs/job.sh).
//
//   job.sh run [--type test|build|server|other] [--timeout 15m] [--lifetime 8h] [--session name] [--max-rss-mb N] [--no-wait] -- <command...>
//   job.sh list | audit [n] | orphans [--stop] | reap [--dry-run]
//
// DEV-CHECKOUT-01: everything the launcher runs first takes the one dev checkout from the lease broker (lease.ts), waits in its FIFO queue
// when another session holds it, and returns it when the job ends, the launcher dies, or it shows no activity for 10 minutes.
// (The watcher and lander sessions are exempt, MAIPAI_CHECKOUT_EXEMPT.) `reap` is the orphan reaper.
//
// What it does: runs the command as its own process group (so every worker it spawns is cleaned up when it ends or is stopped);
// waits at launch while the machine is saturated or short of memory (progress-aware, see lib.ts decideLaunch); enforces a timeout per
// job type and on timeout captures the output tail and the process tree and reports UNFINISHED (exit 124, never a pass); on memory
// pressure pauses the group, captures, and stops only the job that is the largest and still growing (by its recorded pid); watches
// free disk and file churn; writes one audit line per action. A server must say how long it may live (--lifetime). Runs as the user.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { basename, join, resolve } from "node:path";
import { acquire, beat, release } from "./lease";
import { DEFAULT_TIMEOUT_S, alive, audit, decideLaunch, ensureDirs, jobTypeOf, jobsDir, memoryAction, orphanVerdict, parseDuration, readAudit, readJobs, readPressure, stateDir, writeJob, type JobRecord } from "./lib";

const repoRoot = resolve(import.meta.dir, "..", "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: string | undefined, d: number) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
const TICK_MS = num(process.env.MAIPAI_JOBS_TICK_MS, 2000);

/**
 * pids of one job with their RSS in MB, from ps (the launcher's own view, no root needed): its process group plus every descendant of
 * it, even one that left the group (DEV-BUDGET-02, 2026-11-12: an engine a dev hub started in its own group held 24 GB and escaped the
 * 2 GB hub cap, because only the group was counted). A process that has been re-parented to launchd is out of reach.
 */
export function groupProcs(pgid: number): Array<{ pid: number; rssMb: number; cpu: number; line: string; outside: boolean }> {
  const out = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,rss=,pcpu=,etime=,command="], { encoding: "utf-8" }).stdout ?? "";
  const all: Array<{ pid: number; ppid: number; pg: number; rssMb: number; cpu: number; line: string }> = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) all.push({ pid: Number(m[1]), ppid: Number(m[2]), pg: Number(m[3]), rssMb: Number(m[4]) / 1024, cpu: Number(m[5]), line: line.trim() });
  }
  const members = new Set(all.filter((p) => p.pg === pgid).map((p) => p.pid));
  const inGroup = new Set(members);
  for (let grew = true; grew;) { grew = false; for (const p of all) if (!members.has(p.pid) && members.has(p.ppid) && p.pid !== process.pid) { members.add(p.pid); grew = true; } }
  return all.filter((p) => members.has(p.pid)).map((p) => ({ pid: p.pid, rssMb: p.rssMb, cpu: p.cpu, line: p.line, outside: !inGroup.has(p.pid) }));
}
const killGroup = (pgid: number, sig: NodeJS.Signals) => { try { process.kill(-pgid, sig); } catch { /* already gone */ } };
const killPids = (pids: number[], sig: NodeJS.Signals) => { for (const p of pids) { try { process.kill(p, sig); } catch { /* already gone */ } } };

async function stopGroup(pgid: number): Promise<void> {
  const strays = groupProcs(pgid).filter((p) => p.outside).map((p) => p.pid);
  killGroup(pgid, "SIGCONT"); killPids(strays, "SIGCONT"); killGroup(pgid, "SIGTERM"); killPids(strays, "SIGTERM");
  for (let i = 0; i < 20 && groupProcs(pgid).length; i++) await sleep(250);
  killGroup(pgid, "SIGKILL"); killPids(strays, "SIGKILL");
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
    const d = decideLaunch({ loadPerCore: loadavg()[0]! / cpus().length, running: running.length, progressing, pressure: readPressure(repoRoot), freeDiskGb: freeDiskGb(worktree), cap, minDiskGb: num(process.env.MAIPAI_JOBS_MIN_DISK_GB, 5), type });
    if (d.go) break;
    if (opts.includes("--no-wait")) { console.error(`job.sh: not started: ${d.why}`); audit({ ...base, trigger: d.why, action: "launch-refused" }); return 75; }
    if (d.why !== lastWhy) { console.error(`job.sh: waiting to start: ${d.why}`); audit({ ...base, trigger: d.why, action: "launch-deferred" }); lastWhy = d.why; }
    if (waited >= waitMaxS) { console.error("job.sh: UNFINISHED: never started (the machine stayed saturated). This is not a pass."); audit({ ...base, trigger: "wait limit", action: "launch-gave-up" }); return 75; }
    await sleep(Math.min(TICK_MS * 2, 5000)); waited += Math.min(TICK_MS * 2, 5000) / 1000;
  }

  // DEV-CHECKOUT-01: the one dev checkout. A job started inside a checked-out job (MAIPAI_CHECKOUT_ID) shares its holder's.
  const exempt = (process.env.MAIPAI_CHECKOUT_EXEMPT ?? "home-watcher,home-lander").split(",").includes(session);
  let checkoutId = process.env.MAIPAI_CHECKOUT_ID ?? ""; let tookCheckout = false;
  if (!checkoutId && !exempt && process.env.MAIPAI_JOBS_OFF !== "1" && process.env.MAIPAI_CHECKOUT !== "off") {
    const r = await acquire(["--kind", type, "--what", command.slice(0, 100), "--session", session, "--pid", String(process.pid), "--wait", opts.includes("--no-wait") ? "0" : `${waitMaxS}s`, ...(process.env.MAIPAI_CHECKOUT_OWNER === "1" ? ["--owner"] : [])]);
    if (r.code) { audit({ ...base, trigger: "the dev machine is checked out by another session", action: "launch-refused" }); console.error("job.sh: not started. This is not a pass."); return r.code; }
    checkoutId = r.id; tookCheckout = true;
  }
  const out = createWriteStream(log);
  let child!: ReturnType<typeof spawn>; let pgid = 0; let gen = 0;
  let exitCode: number | null = null; let signalled = false;
  const launch = () => {
    const mine = ++gen; exitCode = null;
    child = spawn(cmd[0]!, cmd.slice(1), { detached: true, stdio: ["inherit", "pipe", "pipe"], env: { ...process.env, MAIPAI_JOB_ID: id, ...(checkoutId ? { MAIPAI_CHECKOUT_ID: checkoutId } : {}) } });
    child.stdout!.on("data", (b: Buffer) => { out.write(b); process.stdout.write(b); });
    child.stderr!.on("data", (b: Buffer) => { out.write(b); process.stderr.write(b); });
    pgid = child.pid ?? 0;
    child.on("exit", (code, sig) => { if (mine === gen) exitCode = code ?? (sig ? 128 + 15 : 1); });
    child.on("error", (e) => { console.error(`job.sh: could not start "${cmd[0]}": ${e.message}`); if (mine === gen) exitCode = 127; });
  };
  launch();
  const rec: JobRecord = { id, type, session, worktree, command, pid: child.pid!, pgid, startedAt: Math.floor(Date.now() / 1000), state: "running", log, ...(lifetimeS ? { until: Math.floor(Date.now() / 1000) + lifetimeS } : {}) };
  writeJob(rec); audit({ ...base, trigger: "start", action: "launched" });
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
    rec.pid = child.pid ?? rec.pid; rec.pgid = pgid;
    writeJob({ ...rec, state: pausedSince ? "paused" : "running", rssMb, cpu: procs.reduce((a, p) => a + p.cpu, 0) });
    if (tookCheckout && procs.reduce((a, p) => a + p.cpu, 0) >= 1) beat(checkoutId); // activity: the 10 minute return clock restarts
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
  // Whatever ended the main command, no worker outlives it.
  const left = groupProcs(pgid).length;
  if (left) { audit({ ...base, trigger: "command ended", action: "workers-cleaned", detail: `${left} process(es)` }); await stopGroup(pgid); }
  out.end();
  if (tookCheckout) release(checkoutId); // returned the moment the job ends
  const code = verdict === "ok" ? (exitCode ?? 1) : verdict === "unfinished" ? 124 : 143;
  writeJob({ ...rec, state: verdict === "ok" ? (signalled ? "stopped" : code === 0 ? "done" : "failed") : verdict, exitCode: code, endedAt: Math.floor(Date.now() / 1000) });
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

/** The pid a dev pid file holds, or null when the file is missing or empty. */
function pidIn(file: string): number | null { try { const v = Number(readFileSync(file, "utf-8").trim()); return Number.isInteger(v) && v > 1 ? v : null; } catch { return null; } }

/**
 * DEV-REAPER-01: stops a `bun run --hot` dev hub only when it is provably dead: its worktree's pid files do not name it (or the launcher that
 * started it), the hub's watcher is gone, and that has held for MAIPAI_DEV_REAP_GRACE_MIN (60) minutes in a row. Only worktrees under
 * .claude/worktrees or wt/ with a data/dev folder qualify, so the live hub and the main checkout are never touched. One audit line per stop,
 * and dev-reaper.json (read by the admin Status row) says what was tidied.
 */
export function reap(dryRun: boolean, now = Math.floor(Date.now() / 1000)): number {
  const graceS = num(process.env.MAIPAI_DEV_REAP_GRACE_MIN, 60) * 60;
  const seenDir = join(stateDir(), "orphans-seen"); mkdirSync(seenDir, { recursive: true, mode: 0o700 });
  const ps = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf-8" }).stdout ?? "";
  const rows = ps.split("\n").flatMap((l) => { const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l); return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3]! }] : []; });
  const hubs = rows.filter((r) => /(^|\/)bun\s+(run\s+)?--hot\b/.test(r.command) || /(^|\/)bun\s+run\s+--hot\b/.test(r.command));
  const stopped: Array<{ ts: number; worktree: string }> = []; let waiting = 0; const keep = new Set<string>();
  for (const h of hubs) {
    const cwd = spawnSync("/usr/sbin/lsof", ["-a", "-d", "cwd", "-p", String(h.pid), "-Fn"], { encoding: "utf-8" }).stdout?.split("\n").find((l) => l.startsWith("n"))?.slice(1);
    if (!cwd || !/\/(\.claude\/worktrees|wt)\//.test(cwd)) continue;
    if (process.env.MAIPAI_DEV_REAP_ONLY_UNDER && !cwd.startsWith(process.env.MAIPAI_DEV_REAP_ONLY_UNDER)) continue; // test seam: never touch real hubs
    const root = /\/(backend|frontend)$/.test(cwd) ? resolve(cwd, "..") : cwd;
    const dirs = [join(root, "data", "dev"), join(root, "data", "dev", "workbench")].filter((d) => existsSync(d));
    if (!dirs.length) continue;
    const seenFile = join(seenDir, `${h.pid}.json`); keep.add(`${h.pid}.json`);
    let prior: { since: number; command: string } | null = null; try { prior = JSON.parse(readFileSync(seenFile, "utf-8")); } catch { /* first look */ }
    if (prior && prior.command !== h.command) prior = null; // a reused pid is a different process
    const verdicts = dirs.map((d) => orphanVerdict({ pid: h.pid, ppid: h.ppid, pidFiles: { backend: pidIn(join(d, "backend.pid")), vite: pidIn(join(d, "vite.pid")), watch: pidIn(join(d, "watch.pid")) }, isAlive: alive, orphanSince: prior?.since ?? null, now, graceS }));
    if (verdicts.some((v) => v.state === "owned")) { rmSync(seenFile, { force: true }); continue; }
    const v = verdicts[0]!;
    if (v.state === "orphan-waiting") { waiting++; if (!dryRun) writeFileSync(seenFile, JSON.stringify({ since: v.since, command: h.command })); console.log(`${h.pid}  no owner since ${new Date(v.since! * 1000).toISOString()}  (${cwd}); stopped after ${graceS / 60} minutes`); continue; }
    console.log(`${h.pid}  no owner for ${graceS / 60}+ minutes  (${cwd})${dryRun ? "  [dry run: not stopped]" : ""}`);
    if (dryRun) continue;
    const kids = new Set<number>([h.pid]); for (let grew = true; grew;) { grew = false; for (const r of rows) if (kids.has(r.ppid) && !kids.has(r.pid)) { kids.add(r.pid); grew = true; } }
    for (const pid of kids) { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
    audit({ session: "dev-reaper", command: h.command, worktree: root, trigger: `no pid file, no watcher, for ${graceS / 60} minutes`, action: "orphan-stopped", detail: `pid ${h.pid}` });
    rmSync(seenFile, { force: true }); stopped.push({ ts: now, worktree: root });
  }
  if (!dryRun) {
    for (const f of readdirSyncSafe(seenDir)) if (!keep.has(f)) rmSync(join(seenDir, f), { force: true });
    const reportFile = join(stateDir(), "dev-reaper.json");
    let old: Array<{ ts: number; worktree: string }> = []; try { old = JSON.parse(readFileSync(reportFile, "utf-8")).stopped ?? []; } catch { /* none yet */ }
    const all = [...old, ...stopped].filter((x) => now - x.ts < 86400).slice(-20);
    writeFileSync(`${reportFile}.tmp`, JSON.stringify({ version: 1, ts: now, waiting, stopped: all })); renameSync(`${reportFile}.tmp`, reportFile);
  }
  if (!hubs.length) console.log("no development hubs running");
  return 0;
}
const readdirSyncSafe = (d: string): string[] => { try { return readdirSync(d); } catch { return []; } };

if (import.meta.main) {
const [sub, ...rest] = process.argv.slice(2);
if (sub === "run") process.exit(await run(rest));
else if (sub === "list") { for (const j of readJobs().sort((a, b) => a.startedAt - b.startedAt)) console.log(`${j.id}  ${j.state.padEnd(10)} ${j.type.padEnd(6)} ${j.session}  ${j.command}${j.until ? `  until ${new Date(j.until * 1000).toISOString()}` : ""}`); }
else if (sub === "audit") { for (const a of readAudit().slice(-(Number(rest[0]) || 30))) console.log(JSON.stringify(a)); }
else if (sub === "orphans") process.exit(orphans(rest.includes("--stop")));
else if (sub === "reap") process.exit(reap(rest.includes("--dry-run")));
else { console.error("usage: job.sh run [--type test|build|server|other] [--timeout D] [--lifetime D] [--session S] [--max-rss-mb N] -- <command...>\n       job.sh list | audit [n] | orphans [--stop] | reap [--dry-run]"); process.exit(2); }
}
