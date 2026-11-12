// HOST-LAUNCH-02: the lease broker (scripts/jobs/lease.ts): classes, queueing among dev sessions, direct and gated modes.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAudit } from "./lib";
import { decide, recentlyEdited, type Lease } from "./lease";

const LEASE = join(import.meta.dir, "lease.ts");
const L = (o: Partial<Lease> & { id: string }): Lease => ({ cls: "dev", kind: "video", session: o.id, pid: process.pid, whole: false, since: 0, until: 9e9, seq: 1, ...o });

describe("decide (pure)", () => {
  test("dev sessions queue first come, first served; a later one waits behind an earlier ticket even when a slot is free", () => {
    expect(decide(L({ id: "a", seq: 1 }), [], [], "direct", 1).verdict).toBe("grant");
    expect(decide(L({ id: "b", seq: 2 }), [L({ id: "a" })], [], "direct", 1).verdict).toBe("wait");
    expect(decide(L({ id: "c", seq: 3 }), [], [L({ id: "b", seq: 2 })], "direct", 1).verdict).toBe("wait");
    expect(decide(L({ id: "b", seq: 2 }), [], [L({ id: "c", seq: 3 })], "direct", 1).verdict).toBe("grant");
  });
  test("chat-first applies to family requests only: a family request is granted at once beside a held dev lease", () => {
    expect(decide(L({ id: "f", cls: "family", kind: "chat" }), [L({ id: "a" })], [L({ id: "b", seq: 2 })], "gated", 1).verdict).toBe("grant");
    expect(decide(L({ id: "f", cls: "family", kind: "chat" }), [L({ id: "a" })], [], "direct", 1).verdict).toBe("grant");
  });
  test("direct mode: a dev lease may take the whole machine, and then family requests are held off", () => {
    expect(decide(L({ id: "w", whole: true }), [], [], "direct", 1).verdict).toBe("grant");
    expect(decide(L({ id: "w", whole: true }), [L({ id: "a" })], [], "direct", 1).verdict).toBe("wait");
    expect(decide(L({ id: "f", cls: "family", kind: "chat" }), [L({ id: "w", whole: true })], [], "direct", 1).verdict).toBe("deny");
  });
  test("gated mode: dev work yields to family traffic and cannot take the whole machine", () => {
    expect(decide(L({ id: "w", whole: true }), [], [], "gated", 1).verdict).toBe("deny");
    expect(decide(L({ id: "a" }), [L({ id: "f", cls: "family", kind: "chat" })], [], "gated", 1).verdict).toBe("wait");
    expect(decide(L({ id: "a" }), [], [L({ id: "f", cls: "family", kind: "chat", seq: 9 })], "gated", 1).verdict).toBe("wait");
    expect(decide(L({ id: "a" }), [L({ id: "f", cls: "family", kind: "chat" })], [], "direct", 1).verdict).toBe("grant");
  });
  test("slots let more than one dev lease run at once", () => {
    expect(decide(L({ id: "b", seq: 2 }), [L({ id: "a" })], [], "direct", 2).verdict).toBe("grant");
  });
});

const temps: string[] = [];
afterAll(() => { for (const t of temps) rmSync(t, { recursive: true, force: true }); });
function env(extra: Record<string, string> = {}) {
  const state = mkdtempSync(join(tmpdir(), "lease-")); temps.push(state);
  return { PATH: process.env.PATH!, HOME: process.env.HOME!, MAIPAI_JOBS_DIR: state, MAIPAI_DEV_MODE: "direct", MAIPAI_LEASE_POLL_MS: "100", MAIPAI_MAINTENANCE_FLAG: join(state, "maintenance.json"), MAIPAI_FAMILY_ACTIVITY: join(state, "family-active.json"), ...extra };
}
const lease = (e: Record<string, string>, ...a: string[]) => Bun.spawnSync(["bun", LEASE, ...a], { env: e, stdout: "pipe", stderr: "pipe" });
const out = (r: { stdout: Buffer }) => r.stdout.toString().trim();
const withDir = <T>(e: Record<string, string>, f: () => T): T => { const was = process.env.MAIPAI_JOBS_DIR; process.env.MAIPAI_JOBS_DIR = e.MAIPAI_JOBS_DIR; try { return f(); } finally { if (was === undefined) delete process.env.MAIPAI_JOBS_DIR; else process.env.MAIPAI_JOBS_DIR = was; } };
const me = String(process.pid);

