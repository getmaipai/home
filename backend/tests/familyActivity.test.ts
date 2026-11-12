// HOST-LAUNCH-02 wiring: a family chat turn tells the dev lease broker it is running (a file both the hub and the user-level broker can read).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readFileSync as read, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetFamilyActivityForTests, trackFamilyTurn } from "@/lib/familyActivity";

const dirs: string[] = [];
function claimFile(): string { const d = mkdtempSync(join(tmpdir(), "fam-")); dirs.push(d); const f = join(d, "local-app", "family-active.json"); process.env.MAIPAI_FAMILY_ACTIVITY = f; return f; }
const claim = (f: string) => JSON.parse(readFileSync(f, "utf-8")) as { active: number; until: number };
afterEach(() => { delete process.env.MAIPAI_FAMILY_ACTIVITY; __resetFamilyActivityForTests(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("family activity claim", () => {
  test("a turn claims while it runs and releases once; the original release still runs", () => {
    const f = claimFile(); let released = 0;
    const lease = trackFamilyTurn({ release: () => { released += 1; } });
    expect(claim(f).active).toBe(1);
    expect(claim(f).until * 1000).toBeGreaterThan(Date.now());
    lease.release(); lease.release();
    expect(claim(f).active).toBe(0);
    expect(released).toBe(2); // the wrapped release is the caller's own idempotent one
  });
  test("overlapping turns count, and the claim drops to zero only when the last ends", () => {
    const f = claimFile();
    const a = trackFamilyTurn({ release() {} }); const b = trackFamilyTurn({ release() {} });
    expect(claim(f).active).toBe(2);
    a.release(); expect(claim(f).active).toBe(1);
    b.release(); expect(claim(f).active).toBe(0);
  });
  test("an unwritable location never breaks a turn", () => {
    process.env.MAIPAI_FAMILY_ACTIVITY = "/proc/none/denied/family-active.json";
    expect(() => trackFamilyTurn({ release() {} }).release()).not.toThrow();
  });
  test("the broker reads what the hub writes: in gated mode a dev lease waits during a turn and goes after it", () => {
    const f = claimFile();
    const state = mkdtempSync(join(tmpdir(), "fam-broker-")); dirs.push(state);
    const env = { PATH: process.env.PATH!, HOME: process.env.HOME!, MAIPAI_JOBS_DIR: state, MAIPAI_DEV_MODE: "gated", MAIPAI_FAMILY_ACTIVITY: f, MAIPAI_MAINTENANCE_FLAG: join(state, "m.json"), MAIPAI_LEASE_POLL_MS: "100" };
    const dev = () => Bun.spawnSync(["bun", join(import.meta.dir, "..", "..", "scripts", "jobs", "lease.ts"), "acquire", "--pid", String(process.pid), "--wait", "1"], { env, stdout: "pipe", stderr: "pipe" });
    const turn = trackFamilyTurn({ release() {} });
    expect(dev().exitCode).toBe(75);
    turn.release();
    expect(dev().exitCode).toBe(0);
  });
  test("the chat turn is the thing that claims: turnNext wraps its lease with trackFamilyTurn", () => {
    expect(read(join(import.meta.dir, "..", "src", "lib", "turnMachine", "turnNext.ts"), "utf-8")).toContain("trackFamilyTurn(trackChatLease(actor.id, acquireTurnLease()))");
  });
});
