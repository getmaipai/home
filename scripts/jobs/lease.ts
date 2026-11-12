#!/usr/bin/env bun
// HOST-LAUNCH-02: the lease broker for heavy development work (video, images, big test runs).
//
//   lease.sh acquire --class dev|family --kind video|image|test|other [--session S] [--whole-machine] [--ttl 4h] [--wait 30m] [--pid N]
//   lease.sh run     --class dev --kind video [--whole-machine] [--timeout 4h] -- <command...>     (acquire, run through job.sh, release)
//   lease.sh release <id> | check <id> | status | mode
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
import { alive, audit, ensureDirs, parseDuration, stateDir } from "./lib";

const repoRoot = resolve(import.meta.dir, "..", "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export type Mode = "direct" | "gated";
export type Lease = { id: string; cls: "dev" | "family"; kind: string; session: string; pid: number; whole: boolean; since: number; until: number; seq: number; yieldRequested?: boolean };
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
const maintenanceFlag = (): string | null => process.env.MAIPAI_MAINTENANCE_FLAG ?? (process.env.MAIPAI_DATA_DIR ? join(process.env.MAIPAI_DATA_DIR, "local-app", "maintenance.json") : null);

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

function syncFlag(): void {
  const f = maintenanceFlag(); if (!f) return;
  const whole = readAll("held").filter((l) => l.cls === "dev" && l.whole);
  if (whole.length) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify({ until: Math.max(...whole.map((l) => l.until)), lease: whole[0]!.id })); }
  else rmSync(f, { force: true });
}
/** Reap holders and tickets whose process is gone or whose time is up; tell dev holders to yield when a family request is in. */
function reap(mode: Mode): void {
  const now = Date.now() / 1000;
  for (const n of ["held", "queue"]) for (const l of readAll(n)) if (!alive(l.pid) || l.until < now) { drop(n, l.id); au(l, "lease-reaped", !alive(l.pid) ? "holder gone" : "time up"); }
  if (mode === "gated" && readAll("held").some((l) => l.cls === "family")) for (const l of readAll("held")) if (l.cls === "dev" && !l.yieldRequested) { put("held", { ...l, yieldRequested: true }); au(l, "yield-requested", "family request arrived"); }
  syncFlag();
}
const slotsNow = () => Number(process.env.MAIPAI_DEV_LEASE_SLOTS) || 1;

/** One attempt: returns the decision, and on grant moves the ticket to held. */
function attempt(req: Lease, mode: Mode): Decision {
  return withLock(() => {
    reap(mode);
    if (!readAll("queue").some((l) => l.id === req.id) && !readAll("held").some((l) => l.id === req.id)) put("queue", req);
    const queue = readAll("queue").filter((l) => l.id !== req.id);
    const d = decide(req, readAll("held"), queue, mode, slotsNow());
    if (d.verdict === "grant") { drop("queue", req.id); put("held", req); au(req, "lease-granted", `mode ${mode}`); if (req.cls === "family" && mode === "gated") reap(mode); syncFlag(); }
    else if (d.verdict === "deny") { drop("queue", req.id); au(req, "lease-denied", d.why); }
    return d;
  });
}
function release(id: string): boolean {
  return withLock(() => { const l = readAll("held").find((x) => x.id === id) ?? readAll("queue").find((x) => x.id === id); if (!l) return false; drop("held", id); drop("queue", id); au(l, "lease-released", "holder done"); syncFlag(); return true; });
}

async function acquire(a: string[]): Promise<{ id: string; code: number }> {
  const get = (n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const cls = get("--class") === "family" ? "family" : "dev";
  const mode = leaseMode();
  const now = Date.now() / 1000;
  const req: Lease = { id: `${Date.now().toString(36)}-${process.pid}-${Math.floor(Math.random() * 1e4)}`, cls, kind: get("--kind") ?? "other", session: get("--session") ?? process.env.MAIPAI_SESSION ?? process.env.CLAUDE_SESSION_ID ?? "unknown", pid: Number(get("--pid")) || process.ppid, whole: a.includes("--whole-machine"), since: now, until: now + parseDuration(get("--ttl") ?? "4h"), seq: Date.now() * 1000 + (process.pid % 1000) };
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
  else if (sub === "mode") console.log(leaseMode());
  else if (sub === "status") {
    withLock(() => reap(leaseMode()));
    console.log(`mode: ${leaseMode()}`);
    for (const l of readAll("held")) console.log(`held   ${l.id}  ${l.cls}/${l.kind}${l.whole ? "/whole-machine" : ""}  ${l.session}${l.yieldRequested ? "  (asked to yield)" : ""}`);
    for (const l of readAll("queue").sort((x, y) => x.seq - y.seq)) console.log(`queued ${l.id}  ${l.cls}/${l.kind}  ${l.session}`);
  } else if (sub === "run") {
    const dd = rest.indexOf("--"); if (dd < 0) { console.error("lease.sh run: command after --"); process.exit(2); }
    const opts = rest.slice(0, dd); const cmd = rest.slice(dd + 1);
    const r = await acquire([...opts, "--pid", String(process.pid)]); if (r.code) process.exit(r.code);
    const timeout = opts.indexOf("--timeout") >= 0 ? opts[opts.indexOf("--timeout") + 1]! : "4h";
    const child = Bun.spawn(["bun", join(import.meta.dir, "job.ts"), "run", "--type", "other", "--timeout", timeout, "--", ...cmd], { stdio: ["inherit", "inherit", "inherit"] });
    const code = await child.exited; release(r.id); process.exit(code);
  } else { console.error("usage: lease.sh acquire|run|release|check|status|mode (see lease.ts)"); process.exit(2); }
}
