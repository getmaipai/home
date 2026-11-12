#!/usr/bin/env bun
// HOST-LAUNCH-02: the lease broker for heavy development work (video, images, big test runs).
//
//   lease.sh acquire --class dev|family --kind video|image|test|other [--what "text"] [--session S] [--whole-machine] [--ttl 4h] [--wait 30m] [--pid N]
//   lease.sh run     --class dev --kind video [--whole-machine] [--timeout 4h] -- <command...>     (acquire, run through job.sh, release)
//   lease.sh release <id> | check <id> | beat <id> | status | mode
//   A held dev lease with no sign of life for 10 minutes (MAIPAI_LEASE_IDLE_MIN) is released and the next waiter gets it. `beat` is a sign of life; under `run` the
//   work using CPU is one. A holder whose process is gone is released too.
//
// Two classes. `family` is an end-user request: it is never made to wait behind development work. `dev` is a session doing heavy
// development: dev sessions queue among themselves, first come first served; chat-first never applies between two dev sessions.
// The mode decides what a dev lease may do. DIRECT (changes run first, checked after; nobody is on the hub): a dev lease may take the
// whole machine; while it does, a flag file makes chat say "Chat is unavailable while the system upgrades." through the existing chat
// health row (backend/src/lib/maintenanceFlag.ts) and family requests are held off. GATED (the family is on the hub): dev work yields:
// a dev lease waits while any family lease is held or queued, a whole-machine lease is refused, and a held dev lease is told to yield
// (`check` exits 10) the moment a family request arrives. A lease dies when its holder process is gone or its time is up.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { alive, audit, devLeaseFile, ensureDirs, leaseIdleS, parseDuration, readJobs, reserveReleasedFile, stateDir, treeActive, writeDevLoad } from "./lib";

const repoRoot = resolve(import.meta.dir, "..", "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export type Mode = "direct" | "gated";
export type Lease = { id: string; cls: "dev" | "family"; kind: string; session: string; pid: number; whole: boolean; since: number; until: number; seq: number; yieldRequested?: boolean;
  /** DEV-BUDGET-02: epoch seconds of the last sign of life (`lease.sh beat`, or the work under `lease.sh run` using CPU); a lease idle past leaseIdleS() is released. */
  beat?: number;
  /** What the lease is for, in words (shown on the admin Status row and in `lease.sh status`). */
  what?: string };
export type Decision = { verdict: "grant" | "wait" | "deny"; why: string };

/** Pure: may this request be granted now, given who holds and who queues ahead of it? */
export function decide(req: Lease, held: Lease[], queue: Lease[], mode: Mode, slots: number): Decision {
  const heldWhole = held.find((l) => l.cls === "dev" && l.whole);
  if (req.cls === "family") {
    if (heldWhole && mode === "direct") return { verdict: "deny", why: `a development job holds the whole machine (${heldWhole.session}, ${heldWhole.kind}); chat says the system is upgrading` };
    return { verdict: "grant", why: "" };
  }
  if (req.whole && mode === "gated") return { verdict: "deny", why: "gated mode: the family is on the hub, so development work cannot take the whole machine. Switch to direct mode first." };
  const family = held.filter((l) => l.cls === "family").length + queue.filter((l) => l.cls === "family").length;
  if (mode === "gated" && family > 0) return { verdict: "wait", why: "gated mode: development work waits for family requests" };
  const ahead = queue.filter((l) => l.cls === "dev" && l.seq < req.seq);
  if (ahead.length) return { verdict: "wait", why: `${ahead.length} development job(s) queued ahead (first come, first served)` };
  const dev = held.filter((l) => l.cls === "dev");
  if (req.whole ? dev.length > 0 : heldWhole !== undefined || dev.length >= slots) return { verdict: "wait", why: dev.length ? `held by ${dev.map((l) => `${l.session} (${l.kind})`).join(", ")}` : "waiting" };
  return { verdict: "grant", why: "" };
}

export function leaseMode(): Mode {
  const env = process.env.MAIPAI_DEV_MODE; if (env === "direct" || env === "gated") return env;
  const script = join(repoRoot, "scripts", "mode.sh");
  if (existsSync(script)) {
    const out = spawnSync("bash", [script, "status"], { encoding: "utf-8", timeout: 10_000 }).stdout ?? "";
    if (/\bDIRECT\b/.test(out)) return "direct"; if (/\bGATED\b/.test(out)) return "gated";
  }
  try { const f = readFileSync(join(stateDir(), "mode"), "utf-8").trim(); if (f === "direct" || f === "gated") return f; } catch { /* no setting */ }
  return "gated"; // the safe reading: the family may be on the hub
}

const dirOf = (n: string) => join(stateDir(), "leases", n);
const liveData = (): string => join(process.env.MAIPAI_LIVE_INSTALL_ROOT ?? "/usr/local/maipai-home", "data");
/** The hub's maintenance flag. Same rule as backend/src/lib/maintenanceFlag.ts and the installer: MAIPAI_MAINTENANCE_FLAG, else $MAIPAI_DATA_DIR/local-app, else the live install's data/local-app. */
export const maintenanceFlag = (): string => process.env.MAIPAI_MAINTENANCE_FLAG ?? join(process.env.MAIPAI_DATA_DIR ?? liveData(), "local-app", "maintenance.json");
/** Where the hub says a family turn is running (backend/src/lib/familyActivity.ts writes it, as root or as the user). */
export const familyActivityFiles = (): string[] => process.env.MAIPAI_FAMILY_ACTIVITY ? [process.env.MAIPAI_FAMILY_ACTIVITY] : [...new Set([join(process.env.MAIPAI_DATA_DIR ?? liveData(), "local-app", "family-active.json"), join(liveData(), "local-app", "family-active.json")])];
/** The hub's running family turns, as one synthetic family lease while any claim is fresh. It is never stored, so it cannot go stale. */
function hubFamily(): Lease[] {
  const now = Date.now() / 1000;
  for (const f of familyActivityFiles()) {
    try { const c = JSON.parse(readFileSync(f, "utf-8")) as { active?: number; until?: number }; if ((c.active ?? 0) > 0 && (c.until ?? 0) > now) return [{ id: "hub-family", cls: "family", kind: "chat", session: "hub", pid: process.pid, whole: false, since: now, until: c.until!, seq: 0 }]; } catch { /* no claim */ }
  }
  return [];
}

function withLock<T>(fn: () => T): T {
  const lock = dirOf(".lock"); ensureDirs(dirOf("held"), dirOf("queue"));
  for (let i = 0; ; i++) {
    try { mkdirSync(lock); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 30_000) rmSync(lock, { recursive: true }); } catch { /* raced */ }
      if (i > 400) throw new Error("lease broker lock stuck");
      Bun.sleepSync(25);
    }
  }
  try { return fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
}
const readAll = (n: string): Lease[] => { try { return readdirSync(dirOf(n)).filter((f) => f.endsWith(".json")).flatMap((f) => { try { return [JSON.parse(readFileSync(join(dirOf(n), f), "utf-8")) as Lease]; } catch { return []; } }); } catch { return []; } };
const put = (n: string, l: Lease) => { const f = join(dirOf(n), `${l.id}.json`); writeFileSync(`${f}.tmp`, JSON.stringify(l)); renameSync(`${f}.tmp`, f); };
const drop = (n: string, id: string) => rmSync(join(dirOf(n), `${id}.json`), { force: true });
const au = (l: Lease, action: string, trigger: string) => audit({ session: l.session, command: `lease ${l.cls}/${l.kind}${l.whole ? "/whole-machine" : ""}`, worktree: process.cwd(), trigger, action, job: l.id });

