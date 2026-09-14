#!/usr/bin/env bun
// EVAL-07 replay, baseline v0 (the coordinator's own sizing, 2026-09-14):
// the first oracle question ids ever get judged against are a small,
// fixed sample, not the full 500 - the measured per-question rate
// (haystack-size dependent, seen live at 142s-601s) makes the full set
// a many-hour run that can't sit on the machine while other engine
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
// Uses selectBaselineV0Sample, not selectStratifiedLongMemEvalSample
// directly: the first version of this manifest used
// selectLongMemEvalSample (built for the 40-per-class S-set sample,
// abstention prioritized ahead of the rest of its class), which at
// 5-per-class made several classes come out entirely abstention. The
// second version fixed that with proportional-by-rate stratification,
// which for this oracle set's own real per-type rates (roughly
// 4.5%-9%) rounds to ZERO abstention questions in every class - honest
// per-type math, but it meant v0 measured nothing on abstention, "the
// answer is that nothing was said", the class the coordinator named as
// mapping onto the project's worst defect. selectBaselineV0Sample keeps
// that same per-type proportional rule (unchanged) and adds a seventh,
// dedicated abstention stratum on top, drawn from the whole source set
// regardless of type - 35 total at the default sizing, not 30. Both the
// per-type rule and the dedicated stratum's own math are recorded in
// the manifest (`samplingRule`, `strata`, `abstentionStratum`), not
// just implied by which ids got picked.
//
// Usage: bun run backend/scripts/bench/datasets/generate-oracle-v0-manifest.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadLongMemEval } from "./longmemeval";
import { selectBaselineV0Sample, SAMPLE_SEED } from "./sample";
import { absolutePath } from "./registry";

const PER_CLASS = 5;
const ABSTENTION_STRATUM_SIZE = 5;

function main() {
  const raw = JSON.parse(readFileSync(absolutePath("longmemeval_oracle.json"), "utf-8")) as unknown[];
  const { questions } = loadLongMemEval(raw);
  const { entries, strata, abstentionStratum } = selectBaselineV0Sample(questions, PER_CLASS, ABSTENTION_STRATUM_SIZE, SAMPLE_SEED);

  // The seed is recorded IN the manifest, not only implied by sample.ts's
  // own SAMPLE_SEED constant matching by coincidence (the coordinator's
  // own requirement: "so it reruns identically") - a reader of this file
  // alone can reproduce the exact selection without reading the code that
  // made it.
  const manifest = {
    seed: SAMPLE_SEED,
    perClass: PER_CLASS,
    abstentionStratumSize: ABSTENTION_STRATUM_SIZE,
    sourceDataset: "longmemeval_oracle.json",
    samplingRule:
      "each of the six question types draws its own 5 with abstention proportional to that type's real abstention rate in the source set (round(perClass * rate), clamped to the pool), never prioritized ahead of it - see strata for the computed rate and target per class. A seventh, dedicated abstention stratum then draws up to 5 more abstention questions from the whole source set regardless of type, excluding any id a type stratum already picked - see abstentionStratum.",
    strata,
    abstentionStratum,
    entries,
  };

  const outPath = join(import.meta.dir, "oracle-v0-manifest.json");
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${entries.length} sampled ids (seed ${SAMPLE_SEED}) to ${outPath}`);
  for (const s of strata) console.log(`  ${s.questionType}: ${s.abstentionTarget} abstention (rate ${s.abstentionRate}) of ${PER_CLASS}`);
  console.log(`  abstention stratum: ${abstentionStratum.target} of a pool of ${abstentionStratum.poolSize}`);
}

main();
