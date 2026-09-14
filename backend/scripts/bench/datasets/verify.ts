#!/usr/bin/env bun
// Checks every file registry.json names against its own checksum. Never
// downloads (download.ts, its own separate command, does that): this is
// the read-only half, safe to run on a machine that has none of the raw
// data at all, or on CI, without triggering a multi-gigabyte fetch by
// accident.
//
// Usage: bun run backend/scripts/bench/datasets/verify.ts
import { existsSync, statSync } from "node:fs";
import { registryFiles, absolutePath } from "./registry";
// A code review caught this file's own first version hand-rolling a
// streamed sha256 that already exists here (the identical job for the
// identical reason: a downloaded file's checksum, streamed rather than
// buffered whole against real multi-hundred-megabyte-to-gigabyte
// files) - other bench scripts already import freely from @/lib/..., so
// reusing it is the org's own "one definition, one implementation" rule,
// not a new exception to "nothing under backend/src/" (reading an
// existing utility is not touching it).
import { sha256OfFile } from "@/lib/modelDownload";

async function main() {
  const entries = registryFiles();
  let missing = 0;
  let mismatched = 0;
  let ok = 0;

  for (const { dataset, file } of entries) {
    const path = absolutePath(file.path);
    if (!existsSync(path)) {
      console.log(`MISSING  ${dataset}: ${file.path}`);
      missing++;
      continue;
    }
    const size = statSync(path).size;
    const actual = await sha256OfFile(path);
    if (actual !== file.sha256) {
      console.log(`MISMATCH ${dataset}: ${file.path} (${size} bytes) - expected ${file.sha256}, got ${actual}`);
      mismatched++;
      continue;
    }
    console.log(`ok       ${dataset}: ${file.path} (${size} bytes)`);
    ok++;
  }

  console.log(`\n${ok} ok, ${missing} missing, ${mismatched} mismatched, ${entries.length} total.`);
  if (missing > 0) {
    console.log(`Missing files can be fetched with: bun run backend/scripts/bench/datasets/download.ts`);
  }
  if (mismatched > 0 || missing > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
