#!/usr/bin/env bun
// DEV-CHECKOUT-01 (owner, 2026-11-12): the dev checkout, a library book. ONE book: the dev machine (dev hubs, test runs, builds, engine jobs
// started by dev sessions). One session holds it and has all of it (its own several jobs share it); no budget, no reserve, no per-hub caps. Others queue first come,
// first served, except Jesse's own work (--owner or MAIPAI_CHECKOUT_OWNER=1: his clips, manual tests from the app), which goes first.
//
//   lease.sh run  [--kind K] [--what "text"] [--owner] [--whole-machine] [--timeout 4h] -- <command...>   (take, run through job.sh, return)
//   lease.sh take --manual [--minutes 30] [--what "text"]   a hold while the holder waits for Jesse to test by hand: visible timer, then auto-return
//   lease.sh extend <id> --owner-asked [--minutes 30]       only when Jesse says so in that turn
//   lease.sh acquire|release <id> | check <id> | beat <id> | status | mode      (job.sh takes and returns it for everything it runs)
//
// Return is automatic, never on the honour system: when the holder's job ends (job.sh and `run` release it), when the holder's process is
// gone (its session ended or crashed), or after 10 minutes with no activity (`beat`, or the work using CPU; MAIPAI_LEASE_IDLE_MIN). A
// manual hold ignores idleness and ends at its timer. Nobody kills anybody: a hub whose checkout was returned keeps running.
// Two classes remain. `family` is an end-user request (the hub's running chat turns count as one): in GATED mode (the family is on the hub)
// a family turn in progress has priority: the checkout waits, a held one is told to yield (`check` exits 10). DIRECT mode: dev work runs.
// `--whole-machine` (direct only) also raises the "Chat is unavailable while the system upgrades." flag (backend/src/lib/maintenanceFlag.ts).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { alive, audit, devLeaseFile, ensureDirs, leaseIdleS, parseDuration, stateDir, treeActive } from "./lib";

