// HOST-LAUNCH-02: the lease broker (scripts/jobs/lease.ts): classes, queueing among dev sessions, direct and gated modes.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAudit } from "./lib";
import { decide, type Lease } from "./lease";

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
  return { PATH: process.env.PATH!, HOME: process.env.HOME!, MAIPAI_JOBS_DIR: state, MAIPAI_DEV_MODE: "direct", MAIPAI_LEASE_POLL_MS: "100", MAIPAI_MAINTENANCE_FLAG: join(state, "maintenance.json"), ...extra };
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
});
