// Lane 12 item 4. registry.json's own internal consistency - the same
// reasoning spec/'s relationship-vocab.test.ts already applies to its
// own vocabulary file, here for the dataset registry: untested data
// drifts silently.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry, registryEntry, registryFiles, absolutePath } from "../scripts/bench/datasets/registry";

const DATASETS_DIR = join(import.meta.dir, "..", "scripts", "bench", "datasets");

describe("registry.json", () => {
  test("every dataset name is unique", () => {
    const names = loadRegistry().map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every file's sha256 looks like a real sha256 (64 lowercase hex characters)", () => {
    for (const { dataset, file } of registryFiles()) {
      expect(file.sha256, `${dataset}: ${file.path}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("every download entry's path matches a real files[] entry with the same checksum to verify against", () => {
    for (const entry of loadRegistry()) {
      const byPath = new Map(entry.files.map((f) => [f.path, f.sha256]));
      for (const dl of entry.download) {
        expect(byPath.has(dl.path), `${entry.name}: download path ${dl.path} has no matching files[] entry`).toBe(true);
      }
    }
  });

  test("every download URL is https", () => {
    for (const entry of loadRegistry()) {
      for (const dl of entry.download) {
        expect(dl.url.startsWith("https://"), `${entry.name}: ${dl.path}`).toBe(true);
      }
    }
  });

  test("a named loader module exists in this directory", () => {
    for (const entry of loadRegistry()) {
      if (entry.loader === null) continue;
      expect(existsSync(join(DATASETS_DIR, entry.loader)), `${entry.name}: loader ${entry.loader}`).toBe(true);
    }
  });

  test("longmemeval-cleaned resolves to a real loader (the S and oracle files this item's own loader reads)", () => {
    const entry = registryEntry("longmemeval-cleaned");
    expect(entry.loader).toBe("longmemeval.ts");
    expect(entry.files.map((f) => f.path).sort()).toEqual(["longmemeval_oracle.json", "longmemeval_s_cleaned.json"]);
  });

  test("an unknown dataset name throws rather than returning undefined", () => {
    expect(() => registryEntry("not-a-real-dataset")).toThrow(/no registry entry named/);
  });

  test("absolutePath resolves against home/data-scratch/datasets, not the repo tree", () => {
    const resolved = absolutePath("locomo10.json");
    expect(resolved.endsWith("/data-scratch/datasets/locomo10.json")).toBe(true);
    expect(resolved.includes("/backend/")).toBe(false);
  });
});
