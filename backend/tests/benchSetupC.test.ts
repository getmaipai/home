import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENTRY_POINTS_C, stub, setupBenchStub, runBench, stubEnv } from "./fixtures/benchSetupFixtures";

setupBenchStub();

describe("CHAT-22: every entry point runs isolated against a stub and leaves it alive", () => {
  for (const entry of ENTRY_POINTS_C) {
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