/** DEV-BUDGET-03: a worktree someone edited in the last 10 minutes is in use (a session is working in it), so its hub is never stopped for a heavy lease. */
export function recentlyEdited(root: string): boolean {
  const dirs = ["backend/src", "frontend/src", "scripts", "docs"].map((d) => join(root, d)).filter((d) => existsSync(d));
  if (!dirs.length) return false;
  const out = spawnSync("/usr/bin/find", [...dirs, "-type", "f", "-mmin", `-${Number(process.env.MAIPAI_DEV_IN_USE_MIN) || 10}`, "-not", "-path", "*/node_modules/*"], { encoding: "utf-8", timeout: 10_000, maxBuffer: 4e6 }).stdout ?? "";
  return out.trim().length > 0;
}
/** A dev hub with no browser connected: its Vite port (backend port + 1000, from its port file) has no established connection. */
function idleHubRoots(): string[] {
  const roots = new Set<string>();
  for (const j of readJobs()) {
    if (j.type !== "server" || j.state !== "running" || !alive(j.pid) || !j.command.includes("src/index.ts")) continue;
    const root = resolve(j.worktree, "..");
    for (const d of [join(root, "data", "dev"), join(root, "data", "dev", "workbench")]) {
      try {
        const port = Number(readFileSync(join(d, "port"), "utf-8").trim()) + 1000;
        const out = spawnSync("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:ESTABLISHED"], { encoding: "utf-8" }).stdout ?? "";
        if (!out.trim() && existsSync(join(root, "scripts", "dev.sh")) && !recentlyEdited(root)) roots.add(root);
      } catch { /* not a dev.sh hub */ }
    }
  }
  return [...roots];
}
/**
 * DIRECT mode only: while a heavy development lease (video, images or the whole machine) is held, the dev reserve the Stack keeps back is
 * given up (dev-load.json says reserve_gb 0), after hubs nobody is looking at are stopped cold (they restart on the next dev.sh start; a
 * hub with a browser connected is left running). The reserve comes back when the lease ends. In GATED mode nothing is released: the family floor wins.
 */
