import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leaseState, leaseHolds, LEASE_TTL_MS, startLeaseWriter } from "../src/turnLease";
const dir = mkdtempSync(join(tmpdir(), "lease-")); const HELPERS = [["python3", `${import.meta.dir}/../rig/yield/wait_if_talking.py`], ["bash", `${import.meta.dir}/../rig/yield/wait_if_talking.sh`]] as const;
const run = async (h: readonly [string, string], file: string, maxWait = "0.4") => { const p = Bun.spawn([h[0], h[1], "--file", file, "--max-wait", maxWait, "--poll", "0.05"], { stdout: "pipe" }); const t = Date.now(); const out = (await new Response(p.stdout).text()).trim(); const m = /waited_ms=(\d+) reason=(\w+)/.exec(out)!; return { out, ms: Number(m[1]), reason: m[2], wall: Date.now() - t }; };
test("the lease holds only while a turn is in flight and unexpired", () => {
  expect(leaseHolds(leaseState(1, 1000), 1000 + LEASE_TTL_MS - 1)).toBe(true);
  expect(leaseHolds(leaseState(1, 1000), 1000 + LEASE_TTL_MS)).toBe(false);   // hard expiry: a dead lab stops holding
  expect(leaseHolds(leaseState(0, 1000), 1001)).toBe(false); expect(leaseHolds(null, 1)).toBe(false); expect(leaseHolds({ inFlight: true }, 1)).toBe(false);
});
test("the writer publishes the count, refreshes it, and clears the lease when stopped", async () => {
  const f = join(dir, "w.json"); let n = 1; const stop = startLeaseWriter(f, () => n, 20);
  expect(JSON.parse(readFileSync(f, "utf8")).inFlight).toBe(true); n = 0; await Bun.sleep(80); expect(JSON.parse(readFileSync(f, "utf8")).inFlight).toBe(false);
  n = 2; await Bun.sleep(80); expect(JSON.parse(readFileSync(f, "utf8")).turns).toBe(2); stop(); expect(JSON.parse(readFileSync(f, "utf8")).inFlight).toBe(false);
});
for (const h of HELPERS) {
  const name = h[0];
  test(`${name} helper: no lease file returns at once`, async () => { const r = await run(h, join(dir, "none.json")); expect(r.reason).toBe("none"); expect(r.ms).toBeLessThan(300); });
  test(`${name} helper: a stale lease is ignored`, async () => { const f = join(dir, `stale-${name}.json`); writeFileSync(f, JSON.stringify({ inFlight: true, expires_at_ms: Date.now() - 60_000 })); const r = await run(h, f); expect(r.reason).toBe("none"); expect(r.ms).toBeLessThan(300); });
  test(`${name} helper: a lease that never clears is waited on only up to the max wait`, async () => { const f = join(dir, `hold-${name}.json`); writeFileSync(f, JSON.stringify({ inFlight: true, expires_at_ms: Date.now() + 60_000 })); const r = await run(h, f, "0.4"); expect(r.reason).toBe("timeout"); expect(r.ms).toBeGreaterThanOrEqual(350); expect(r.wall).toBeLessThan(1500); });
  test(`${name} helper: returns as soon as the lease clears`, async () => { const f = join(dir, `clear-${name}.json`); writeFileSync(f, JSON.stringify({ inFlight: true, expires_at_ms: Date.now() + 60_000 })); setTimeout(() => writeFileSync(f, JSON.stringify({ inFlight: false, expires_at_ms: Date.now() + 5000 })), 250); const r = await run(h, f, "3"); expect(r.reason).toBe("clear"); expect(r.ms).toBeGreaterThanOrEqual(200); expect(r.ms).toBeLessThan(1200); });
}
test("cleanup", () => { rmSync(dir, { recursive: true, force: true }); });