describe("broker CLI", () => {
  test("a second dev session waits for the first; releasing hands it the lease; the audit records both", async () => {
    const e = env();
    const first = out(lease(e, "acquire", "--session", "one", "--kind", "video", "--pid", me));
    expect(first).toMatch(/\w/);
    const second = Bun.spawn(["bun", LEASE, "acquire", "--session", "two", "--kind", "video", "--pid", me, "--wait", "20"], { env: e, stdout: "pipe", stderr: "pipe" });
    await Bun.sleep(700);
    expect(out(lease(e, "status"))).toContain("queued");
    expect(lease(e, "release", first).exitCode).toBe(0);
    expect(await second.exited).toBe(0);
    const a = withDir(e, () => readAudit()).map((x) => `${x.session}:${x.action}`);
    expect(a).toEqual(expect.arrayContaining(["one:lease-granted", "one:lease-released", "two:lease-granted"]));
  }, 20000);

  test("a wait that runs out gives up with nothing granted", () => {
    const e = env();
    lease(e, "acquire", "--session", "one", "--pid", me);
    const r = lease(e, "acquire", "--session", "two", "--pid", me, "--wait", "1");
    expect(r.exitCode).toBe(75); expect(r.stderr.toString()).toContain("Nothing was started");
    expect(out(lease(e, "status"))).not.toContain("two");
  });

  test("direct mode: a whole-machine lease writes the maintenance flag chat reads, family requests are held off, and release clears the flag", () => {
    const e = env();
    const id = out(lease(e, "acquire", "--session", "big", "--kind", "video", "--whole-machine", "--pid", me));
    const flag = JSON.parse(readFileSync(e.MAIPAI_MAINTENANCE_FLAG, "utf-8")) as { until: number };
    expect(flag.until * 1000).toBeGreaterThan(Date.now());
    const fam = lease(e, "acquire", "--class", "family", "--kind", "chat", "--pid", me);
    expect(fam.exitCode).toBe(3); expect(fam.stderr.toString()).toContain("holds the whole machine");
    lease(e, "release", id);
    expect(existsSync(e.MAIPAI_MAINTENANCE_FLAG)).toBe(false);
    expect(lease(e, "acquire", "--class", "family", "--kind", "chat", "--pid", me).exitCode).toBe(0);
  });

  test("direct mode: a heavy video lease gives up the dev reserve (reserve_gb 0, budget unchanged) and release brings it back", () => {
    const e = env({ MAIPAI_DEV_BUDGET_GB: "24" });
    const file = () => JSON.parse(readFileSync(join(e.MAIPAI_JOBS_DIR, "dev-load.json"), "utf-8")) as { budget_gb: number; reserve_gb: number };
    const id = out(lease(e, "acquire", "--session", "video", "--kind", "video", "--pid", me));
    expect(file()).toMatchObject({ budget_gb: 24, reserve_gb: 0 });
    expect(withDir(e, () => readAudit()).some((x) => x.action === "reserve-released")).toBe(true);
    lease(e, "release", id);
    expect(file()).toMatchObject({ budget_gb: 24, reserve_gb: 2 }); // direct mode: what dev really holds (0) plus the 2 GB margin, not the 24 GB budget
    expect(withDir(e, () => readAudit()).some((x) => x.action === "reserve-restored")).toBe(true);
  });
  test("ordinary dev work (a test lease) never releases the reserve, and gated mode never does: the family floor wins", () => {
    const e = env({ MAIPAI_DEV_BUDGET_GB: "24" });
    const id = out(lease(e, "acquire", "--session", "t", "--kind", "test", "--pid", me));
    expect(existsSync(join(e.MAIPAI_JOBS_DIR, "reserve-released"))).toBe(false);
    lease(e, "release", id);
    const g = { ...e, MAIPAI_DEV_MODE: "gated" };
    lease(g, "acquire", "--session", "v", "--kind", "video", "--pid", me);
    expect(existsSync(join(e.MAIPAI_JOBS_DIR, "reserve-released"))).toBe(false);
  });
  // DEV-BUDGET-02 (2026-11-12): a session held a 24 GB dev instance unused and another session had to kill it by hand. Now an idle lease is released by the broker.
  test("a held dev lease that shows no sign of life is released by the broker, the waiter gets it, and the reserve follows the new holder", async () => {
    const e = env({ MAIPAI_DEV_BUDGET_GB: "24", MAIPAI_LEASE_IDLE_S: "2" });
    const first = out(lease(e, "acquire", "--session", "idle-holder", "--kind", "video", "--what", "LTX clip bench", "--pid", me));
    const second = Bun.spawn(["bun", LEASE, "acquire", "--session", "waiter", "--kind", "video", "--pid", me, "--wait", "30"], { env: e, stdout: "pipe", stderr: "pipe" });
    await Bun.sleep(700);
    const status = JSON.parse(readFileSync(join(e.MAIPAI_JOBS_DIR, "dev-lease.json"), "utf-8")) as { held: Array<{ session: string; kind: string; what?: string; since: number }>; waiting: number };
    expect(status.held[0]).toMatchObject({ session: "idle-holder", kind: "video", what: "LTX clip bench" }); expect(status.waiting).toBe(1);
    expect(await second.exited).toBe(0); // granted without anyone releasing or killing anything
    expect(existsSync(join(e.MAIPAI_JOBS_DIR, "reserve-released"))).toBe(true); // the reserve follows the new holder
    const a = withDir(e, () => readAudit());
    expect(a.some((x) => x.session === "idle-holder" && x.action === "lease-reaped" && /idle/.test(x.trigger))).toBe(true);
    expect(lease(e, "beat", first).exitCode).toBe(1); // the old holder's lease is gone
    expect(a.some((x) => x.session === "waiter" && x.action === "lease-granted")).toBe(true);
    expect(out(lease(e, "status"))).not.toContain("idle-holder");
  }, 20000);
  test("a sign of life (beat) keeps a lease; a holder whose process is gone is released at once", async () => {
    const e = env({ MAIPAI_LEASE_IDLE_S: "2" });
    const id = out(lease(e, "acquire", "--session", "busy", "--kind", "video", "--pid", me));
    for (let i = 0; i < 4; i++) { await Bun.sleep(1000); expect(lease(e, "beat", id).exitCode).toBe(0); }
    expect(out(lease(e, "status"))).toContain("busy");
    const dead = Bun.spawn(["true"]); await dead.exited;
    const e2 = env();
    lease(e2, "acquire", "--session", "gone", "--kind", "video", "--pid", String(dead.pid));
    expect(out(lease(e2, "status"))).not.toContain("gone");
    expect(withDir(e2, () => readAudit()).some((x) => x.session === "gone" && x.trigger === "holder gone")).toBe(true);
  }, 20000);
  test("DEV-BUDGET-03: a worktree edited in the last 10 minutes is in use, so a heavy lease never stops its hub", () => {
    const root = mkdtempSync(join(tmpdir(), "wt-")); temps.push(root);
    mkdirSync(join(root, "backend", "src"), { recursive: true }); const f = join(root, "backend", "src", "a.ts"); writeFileSync(f, "x");
    expect(recentlyEdited(root)).toBe(true);
    const old = new Date(Date.now() - 3600_000); utimesSync(f, old, old);
    expect(recentlyEdited(root)).toBe(false);
  });
  test("gated mode: whole-machine is refused, and a held dev lease is told to yield when a family request arrives", () => {
    const e = env({ MAIPAI_DEV_MODE: "gated" });
    expect(lease(e, "acquire", "--whole-machine", "--pid", me).exitCode).toBe(3);
    const id = out(lease(e, "acquire", "--session", "dev", "--kind", "test", "--pid", me));
    expect(lease(e, "check", id).exitCode).toBe(0);
    expect(lease(e, "acquire", "--class", "family", "--kind", "chat", "--pid", me).exitCode).toBe(0);
    const c = lease(e, "check", id); expect(c.exitCode).toBe(10); expect(out(c)).toBe("yield");
    expect(withDir(e, () => readAudit()).some((x) => x.action === "yield-requested")).toBe(true);
  });

  test("a lease whose holder is gone is reaped, so a crashed session never blocks the queue", () => {
    const e = env();
    const dead = Bun.spawnSync(["true"]); void dead;
    lease(e, "acquire", "--session", "ghost", "--pid", "999999");
    const r = lease(e, "acquire", "--session", "live", "--pid", me, "--wait", "5");
    expect(r.exitCode).toBe(0);
    expect(withDir(e, () => readAudit()).some((x) => x.action === "lease-reaped" && x.session === "ghost")).toBe(true);
  });

  test("run acquires, runs the command through the launcher, and releases", () => {
    const e = env();
    const r = lease(e, "run", "--session", "r", "--kind", "test", "--", "bash", "-c", "echo ran");
    expect(r.exitCode).toBe(0); expect(r.stdout.toString()).toContain("ran");
    expect(out(lease(e, "status"))).not.toContain("held ");
    expect(withDir(e, () => readAudit()).map((x) => x.action)).toEqual(expect.arrayContaining(["lease-granted", "launched", "finished", "lease-released"]));
  });

  test("the mode comes from scripts/mode.sh when it exists, else the jobs/mode setting, else gated", () => {
    const e = env(); delete (e as Record<string, string>).MAIPAI_DEV_MODE;
    expect(out(lease({ ...e, MAIPAI_MODE: "direct" }, "mode"))).toBe("direct");
    expect(out(lease({ ...e, MAIPAI_MODE: "gated" }, "mode"))).toBe("gated");
    const state = mkdtempSync(join(tmpdir(), "lease-mode-")); temps.push(state);
    const unset = { ...e, MAIPAI_MODE: "", MAIPAI_MODE_FILE: join(state, "none"), MAIPAI_JOBS_DIR: state };
    expect(out(lease(unset, "mode"))).toBe("gated");
    writeFileSync(join(state, "mode"), "direct\n");
    expect(out(lease(unset, "mode"))).toBe("direct");
  });

  test("the hub's family-turn claim makes gated dev work wait and yield; a stale or zero claim, or direct mode, does not", () => {
    const claim = (e: Record<string, string>, active: number, ageS = 0) => writeFileSync(e.MAIPAI_FAMILY_ACTIVITY, JSON.stringify({ active, until: Math.floor(Date.now() / 1000) + 60 - ageS }));
    const e = env({ MAIPAI_DEV_MODE: "gated" });
    claim(e, 1);
    const waiting = lease(e, "acquire", "--session", "dev", "--pid", me, "--wait", "1");
    expect(waiting.exitCode).toBe(75); expect(waiting.stderr.toString()).toContain("waits for family requests");
    claim(e, 0); expect(lease(e, "acquire", "--session", "dev", "--pid", me, "--wait", "1").exitCode).toBe(0);
    const holder = env({ MAIPAI_DEV_MODE: "gated" });
    const id = out(lease(holder, "acquire", "--session", "dev2", "--pid", me)); expect(lease(holder, "check", id).exitCode).toBe(0);
    claim(holder, 1); const c = lease(holder, "check", id); expect(c.exitCode).toBe(10);
    const stale = env({ MAIPAI_DEV_MODE: "gated" }); claim(stale, 1, 120);
    expect(lease(stale, "acquire", "--pid", me, "--wait", "1").exitCode).toBe(0);
    const direct = env({ MAIPAI_DEV_MODE: "direct" }); claim(direct, 1);
    expect(lease(direct, "acquire", "--pid", me, "--wait", "1").exitCode).toBe(0);
  });

  test("an unwritable maintenance flag location is audited, never a crash, and the lease is still granted", () => {
    const e = env({ MAIPAI_MAINTENANCE_FLAG: "/proc/none/denied/maintenance.json" });
    const r = lease(e, "acquire", "--session", "big", "--whole-machine", "--pid", me);
    expect(r.exitCode).toBe(0);
    expect(withDir(e, () => readAudit()).some((x) => x.action === "flag-not-written")).toBe(true);
  });
});
