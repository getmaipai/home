// HOST-GUARD-09: the memory gate that ship.sh, the lander, the watcher and check.sh read before heavy work (scripts/lib/hostmem.sh).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LIB = join(import.meta.dir, "lib", "hostmem.sh");
const temps: string[] = [];
afterAll(() => { for (const t of temps) rmSync(t, { recursive: true, force: true }); });
function gate(env: Record<string, string>) {
  const state = env.MAIPAI_HOST_GUARD_STATE_DIR ?? mkdtempSync(join(tmpdir(), "hostmem-"));
  temps.push(state);
  return Bun.spawnSync(["/bin/bash", "-c", `set -euo pipefail; source "${LIB}"; hostmem_gate "Ship"`], { env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", MAIPAI_HOST_GUARD_STATE_DIR: state, ...env }, stdout: "pipe", stderr: "pipe" });
}

describe("host memory gate", () => {
  test("a calm Mac goes ahead", () => {
    expect(gate({ MAIPAI_HOSTMEM_PRESSURE: "1" }).exitCode).toBe(0);
  });
  test("pressure level 2 or more defers with one plain line and the guard's summary", () => {
    const state = mkdtempSync(join(tmpdir(), "hostmem-"));
    writeFileSync(join(state, "memory.json"), JSON.stringify({ version: 1, summary: "Memory pressure level 2 for 30 min; biggest: fseventsd 66.0 GB" }));
    const out = gate({ MAIPAI_HOSTMEM_PRESSURE: "2", MAIPAI_HOST_GUARD_STATE_DIR: state });
    expect(out.exitCode).toBe(75);
    const text = out.stderr.toString();
    expect(text.trim().split("\n")).toHaveLength(1);
    expect(text).toContain("Ship deferred: this Mac is under memory pressure (level 2); Memory pressure level 2 for 30 min");
    expect(gate({ MAIPAI_HOSTMEM_PRESSURE: "4" }).exitCode).toBe(75);
  });
  test("a fresh dev-shed flag defers; a stale one is ignored", () => {
    const state = mkdtempSync(join(tmpdir(), "hostmem-"));
    writeFileSync(join(state, "dev-shed"), "{}");
    const fresh = gate({ MAIPAI_HOSTMEM_PRESSURE: "1", MAIPAI_HOST_GUARD_STATE_DIR: state });
    expect(fresh.exitCode).toBe(75);
    expect(fresh.stderr.toString()).toContain("the host guard paused heavy development work");
    const old = (Date.now() - 11 * 60_000) / 1000;
    utimesSync(join(state, "dev-shed"), old, old);
    expect(gate({ MAIPAI_HOSTMEM_PRESSURE: "1", MAIPAI_HOST_GUARD_STATE_DIR: state }).exitCode).toBe(0);
  });
  test("an unreadable pressure never blocks, and the owner's override skips the gate", () => {
    expect(gate({ MAIPAI_HOSTMEM_PRESSURE: "garbage" }).exitCode).toBe(0);
    expect(gate({ MAIPAI_HOSTMEM_PRESSURE: "2", MAIPAI_MEMORY_GATE: "off" }).exitCode).toBe(0);
  });
});
