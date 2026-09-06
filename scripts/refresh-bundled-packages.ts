#!/usr/bin/env bun
// Refreshes home's own checked-in copy of the bundled default packages
// from their canonical source in the sibling `catalog` checkout
// (session-d-packages-and-store.md step 6, docs/dev.md's own review
// note: "define, joke, trivia, weather, knowledge, and storytime-style
// move from home's backend/packages/ to their catalog home as canonical
// source... home keeps a signed copy of the default set under
// backend/packages/"). Run this after editing a bundled package in
// catalog, never hand-edit backend/packages/<id>/ directly - the next
// `bun test` catches a hand-edit immediately
// (tests/bundledPackages.test.ts compares against the provenance this
// script just wrote).
import { rmSync, cpSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
// A relative import, not the `@/` alias: that alias is scoped to the
// backend workspace's own tsconfig, and this script runs from the repo
// root (package.json's own "screenshots" script is the precedent for a
// plain, alias-free root-level script).
import { hashPackageDir, isDirectory, type BundledProvenance } from "../backend/src/lib/bundledPackages";

// id -> its own directory inside the catalog repo, matching the actual
// migration commit (getmaipai/catalog@60788f1). Extend this list only
// once a package has actually moved to catalog and cleared bronze there
// (docs/dev.md's own review note names which ones haven't yet).
const BUNDLED: { id: string; catalogPath: string }[] = [
  { id: "define", catalogPath: "plugins/utilities/define" },
  { id: "joke", catalogPath: "plugins/fun/joke" },
  { id: "knowledge", catalogPath: "plugins/info/knowledge" },
  { id: "trivia", catalogPath: "plugins/fun/trivia" },
  { id: "weather", catalogPath: "plugins/utilities/weather" },
  { id: "storytime-style", catalogPath: "skills/family/storytime-style" },
];

const HOME_ROOT = join(import.meta.dir, "..");
const PACKAGES_DIR = join(HOME_ROOT, "backend", "packages");
const CATALOG_DIR = process.env.MAIPAI_CATALOG_DIR ?? join(HOME_ROOT, "..", "catalog");

function catalogSourceCommit(catalogPackageDir: string): string {
  try {
    const head = execFileSync("git", ["-C", catalogPackageDir, "rev-parse", "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const dirty =
      execFileSync("git", ["-C", catalogPackageDir, "status", "--porcelain", "--", "."], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().length > 0;
    return dirty ? `${head}-dirty` : head;
  } catch {
    return "unknown";
  }
}

function main(): void {
  if (!isDirectory(CATALOG_DIR)) {
    console.error(
      `no catalog checkout at ${CATALOG_DIR} - set MAIPAI_CATALOG_DIR, or check out getmaipai/catalog as a sibling of this repo`,
    );
    process.exit(1);
  }

  const provenance: BundledProvenance = {};

  for (const { id, catalogPath } of BUNDLED) {
    const catalogPackageDir = join(CATALOG_DIR, catalogPath);
    if (!isDirectory(catalogPackageDir)) {
      console.error(`${id}: no such package at ${catalogPackageDir} in the catalog checkout`);
      process.exit(1);
    }

    // Copy into a staging directory FIRST, and only remove the existing
    // checked-in copy once that copy has fully succeeded (found by code
    // review: the previous version deleted the working copy before
    // knowing the new one would land, so a mid-copy failure - a bad
    // permission, a disk that fills - left the repo with an empty or
    // half-copied package and no provenance entry for it, discoverable
    // only by noticing the diff or running tests).
    const homePackageDir = join(PACKAGES_DIR, id);
    const stagingDir = `${homePackageDir}.refresh-staging`;
    rmSync(stagingDir, { recursive: true, force: true });
    cpSync(catalogPackageDir, stagingDir, { recursive: true });
    rmSync(homePackageDir, { recursive: true, force: true });
    renameSync(stagingDir, homePackageDir);

    provenance[id] = {
      sha256: hashPackageDir(homePackageDir),
      source_commit: catalogSourceCommit(catalogPackageDir),
      catalog_path: catalogPath,
    };
    console.log(`${id}: refreshed from ${catalogPath} (${provenance[id]!.source_commit})`);
  }

  const sorted: BundledProvenance = {};
  for (const id of Object.keys(provenance).sort()) sorted[id] = provenance[id]!;
  const provenancePath = join(PACKAGES_DIR, "bundled-provenance.json");
  writeFileSync(provenancePath, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`wrote ${provenancePath}`);
}

main();
