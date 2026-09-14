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

interface AbstentionStratumInfo {
  poolSize: number;
  target: number;
}

interface OracleV0Manifest {
  seed: number;
  perClass: number;
  abstentionStratumSize: number;
  sourceDataset: string;
  samplingRule: string;
  strata: StratumInfo[];
  abstentionStratum: AbstentionStratumInfo;
  entries: { questionId: string; questionType: string; isAbstention: boolean; fromAbstentionStratum: boolean }[];
}

const manifest = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "scripts", "bench", "datasets", "oracle-v0-manifest.json"), "utf-8"),
) as OracleV0Manifest;

describe("oracle-v0-manifest.json", () => {
  test("the seed is recorded in the manifest itself, pinned to sample.ts's own SAMPLE_SEED - a rerun of the generator reproduces it without reading any other file", () => {
    expect(manifest.seed).toBe(SAMPLE_SEED);
  });

  // The coordinator's own second pass, 2026-09-14: 35, not 30 - 30 from
  // the six type strata plus a dedicated 5-question abstention stratum,
  // because proportional representation alone left abstention ("the
  // answer is that nothing was said", the class mapping onto the
  // project's worst defect) measured by zero questions.
  test("5 per type plus a dedicated 5-question abstention stratum, 35 total", () => {
    expect(manifest.perClass).toBe(5);
    expect(manifest.abstentionStratumSize).toBe(5);
    expect(manifest.entries).toHaveLength(35);
  });

  test("drawn from the oracle set, not the S set", () => {
    expect(manifest.sourceDataset).toBe("longmemeval_oracle.json");
  });

  test("every one of the six question types has at least its own 5 non-abstention entries from its own type stratum", () => {
    const byType = new Map<string, number>();
    for (const e of manifest.entries) if (!e.isAbstention) byType.set(e.questionType, (byType.get(e.questionType) ?? 0) + 1);
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

  test("every entry's id is unique - the dedicated abstention stratum never repeats a type stratum's own pick", () => {
    const ids = manifest.entries.map((e) => e.questionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the per-type sampling rule is recorded, and each stratum's own math checks out against the entries actually chosen", () => {
    expect(manifest.samplingRule).toContain("proportional");
    expect(manifest.strata).toHaveLength(6);
    for (const s of manifest.strata) {
      expect(s.abstentionTarget).toBe(Math.min(Math.round(manifest.perClass * s.abstentionRate), s.abstentionPoolSize, manifest.perClass));
    }
  });

  test("the oracle set's own real per-type abstention rates are small enough that every type stratum rounds to zero abstention questions on its own - proportional, not forced", () => {
    expect(manifest.strata.every((s) => s.abstentionTarget === 0)).toBe(true);
  });

  // The fix this second pass makes: abstention is no longer measured by
  // zero, because the dedicated stratum exists independent of the
  // (correctly) zero per-type targets above.
  test("the dedicated abstention stratum is recorded and actually contributes real abstention questions to entries", () => {
    expect(manifest.abstentionStratum).toEqual({ poolSize: 30, target: 5 });
    const abstentionEntries = manifest.entries.filter((e) => e.isAbstention);
    expect(abstentionEntries).toHaveLength(5);
  });

  // fromAbstentionStratum is the one reliable way to tell which stratum
  // picked an entry - not questionType (a dedicated pick keeps its own
  // real type) and not isAbstention alone if a type stratum's own math
  // ever picks a nonzero abstentionTarget in the future.
  test("fromAbstentionStratum exactly identifies the dedicated stratum's own picks, matching abstentionStratum.target", () => {
    const marked = manifest.entries.filter((e) => e.fromAbstentionStratum);
    expect(marked).toHaveLength(manifest.abstentionStratum.target);
    expect(marked.every((e) => e.isAbstention)).toBe(true);
    expect(manifest.entries.filter((e) => !e.fromAbstentionStratum).every((e) => !e.isAbstention)).toBe(true);
  });
});
