import { expect, test } from "bun:test";
import { join } from "node:path";

// The landing acceptance harness (scripts/landingHarness.ts) on scratch repositories: several sessions land without collision, express
// waits for the running transaction and never runs more than twice in a row, every landing carries queue and run times, and a stand-in
// preview keeps answering. Bench lane: it runs a real lander daemon for about 40 s.
test("landing harness: sessions, fairness, timings, preview", () => {
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "landingHarness.ts"), "--quick", "--json"], { stdout: "pipe", stderr: "pipe", timeout: 240_000 });
  expect(r.exitCode).toBe(0);
  const out = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  expect(out.sessions.landed).toBe(out.sessions.sessions);
  expect(out.sessions.github_equals_pipeline).toBe(true);
  expect(out.sessions.stuck).toBe(false);
  expect(out.fairness.express_waited_for_transaction_end).toBe(true);
  expect(out.fairness.max_express_in_a_row).toBeLessThanOrEqual(2);
  for (const t of out.timings) for (const k of ["requested_at", "started_at", "finished_at", "queue_s", "run_s", "phases"]) expect(t).toHaveProperty(k);
  expect(out.preview_ms.landing.p95 - out.preview_ms.idle.p95).toBeLessThan(500);
}, 300_000);
