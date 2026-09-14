// Baseline v0's own committed manifest (generate-oracle-v0-manifest.ts):
// the same "committed metadata checked, live download never required"
// shape datasetsRegistry.test.ts already uses for registry.json - the
// oracle set itself is gitignored (data-scratch/datasets/), so a test
// here reads only what this repo actually tracks.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_SEED } from "../scripts/bench/datasets/sample";

interface StratumInfo {
  questionType: string;
  poolSize: number;
  abstentionPoolSize: number;
  abstentionRate: number;
  abstentionTarget: number;
}

interface OracleV0Manifest {
  seed: number;
  perClass: number;
  sourceDataset: string;
  samplingRule: string;
  strata: StratumInfo[];
  entries: { questionId: string; questionType: string; isAbstention: boolean }[];
}

const manifest = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "scripts", "bench", "datasets", "oracle-v0-manifest.json"), "utf-8"),
) as OracleV0Manifest;

describe("oracle-v0-manifest.json", () => {
  test("the seed is recorded in the manifest itself, pinned to sample.ts's own SAMPLE_SEED - a rerun of the generator reproduces it without reading any other file", () => {
    expect(manifest.seed).toBe(SAMPLE_SEED);
  });

  test("5 per class, 30 total (the coordinator's own baseline v0 sizing, 2026-09-14)", () => {
    expect(manifest.perClass).toBe(5);
    expect(manifest.entries).toHaveLength(30);
  });

  test("drawn from the oracle set, not the S set", () => {
    expect(manifest.sourceDataset).toBe("longmemeval_oracle.json");
  });

  test("every one of the six question types gets exactly 5 entries", () => {
    const byType = new Map<string, number>();
    for (const e of manifest.entries) byType.set(e.questionType, (byType.get(e.questionType) ?? 0) + 1);
    expect(byType).toEqual(
      new Map([
        ["knowledge-update", 5],
        ["multi-session", 5],
        ["single-session-assistant", 5],
        ["single-session-preference", 5],
        ["single-session-user", 5],
        ["temporal-reasoning", 5],
      ]),
    );
  });

  test("every entry's id is unique - no question counted twice toward its own class's target", () => {
    const ids = manifest.entries.map((e) => e.questionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The coordinator's own fix, 2026-09-14: the first version of this
  // manifest prioritized every abstention question ahead of the rest of
  // its class (selectLongMemEvalSample's own rule, right for a 40-per-
  // class sample, wrong at 5), which made several classes come out
  // entirely abstention. This version draws each class's abstention
  // share proportional to its own real rate instead, recorded here.
  test("the sampling rule is recorded, and each stratum's own math checks out against the entries actually chosen", () => {
    expect(manifest.samplingRule).toContain("proportional");
    expect(manifest.strata).toHaveLength(6);
    for (const s of manifest.strata) {
      expect(s.abstentionTarget).toBe(Math.min(Math.round(manifest.perClass * s.abstentionRate), s.abstentionPoolSize, manifest.perClass));
      const inClass = manifest.entries.filter((e) => e.questionType === s.questionType);
      expect(inClass.filter((e) => e.isAbstention)).toHaveLength(s.abstentionTarget);
    }
  });

  test("the oracle set's own real per-type abstention rates are small enough that every class rounds to zero abstention questions at perClass=5 - proportional, not forced, and never the all-abstention class the previous version produced", () => {
    expect(manifest.strata.every((s) => s.abstentionTarget === 0)).toBe(true);
    expect(manifest.entries.every((e) => !e.isAbstention)).toBe(true);
  });
});
