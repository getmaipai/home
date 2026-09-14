// Baseline v0's own committed manifest (generate-oracle-v0-manifest.ts):
// the same "committed metadata checked, live download never required"
// shape datasetsRegistry.test.ts already uses for registry.json - the
// oracle set itself is gitignored (data-scratch/datasets/), so a test
// here reads only what this repo actually tracks.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_SEED } from "../scripts/bench/datasets/sample";

interface OracleV0Manifest {
  seed: number;
  perClass: number;
  sourceDataset: string;
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
});
