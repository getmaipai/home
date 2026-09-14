#!/usr/bin/env bun
// EVAL-07 replay, baseline v0 (the coordinator's own sizing, 2026-09-14):
// the first oracle question ids ever get judged against are 5 per
// question type, 30 total, not the full 500 - the measured per-question
// rate (haystack-size dependent, seen live at 142s-601s) makes the full
// set a many-hour run that can't sit on the machine while other engine
// items are landing. Later samples grow (10 per type, then the 230-id S
// sample) in their own overnight slots; this is the smallest rung.
//
// Same generator shape as generate-sample-manifest.ts (regenerate and
// commit the result, never run at request time), over the ORACLE set
// instead of the S set - the oracle set is the eval target itself, not
// a corpus this project samples prompts or tuning data from, so no
// held-out concern applies here the way sample.ts's own S-set doc note
// describes.
//
// Usage: bun run backend/scripts/bench/datasets/generate-oracle-v0-manifest.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadLongMemEval } from "./longmemeval";
import { selectLongMemEvalSample, SAMPLE_SEED } from "./sample";
import { absolutePath } from "./registry";

const PER_CLASS = 5;

function main() {
  const raw = JSON.parse(readFileSync(absolutePath("longmemeval_oracle.json"), "utf-8")) as unknown[];
  const { questions } = loadLongMemEval(raw);
  const entries = selectLongMemEvalSample(questions, PER_CLASS, SAMPLE_SEED);

  const byType = new Map<string, number>();
  for (const entry of entries) byType.set(entry.questionType, (byType.get(entry.questionType) ?? 0) + 1);

  // The seed is recorded IN the manifest, not only implied by sample.ts's
  // own SAMPLE_SEED constant matching by coincidence (the coordinator's
  // own requirement: "so it reruns identically") - a reader of this file
  // alone can reproduce the exact selection without reading the code that
  // made it.
  const manifest = { seed: SAMPLE_SEED, perClass: PER_CLASS, sourceDataset: "longmemeval_oracle.json", entries };

  const outPath = join(import.meta.dir, "oracle-v0-manifest.json");
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${entries.length} sampled ids (seed ${SAMPLE_SEED}) to ${outPath}`);
  for (const [type, count] of byType) console.log(`  ${type}: ${count}`);
}

main();
