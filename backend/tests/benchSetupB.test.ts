import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKEND, ENTRY_POINTS_B, stub, setupBenchStub, runBench, stubEnv } from "./fixtures/benchSetupFixtures";

setupBenchStub();

// B-GUARD-02: stream-next-01-live.ts is the real caller the review
// finding was about - it used to read a differently-named env var
// (MAIPAI_BENCH_SEARXNG_URL) that setup.ts's own former clearance check
// never saw, so every run of it reached the household's real SearXNG
// with no clearance gate at all. Renamed to the shared MAIPAI_SEARXNG_URL
// and now calls refuseRealSearxngWithoutClearance() itself, right where
// its own URL takes effect - proven here end to end (a real spawn,
// `import.meta.main`), not only at the shared function's own unit level
// (tests/liveHubQuiet.test.ts). interimRuleMeasure.ts calls the
// identical shared function the identical way (see its own source) but
// isn't spawned here: its first line is refuseIfGateRunning(), which
// refuses a real spawn from inside this very `bun test` run before ever
// reaching the searxng check - the same reason interimRuleMeasure.test.ts
// only ever unit-tests its own exported pure function, never the whole
// script.
describe("B-GUARD-02: stream-next-01-live.ts's own real-SearXNG clearance", () => {
  async function runStreamNextLive(env: Record<string, string | undefined>): Promise<{ code: number; out: string }> {
    const dir = mkdtempSync(join(tmpdir(), "maipai-stream-next-live-"));
    const proc = Bun.spawn(["bun", "run", "scripts/bench/stream-next-01-live.ts"], {
      cwd: BACKEND,
      env: { ...process.env, MAIPAI_LLAMA_SERVER_URL: "http://127.0.0.1:1", MAIPAI_EMBED_URL: "http://127.0.0.1:1", MAIPAI_BACKGROUND_URL: undefined, MAIPAI_DATA_DIR: dir, MAIPAI_BENCH_REAL_SEARXNG_CLEARED: undefined, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    return { code, out: `${out}\n${err}` };
  }

  test("a real (non-fixture) MAIPAI_SEARXNG_URL without clearance is refused before any live traffic", async () => {
    const { code, out } = await runStreamNextLive({ MAIPAI_SEARXNG_URL: "http://192.0.2.10:8888" });
    expect(code).toBe(2);
    expect(out).toContain("stream-next-01-live refused");
    expect(out).toContain("MAIPAI_BENCH_REAL_SEARXNG_CLEARED=1 is not set");
  });

  test("MAIPAI_SEARXNG_URL is not set at all is refused with its own message, never silently skipped", async () => {
    const { code, out } = await runStreamNextLive({});
    expect(code).toBe(2);
    expect(out).toContain("MAIPAI_SEARXNG_URL is not set");
  });

  test("a local fixture MAIPAI_SEARXNG_URL passes the clearance check (the run then fails later for an unrelated reason: no real engine)", async () => {
    const { out } = await runStreamNextLive({ MAIPAI_SEARXNG_URL: "http://127.0.0.1:54321" });
    expect(out).not.toContain("MAIPAI_BENCH_REAL_SEARXNG_CLEARED=1 is not set");
  });
});

describe("CHAT-22: every entry point runs isolated against a stub and leaves it alive", () => {
  for (const entry of ENTRY_POINTS_B) {
    test(
      `${entry}: exits 0 with its identity and case count, in a directory of its own, without stopping the shared engine`,
      async () => {
        const dir = mkdtempSync(join(tmpdir(), "maipai-bench-run-"));
        const { code, out } = await runBench(entry, { ...stubEnv(), MAIPAI_DATA_DIR: dir });
        expect(out).toMatch(/bench finished: engine (?:(?:chat|embed|background) (?!none\b)\S+ at http\S+|(?:embedding|judge) at http\S+|literal-pattern corpus [1-9]\d*\/[1-9]\d*); executed [1-9]\d* cases/);
        expect(code).toBe(0);
        expect(existsSync(join(dir, "hub.db"))).toBe(true); // its own database, nobody else's
        const alive = await fetch(`${stub.url}/health`);
        expect(alive.status).toBe(200); // cleanup never stops an engine it did not start
        // A second run may never reuse that directory: repeated runs stay isolated.
        const again = await runBench(entry, { ...stubEnv(), MAIPAI_DATA_DIR: dir });
        expect(again.code).toBe(2);
        expect(again.out).toContain("is not empty");
      },
      120_000,
    );
  }
});