const repoRoot = resolve(import.meta.dir, "..", "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export type Mode = "direct" | "gated";
export type Lease = { id: string; cls: "dev" | "family"; kind: string; session: string; pid: number; whole: boolean; since: number; until: number; seq: number; yieldRequested?: boolean;
  /** DEV-BUDGET-02: epoch seconds of the last sign of life (`lease.sh beat`, or the work under `lease.sh run` using CPU); a lease idle past leaseIdleS() is released. */
  beat?: number;
  /** Jesse's own work (his clips, manual tests started from the app): queued ahead of sessions. */
  owner?: boolean;
  /** A manual hold: epoch seconds when it returns by itself. Idleness and the holder pid do not apply to it. */
  manualUntil?: number;
  /** What the lease is for, in words (shown on the admin Status row and in `lease.sh status`). */
  what?: string };
export type Decision = { verdict: "grant" | "wait" | "deny"; why: string };

/** Queue order: Jesse's own work first, then first come, first served. */
export const before = (a: Lease, b: Lease): boolean => (a.owner ? 0 : 1) < (b.owner ? 0 : 1) || ((a.owner ? 0 : 1) === (b.owner ? 0 : 1) && a.seq < b.seq);
/** Pure: may this request be granted now, given who holds and who queues ahead of it? There is one book: a dev request waits while any dev lease is held. */
export function decide(req: Lease, held: Lease[], queue: Lease[], mode: Mode, _slots = 1): Decision {
  const heldWhole = held.find((l) => l.cls === "dev" && l.whole);
  if (req.cls === "family") {
    if (heldWhole && mode === "direct") return { verdict: "deny", why: `a development job holds the whole machine (${heldWhole.session}, ${heldWhole.kind}); chat says the system is upgrading` };
    return { verdict: "grant", why: "" };
  }
  if (req.whole && mode === "gated") return { verdict: "deny", why: "gated mode: the family is on the hub, so development work cannot take the whole machine. Switch to direct mode first." };
  const family = held.filter((l) => l.cls === "family").length + queue.filter((l) => l.cls === "family").length;
  if (mode === "gated" && family > 0) return { verdict: "wait", why: "gated mode: a family turn is running, so development work waits" };
  const ahead = queue.filter((l) => l.cls === "dev" && l.session !== req.session && before(l, req));
  if (ahead.length) return { verdict: "wait", why: `${ahead.length} session(s) queued ahead (${ahead.map((l) => l.session).join(", ")})` };
  const dev = held.filter((l) => l.cls === "dev" && l.session !== req.session); // one session may run several things (a hub is a backend and a Vite)
  if (dev.length) return { verdict: "wait", why: `the dev machine is checked out by ${dev.map((l) => `${l.session}${l.what ? ` (${l.what})` : ""}`).join(", ")}; it is returned when that job ends or after ${Math.round(leaseIdleS() / 60)} idle minutes` };
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

/** The Status row's source (backend/src/lib/hostGuard.ts reads it): who holds development work on the machine, since when and for what. */
function writeDevLease(): void {
  const held = readAll("held").filter((l) => l.cls === "dev").map((l) => ({ session: l.session, kind: l.kind, whole: l.whole, since: l.since, beat: l.beat ?? l.since, ...(l.what ? { what: l.what } : {}), ...(l.manualUntil ? { manual_until: l.manualUntil } : {}) }));
  const queue = readAll("queue").filter((l) => l.cls === "dev").sort((x, y) => (before(x, y) ? -1 : 1));
  const next = queue[0];
  const file = devLeaseFile(); ensureDirs(stateDir());
  writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, ts: Math.floor(Date.now() / 1000), idle_s: leaseIdleS(), held, waiting: queue.length, ...(next ? { next: { session: next.session, ...(next.what ? { what: next.what } : {}) } } : {}) }));
  renameSync(`${file}.tmp`, file);
}
function syncFlag(mode: Mode = leaseMode()): void {
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
  for (const n of ["held", "queue"]) for (const l of readAll(n)) {
    if (l.manualUntil) { if (l.manualUntil < now) { drop(n, l.id); au(l, "lease-reaped", "manual hold timer ended"); } continue; } // a manual hold is not tied to a process or to activity
    if (!alive(l.pid) || l.until < now) { drop(n, l.id); au(l, "lease-reaped", !alive(l.pid) ? "holder gone (its session ended or crashed)" : "time up"); }
  }
  // A held development lease with no sign of life for the idle time is returned and the next in line gets it (nobody kills anything).
  for (const l of readAll("held")) if (l.cls === "dev" && !l.manualUntil && now - (l.beat ?? l.since) > leaseIdleS()) { drop("held", l.id); au(l, "lease-reaped", `idle for ${Math.round((now - (l.beat ?? l.since)) / 60)} minutes with no activity`); }
  if (mode === "gated" && (readAll("held").some((l) => l.cls === "family") || hubFamily().length)) for (const l of readAll("held")) if (l.cls === "dev" && !l.yieldRequested) { put("held", { ...l, yieldRequested: true }); au(l, "yield-requested", "family request arrived"); }
  syncFlag(mode);
}

/** One attempt: returns the decision, and on grant moves the ticket to held. */
function attempt(req: Lease, mode: Mode): Decision {
  return withLock(() => {
    reap(mode);
    if (!readAll("queue").some((l) => l.id === req.id) && !readAll("held").some((l) => l.id === req.id)) put("queue", req);
    const queue = readAll("queue").filter((l) => l.id !== req.id);
    const d = decide(req, [...readAll("held"), ...hubFamily()], queue, mode);
    if (d.verdict === "grant") { drop("queue", req.id); put("held", req); au(req, "lease-granted", `mode ${mode}`); if (req.cls === "family" && mode === "gated") reap(mode); syncFlag(mode); }
    else if (d.verdict === "deny") { drop("queue", req.id); au(req, "lease-denied", d.why); }
    return d;
  });
}
/** A sign of life from the holder: pushes the idle release back. */
export function beat(id: string): boolean {
  return withLock(() => { const l = readAll("held").find((x) => x.id === id); if (!l) return false; put("held", { ...l, beat: Date.now() / 1000 }); writeDevLease(); return true; });
}
export function release(id: string): boolean {
  return withLock(() => { const l = readAll("held").find((x) => x.id === id) ?? readAll("queue").find((x) => x.id === id); if (!l) return false; drop("held", id); drop("queue", id); au(l, "lease-released", "holder done"); syncFlag(); return true; });
}

