// The secrets scan (`gitleaks dir`) reads the real filesystem, so every directory .gitignore names must also be skipped in .gitleaks.toml or
// a leftover scratch directory (a screenshot run's .demo-data-run-<token>-<id>/owner-pid) turns the gate red although it can never be committed.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const allowed = [...readFileSync(join(root, ".gitleaks.toml"), "utf8").matchAll(/'''(.+?)'''/g)].map((m) => new RegExp(m[1]!));
const skipped = (path: string): boolean => allowed.some((re) => re.test(path));

describe(".gitleaks.toml skips what .gitignore ignores", () => {
  test("a screenshot run's scratch directory, the demo data, the data directories and dependencies are skipped", () => {
    for (const path of [
      ".demo-data-run-039105f1-5337-4fc6-8797-cb0399a9adab-5d9a6d4c-eed1-4f61-8116-c6cb0296d73b/owner-pid",
      ".demo-data/hub.db",
      "data-scratch/reports/x.md",
      "data/models/x.gguf",
      "frontend/node_modules/x/index.js",
    ]) expect(skipped(path), path).toBe(true);
  });

  test("a real tracked directory whose name merely contains one of those words is still scanned", () => {
    for (const path of ["frontend/dist-preview/app.js", "backend/src/demo-data-tools/x.ts"]) expect(skipped(path), path).toBe(false);
  });
});