function syncReserve(mode: Mode): void {
  const heavy = mode === "direct" && readAll("held").some((l) => l.cls === "dev" && (l.whole || l.kind === "video" || l.kind === "image"));
  const was = existsSync(reserveReleasedFile());
  if (heavy && !was) {
    for (const root of idleHubRoots()) spawnSync("bash", [join(root, "scripts", "dev.sh"), "stop"], { env: { ...process.env, MAIPAI_DEV_ROOT: root }, timeout: 60_000 });
    writeFileSync(reserveReleasedFile(), JSON.stringify({ ts: Date.now() }));
    audit({ session: "lease-broker", command: "dev reserve", worktree: process.cwd(), trigger: "heavy development lease in direct mode", action: "reserve-released" });
  } else if (!heavy && was) {
    rmSync(reserveReleasedFile(), { force: true });
    audit({ session: "lease-broker", command: "dev reserve", worktree: process.cwd(), trigger: "heavy development lease ended or mode is gated", action: "reserve-restored" });
  } else return;
  writeDevLoad(readJobs());
}

/** The Status row's source (backend/src/lib/hostGuard.ts reads it): who holds development work on the machine, since when and for what. */
function writeDevLease(): void {
  const held = readAll("held").filter((l) => l.cls === "dev").map((l) => ({ session: l.session, kind: l.kind, whole: l.whole, since: l.since, beat: l.beat ?? l.since, ...(l.what ? { what: l.what } : {}) }));
  const file = devLeaseFile(); ensureDirs(stateDir());
  writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, ts: Math.floor(Date.now() / 1000), idle_s: leaseIdleS(), held, waiting: readAll("queue").filter((l) => l.cls === "dev").length }));
  renameSync(`${file}.tmp`, file);
}
function syncFlag(mode: Mode = leaseMode()): void {
  syncReserve(mode);
  writeDevLease();
  const f = maintenanceFlag();
  const whole = readAll("held").filter((l) => l.cls === "dev" && l.whole);
  try {
    if (whole.length) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify({ until: Math.max(...whole.map((l) => l.until)), lease: whole[0]!.id })); }
    else rmSync(f, { force: true });
  } catch (e) { if (whole.length) audit({ session: whole[0]!.session, command: "lease flag", worktree: process.cwd(), trigger: `cannot write ${f}: ${(e as Error).message}`, action: "flag-not-written", job: whole[0]!.id }); }
}
/** Reap holders and tickets whose process is gone or whose time is up; tell dev holders to yield when a family request is in. */
function reap(mode: Mode): void {
  const now = Date.now() / 1000;
  for (const n of ["held", "queue"]) for (const l of readAll(n)) if (!alive(l.pid) || l.until < now) { drop(n, l.id); au(l, "lease-reaped", !alive(l.pid) ? "holder gone" : "time up"); }
  // DEV-BUDGET-02: a held development lease that shows no sign of life for the idle time is released and the next waiter gets it (nobody kills anything by hand).
  for (const l of readAll("held")) if (l.cls === "dev" && now - (l.beat ?? l.since) > leaseIdleS()) { drop("held", l.id); au(l, "lease-reaped", `idle for ${Math.round((now - (l.beat ?? l.since)) / 60)} minutes with no activity`); }
  if (mode === "gated" && (readAll("held").some((l) => l.cls === "family") || hubFamily().length)) for (const l of readAll("held")) if (l.cls === "dev" && !l.yieldRequested) { put("held", { ...l, yieldRequested: true }); au(l, "yield-requested", "family request arrived"); }
  syncFlag(mode);
}
const slotsNow = () => Number(process.env.MAIPAI_DEV_LEASE_SLOTS) || 1;

/** One attempt: returns the decision, and on grant moves the ticket to held. */
function attempt(req: Lease, mode: Mode): Decision {
  return withLock(() => {
    reap(mode);
    if (!readAll("queue").some((l) => l.id === req.id) && !readAll("held").some((l) => l.id === req.id)) put("queue", req);
    const queue = readAll("queue").filter((l) => l.id !== req.id);
    const d = decide(req, [...readAll("held"), ...hubFamily()], queue, mode, slotsNow());
    if (d.verdict === "grant") { drop("queue", req.id); put("held", req); au(req, "lease-granted", `mode ${mode}`); if (req.cls === "family" && mode === "gated") reap(mode); syncFlag(mode); }
    else if (d.verdict === "deny") { drop("queue", req.id); au(req, "lease-denied", d.why); }
    return d;
  });
}
/** A sign of life from the holder: pushes the idle release back. */
function beat(id: string): boolean {
  return withLock(() => { const l = readAll("held").find((x) => x.id === id); if (!l) return false; put("held", { ...l, beat: Date.now() / 1000 }); writeDevLease(); return true; });
}
function release(id: string): boolean {
  return withLock(() => { const l = readAll("held").find((x) => x.id === id) ?? readAll("queue").find((x) => x.id === id); if (!l) return false; drop("held", id); drop("queue", id); au(l, "lease-released", "holder done"); syncFlag(); return true; });
}

