#!/usr/bin/env bun
// Regenerates sample-manifest.json from the downloaded S set. Committed
// output (the manifest, ids only), not run at build time - the same
// "regenerate and commit the result" shape spec/'s own gen-ts.ts and
// gen-py.sh use. Deterministic: re-running this against the same S set
// reproduces byte-identical ids, since sample.ts's own seed is a fixed
// constant.
//
// Usage: bun run backend/scripts/bench/datasets/generate-sample-manifest.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadLongMemEval } from "./longmemeval";
import { selectLongMemEvalSample } from "./sample";
import { absolutePath } from "./registry";

function main() {
  const raw = JSON.parse(readFileSync(absolutePath("longmemeval_s_cleaned.json"), "utf-8")) as unknown[];
  const { questions } = loadLongMemEval(raw);
  const manifest = selectLongMemEvalSample(questions);

  const byType = new Map<string, number>();
  for (const entry of manifest) byType.set(entry.questionType, (byType.get(entry.questionType) ?? 0) + 1);

  const outPath = join(import.meta.dir, "sample-manifest.json");
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${manifest.length} sampled ids to ${outPath}`);
  for (const [type, count] of byType) console.log(`  ${type}: ${count}`);
}

main();
