import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { isLocalFixtureUrl } from "../scripts/bench/liveHubQuiet";

const BACKEND = join(import.meta.dir, "..");

/** B-GUARD-02: `refuseRealSearxngWithoutClearance` calls `process.exit()`
 * directly, so it is proven the same way every other exit-calling bench
 * guard in this suite is (benchSetup.test.ts's own Bun.spawn pattern) -
 * a real child process, never a mocked `process.exit` in this test's own
 * process. A one-line script, not a full bench: this is the ONE
 * definition every real caller (interimRuleMeasure.ts, stream-next-01-
 * live.ts, query-writer-01-live.ts) now shares, so proving it here once
 * is what makes each caller's own one-line call trustworthy without
 * re-spawning a whole bench per caller (interimRuleMeasure.ts's own
 * refuseIfGateRunning() would refuse a real spawn from inside this very
 * `bun test` run before ever reaching this check anyway). */
async function runGuard(env: Record<string, string | undefined>): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["bun", "-e", 'import { refuseRealSearxngWithoutClearance } from "./scripts/bench/liveHubQuiet"; refuseRealSearxngWithoutClearance("test-script", process.env.TEST_SEARXNG_URL!); console.log("guard passed");'], {
    cwd: BACKEND,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { code, out: `${out}\n${err}` };
}

describe("refuseRealSearxngWithoutClearance", () => {
  test("a real (non-fixture) URL without clearance refuses", async () => {
    const { code, out } = await runGuard({ TEST_SEARXNG_URL: "http://192.0.2.10:8888", MAIPAI_BENCH_REAL_SEARXNG_CLEARED: undefined });
    expect(code).toBe(2);
    expect(out).toContain("test-script refused");
    expect(out).toContain("MAIPAI_BENCH_REAL_SEARXNG_CLEARED=1 is not set");
    expect(out).not.toContain("guard passed");
  });

  test("a real URL with MAIPAI_BENCH_REAL_SEARXNG_CLEARED=1 passes", async () => {
    const { code, out } = await runGuard({ TEST_SEARXNG_URL: "http://192.0.2.10:8888", MAIPAI_BENCH_REAL_SEARXNG_CLEARED: "1" });
    expect(code).toBe(0);
    expect(out).toContain("guard passed");
  });

  test("a local fixture URL never needs clearance", async () => {
    const { code, out } = await runGuard({ TEST_SEARXNG_URL: "http://127.0.0.1:54321", MAIPAI_BENCH_REAL_SEARXNG_CLEARED: undefined });
    expect(code).toBe(0);
    expect(out).toContain("guard passed");
  });
});

// SEARCH-HEALTH-01 (docs/dev.md's "Live bench protocol", 2026-09-24): the
// classification `refuseRealSearxngWithoutClearance` gates on - never a
// fixture (any of this codebase's own startFakeSearxng() servers) mistaken
// for the household's real instance, and vice versa.
describe("isLocalFixtureUrl", () => {
  test("127.0.0.1, localhost and ::1 are local fixtures", () => {
    expect(isLocalFixtureUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalFixtureUrl("http://localhost:8888")).toBe(true);
    expect(isLocalFixtureUrl("http://[::1]:8888")).toBe(true);
  });

  test("a real LAN or public host is never a local fixture", () => {
    expect(isLocalFixtureUrl("http://192.0.2.10:8888")).toBe(false);
    expect(isLocalFixtureUrl("https://searx.example.com")).toBe(false);
  });

  test("an unparseable URL is treated as local (fails at the real call site instead, never here)", () => {
    expect(isLocalFixtureUrl("not a url")).toBe(true);
  });
});