async function acquire(a: string[]): Promise<{ id: string; code: number }> {
  const get = (n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const cls = get("--class") === "family" ? "family" : "dev";
  const mode = leaseMode();
  const now = Date.now() / 1000;
  const req: Lease = { id: `${Date.now().toString(36)}-${process.pid}-${Math.floor(Math.random() * 1e4)}`, cls, kind: get("--kind") ?? "other", session: get("--session") ?? process.env.MAIPAI_SESSION ?? process.env.CLAUDE_SESSION_ID ?? "unknown", pid: Number(get("--pid")) || process.ppid, whole: a.includes("--whole-machine"), since: now, beat: now, ...(get("--what") ? { what: get("--what")!.slice(0, 120) } : {}), until: now + parseDuration(get("--ttl") ?? "4h"), seq: Date.now() * 1000 + (process.pid % 1000) };
  const deadline = Date.now() + parseDuration(get("--wait") ?? "30m") * 1000;
  let last = "";
  for (;;) {
    const d = attempt(req, mode);
    if (d.verdict === "grant") return { id: req.id, code: 0 };
    if (d.verdict === "deny") { console.error(`lease: refused: ${d.why}`); return { id: "", code: 3 }; }
    if (d.why !== last) { console.error(`lease: waiting: ${d.why}`); last = d.why; }
    if (Date.now() > deadline) { release(req.id); console.error("lease: gave up waiting. Nothing was started."); return { id: "", code: 75 }; }
    await sleep(Number(process.env.MAIPAI_LEASE_POLL_MS) || 1000);
  }
}

if (import.meta.main) {
  const [sub, ...rest] = process.argv.slice(2);
  if (sub === "acquire") { const r = await acquire(rest); if (r.id) console.log(r.id); process.exit(r.code); }
  else if (sub === "release") { process.exit(release(rest[0] ?? "") ? 0 : 1); }
  else if (sub === "check") { const l = withLock(() => { reap(leaseMode()); return readAll("held").find((x) => x.id === rest[0]); }); if (!l) { console.log("gone"); process.exit(1); } console.log(l.yieldRequested ? "yield" : "ok"); process.exit(l.yieldRequested ? 10 : 0); }
  else if (sub === "beat") { const ok = beat(rest[0] ?? ""); console.log(ok ? "ok" : "gone"); process.exit(ok ? 0 : 1); }
  else if (sub === "mode") console.log(leaseMode());
  else if (sub === "status") {
    withLock(() => reap(leaseMode()));
    console.log(`mode: ${leaseMode()}`);
    for (const l of readAll("held")) console.log(`held   ${l.id}  ${l.cls}/${l.kind}${l.whole ? "/whole-machine" : ""}  ${l.session}${l.what ? `  for: ${l.what}` : ""}  since ${new Date(l.since * 1000).toISOString().slice(11, 16)}Z  last sign of life ${Math.round((Date.now() / 1000 - (l.beat ?? l.since)) / 60)} min ago${l.yieldRequested ? "  (asked to yield)" : ""}`);
    for (const l of readAll("queue").sort((x, y) => x.seq - y.seq)) console.log(`queued ${l.id}  ${l.cls}/${l.kind}  ${l.session}`);
  } else if (sub === "run") {
    const dd = rest.indexOf("--"); if (dd < 0) { console.error("lease.sh run: command after --"); process.exit(2); }
    const opts = rest.slice(0, dd); const cmd = rest.slice(dd + 1);
    const r = await acquire([...opts, "--pid", String(process.pid)]); if (r.code) process.exit(r.code);
    const timeout = opts.indexOf("--timeout") >= 0 ? opts[opts.indexOf("--timeout") + 1]! : "4h";
    const child = Bun.spawn(["bun", join(import.meta.dir, "job.ts"), "run", "--type", "other", "--timeout", timeout, "--", ...cmd], { stdio: ["inherit", "inherit", "inherit"] });
    // The work using CPU is a sign of life; a quiet job that is still working calls `lease.sh beat <id>` itself.
    const pulse = setInterval(() => { if (treeActive(child.pid)) beat(r.id); }, Number(process.env.MAIPAI_LEASE_PULSE_MS) || 15_000);
    const code = await child.exited; clearInterval(pulse); release(r.id); process.exit(code);
  } else { console.error("usage: lease.sh acquire|run|release|check|status|mode (see lease.ts)"); process.exit(2); }
}
