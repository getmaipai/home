#!/usr/bin/env bun
// Fetches a missing dataset file at its registry.json-pinned URL, then
// verifies it against the pinned checksum before keeping it - download,
// never vendor (org rule): nothing here is committed, and a file that
// fails its checksum is deleted rather than left in a half-trusted
// state. Only ever downloads a file verify.ts reports missing; never
// runs on its own (verify.ts's own header).
//
// The `download` URLs in registry.json were reconstructed from
// SOURCES.md's own documented hosts (the URL this repo's own 2026-09-14
// download actually used is not separately recorded per-file). A code
// review independently curled all 21 the same day and found every one
// live (HTTP 200) - a broken one from here on is real drift to fix in
// registry.json, not an unverified guess from the start.
//
// Usage: bun run backend/scripts/bench/datasets/download.ts [dataset-name...]
// With no arguments, fetches every missing file across every dataset.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { loadRegistry, absolutePath, type RegistryEntry } from "./registry";
// A code review caught the first version of this fix hand-rolling a
// second streamed sha256 identical to this one (verify.ts's own
// comment has the full reasoning).
import { sha256OfFile } from "@/lib/modelDownload";

async function downloadOne(dataset: RegistryEntry, relPath: string, url: string, expectedSha256: string): Promise<void> {
  const path = absolutePath(relPath);
  if (existsSync(path)) {
    console.log(`skip     ${dataset.name}: ${relPath} already present`);
    return;
  }
  console.log(`fetching ${dataset.name}: ${relPath} <- ${url}`);
  mkdirSync(dirname(path), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  await Bun.write(path, res);
  const actual = await sha256OfFile(path);
  if (actual !== expectedSha256) {
    rmSync(path, { force: true });
    throw new Error(`${relPath}: checksum mismatch after download (expected ${expectedSha256}, got ${actual}) - deleted, not kept`);
  }
  console.log(`ok       ${dataset.name}: ${relPath} verified`);
}

async function main() {
  const wanted = new Set(process.argv.slice(2));
  const registry = loadRegistry().filter((d) => wanted.size === 0 || wanted.has(d.name));
  if (wanted.size > 0 && registry.length === 0) {
    throw new Error(`no registry entry matches: ${[...wanted].join(", ")}`);
  }

  for (const dataset of registry) {
    const byPath = new Map(dataset.files.map((f) => [f.path, f.sha256]));
    for (const { path, url } of dataset.download) {
      const sha256 = byPath.get(path);
      if (!sha256) throw new Error(`${dataset.name}: download entry for ${path} has no matching files[] checksum`);
      await downloadOne(dataset, path, url, sha256);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