export async function acquire(a: string[]): Promise<{ id: string; code: number }> {
  const get = (n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const cls = get("--class") === "family" ? "family" : "dev";
  const mode = leaseMode();
  const now = Date.now() / 1000;
  const req: Lease = { id: `${Date.now().toString(36)}-${process.pid}-${Math.floor(Math.random() * 1e4)}`, cls, kind: get("--kind") ?? "other", session: get("--session") ?? process.env.MAIPAI_SESSION ?? process.env.CLAUDE_SESSION_ID ?? "unknown", pid: Number(get("--pid")) || process.ppid, whole: a.includes("--whole-machine"), owner: a.includes("--owner") || process.env.MAIPAI_CHECKOUT_OWNER === "1", since: now, beat: now, ...(get("--what") ? { what: get("--what")!.slice(0, 120) } : {}), until: now + parseDuration(get("--ttl") ?? "4h"), ...(a.includes("--manual") ? { manualUntil: now + (Number(get("--minutes")) || 30) * 60 } : {}), seq: Date.now() * 1000 + (process.pid % 1000) };
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
  if (sub === "take") { const r = await acquire([...rest, ...(rest.includes("--manual") ? [] : ["--manual"]), "--pid", String(process.pid)]); if (r.id) console.log(r.id); process.exit(r.code); }
  else if (sub === "extend") {
    if (!rest.includes("--owner-asked")) { console.error("lease.sh extend: only when Jesse says so in that turn. Add --owner-asked."); process.exit(2); }
    const i = rest.indexOf("--minutes"); const mins = i >= 0 ? Number(rest[i + 1]) || 30 : 30;
    const ok = withLock(() => { const l = readAll("held").find((x) => x.id === rest[0]); if (!l?.manualUntil) return false; put("held", { ...l, manualUntil: l.manualUntil + mins * 60 }); au(l, "manual-extended", `${mins} minutes, Jesse's word`); writeDevLease(); return true; });
    console.log(ok ? "extended" : "not a manual hold"); process.exit(ok ? 0 : 1);
  }
  else if (sub === "acquire") { const r = await acquire(rest); if (r.id) console.log(r.id); process.exit(r.code); }
  else if (sub === "release") { process.exit(release(rest[0] ?? "") ? 0 : 1); }
  else if (sub === "check") { const l = withLock(() => { reap(leaseMode()); return readAll("held").find((x) => x.id === rest[0]); }); if (!l) { console.log("gone"); process.exit(1); } console.log(l.yieldRequested ? "yield" : "ok"); process.exit(l.yieldRequested ? 10 : 0); }
  else if (sub === "beat") { const ok = beat(rest[0] ?? ""); console.log(ok ? "ok" : "gone"); process.exit(ok ? 0 : 1); }
  else if (sub === "mode") console.log(leaseMode());
  else if (sub === "status") {
    withLock(() => reap(leaseMode()));
    console.log(`mode: ${leaseMode()}`);
    for (const l of readAll("held")) console.log(`held   ${l.id}  ${l.cls}/${l.kind}${l.whole ? "/whole-machine" : ""}  ${l.session}${l.what ? `  for: ${l.what}` : ""}  since ${new Date(l.since * 1000).toISOString().slice(11, 16)}Z  ${l.manualUntil ? `manual hold returns in ${Math.max(0, Math.round((l.manualUntil - Date.now() / 1000) / 60))} min` : `last sign of life ${Math.round((Date.now() / 1000 - (l.beat ?? l.since)) / 60)} min ago`}${l.yieldRequested ? "  (asked to yield)" : ""}`);
    for (const l of readAll("queue").sort((x, y) => (before(x, y) ? -1 : 1))) console.log(`queued ${l.id}  ${l.cls}/${l.kind}${l.owner ? "/owner" : ""}  ${l.session}`);
  } else if (sub === "run") {
    const dd = rest.indexOf("--"); if (dd < 0) { console.error("lease.sh run: command after --"); process.exit(2); }
    const opts = rest.slice(0, dd); const cmd = rest.slice(dd + 1);
    const r = await acquire([...opts, "--pid", String(process.pid)]); if (r.code) process.exit(r.code);
    const timeout = opts.indexOf("--timeout") >= 0 ? opts[opts.indexOf("--timeout") + 1]! : "4h";
    const child = Bun.spawn(["bun", join(import.meta.dir, "job.ts"), "run", "--type", "other", "--timeout", timeout, "--", ...cmd], { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, MAIPAI_CHECKOUT_ID: r.id } });
    // The work using CPU is a sign of life; a quiet job that is still working calls `lease.sh beat <id>` itself.
    const pulse = setInterval(() => { if (treeActive(child.pid)) beat(r.id); }, Number(process.env.MAIPAI_LEASE_PULSE_MS) || 15_000);
    const code = await child.exited; clearInterval(pulse); release(r.id); process.exit(code);
  } else { console.error("usage: lease.sh run|take|extend|acquire|release|check|beat|status|mode (see lease.ts)"); process.exit(2); }
}
