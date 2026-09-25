// CHAT-22: every conversational live bench is safe to run. The setup
// helper (scripts/bench/setup.ts) is proven the way it is used: each
// bench entry point is spawned as its own process against an in-process
// stub engine (spec/llm/ts/stubServer.ts serves chat, embeddings and
// health on one port), with a fresh temp data directory, and the test
// reads its exit code and summary line. No bench here ever sees a real
// engine, a household directory, or this test's own database.
import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStubLlmServer } from "@maipai/spec/llm/ts/stubServer.js";
import { finishBench } from "../scripts/bench/finish";

const BACKEND = join(import.meta.dir, "..");
const ENTRY_POINTS = ["routing.ts", "tool-calling.ts", "naturalness.ts", "persona-eval.ts", "memory-eval.ts", "memory/run.ts", "judge-eval.ts", "parity-bisect.ts", "parity-bisect2.ts", "parity-bisect3.ts", "parity-bisect4.ts", "prefix-class-01-verify.ts"];

let stub: { url: string; stop: () => void };
beforeAll(() => {
  stub = startStubLlmServer(0);
});
afterAll(() => {
  stub.stop();
});

async function runBench(entry: string, env: Record<string, string | undefined>): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["bun", "run", `scripts/bench/${entry}`], {
    cwd: BACKEND,
    env: { ...process.env, MAIPAI_LLAMA_SERVER_URL: undefined, MAIPAI_EMBED_URL: undefined, MAIPAI_BACKGROUND_URL: undefined, MAIPAI_DATA_DIR: undefined, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { code, out: `${out}\n${err}` };
}

const stubEnv = () => ({ MAIPAI_LLAMA_SERVER_URL: stub.url, MAIPAI_EMBED_URL: stub.url, MAIPAI_BACKGROUND_URL: stub.url, MAIPAI_BENCH_REPEATS: "1" });

describe("CHAT-22: the bench setup refuses anything but a fresh temp directory and a supplied engine", () => {
  test("a data directory with anything in it is refused before any mutation: the sentinel is untouched and no database appears", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-bench-sentinel-"));
    const sentinel = join(dir, "sentinel.txt");
    writeFileSync(sentinel, "a household lives here");
    const before = statSync(sentinel).mtimeMs;
    const { code, out } = await runBench("routing.ts", { ...stubEnv(), MAIPAI_DATA_DIR: dir });
    expect(code).toBe(2);
    expect(out).toContain("bench setup refused");
    expect(readFileSync(sentinel, "utf-8")).toBe("a household lives here");
    expect(statSync(sentinel).mtimeMs).toBe(before);
    expect(readdirSync(dir)).toEqual(["sentinel.txt"]); // no hub.db, no logs, nothing
  });

  test("a directory outside the system temp root is refused", async () => {
    const { code, out } = await runBench("routing.ts", { ...stubEnv(), MAIPAI_DATA_DIR: join(BACKEND, "definitely-not-a-bench-dir") });
    expect(code).toBe(2);
    expect(out).toContain("not under the system temp root");
    expect(existsSync(join(BACKEND, "definitely-not-a-bench-dir"))).toBe(false);
  });

  test("no engine URL means no run: nothing is spawned or downloaded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-bench-nourl-"));
    const { code, out } = await runBench("routing.ts", { MAIPAI_DATA_DIR: dir, MAIPAI_EMBED_URL: stub.url });
    expect(code).toBe(2);
    expect(out).toContain("MAIPAI_LLAMA_SERVER_URL is not set");
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a chat URL nothing answers is refused before any case runs, not scored as a full run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-bench-deadurl-"));
    const { code, out } = await runBench("routing.ts", { ...stubEnv(), MAIPAI_LLAMA_SERVER_URL: "http://127.0.0.1:1", MAIPAI_DATA_DIR: dir });
    expect(code).toBe(2);
    expect(out).toContain("no engine answers at MAIPAI_LLAMA_SERVER_URL");
    expect(out).not.toContain("bench finished");
  });

  test("a sibling of the temp root is not under it", async () => {
    const sibling = `${tmpdir().replace(/\/+$/, "")}-not-temp`;
    const { code, out } = await runBench("routing.ts", { ...stubEnv(), MAIPAI_DATA_DIR: sibling });
    expect(code).toBe(2);
    expect(out).toContain("not under the system temp root");
    expect(existsSync(sibling)).toBe(false);
  });

  test("judge-eval refuses when no memory judge answers, instead of scoring a batch the judge never processed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-bench-nojudge-"));
    const { code, out } = await runBench("judge-eval.ts", { ...stubEnv(), MAIPAI_BACKGROUND_URL: undefined, MAIPAI_DATA_DIR: dir });
    expect(code).toBe(2);
    expect(out).toContain("no memory judge answers");
    expect(out).not.toContain("bench finished");
  });

  // B-GUARD-02 (a review, 2026-09-24): the real-SearXNG clearance check
  // used to live here, keyed to one env var name, checked unconditionally
  // regardless of what the entry point does with it - which is exactly
  // how stream-next-01-live.ts's own differently-named env var slipped
  // past it undetected. Moved to liveHubQuiet.ts's own
  // refuseRealSearxngWithoutClearance(), called at each real caller's own
  // point of writing search.searxng_url - tests/liveHubQuiet.test.ts
  // proves that one shared function directly (a real spawned process,
  // the same Bun.spawn shape this file's own tests already use); the
  // "stream-next-01-live.ts wiring" describe block below proves at least
  // one real caller actually calls it, end to end.

  test("zero executed cases can never report success", () => {
    const codes: number[] = [];
    finishBench({ executed: 0 }, (code) => codes.push(code));
    finishBench({ executed: Number.NaN }, (code) => codes.push(code));
    finishBench({ executed: 3 }, (code) => codes.push(code));
    expect(codes).toEqual([1, 1, 0]);
  });
});

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
  for (const entry of ENTRY_POINTS) {
    test(
      `${entry}: exits 0 with its identity and case count, in a directory of its own, without stopping the shared engine`,
      async () => {
        const dir = mkdtempSync(join(tmpdir(), "maipai-bench-run-"));
        const { code, out } = await runBench(entry, { ...stubEnv(), MAIPAI_DATA_DIR: dir });
        expect(out).toMatch(/bench finished: engine (?:(?:chat|embed|background) (?!none\b)\S+ at http\S+|literal-pattern corpus [1-9]\d*\/[1-9]\d*); executed [1-9]\d* cases/);
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
