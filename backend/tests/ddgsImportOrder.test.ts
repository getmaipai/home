// SEARCH-DDGS-TEEN-01: settingsRegistry -> ddgsSource -> sourceMode -> settings -> settingsRegistry was an import
// cycle. `ddgsConfigured` now lives in ddgsConfig.ts, which imports nothing; each module below must load first in a
// fresh process, and ddgsConfig.ts must stay import-free so the cycle cannot come back.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

describe("ddgs module load order", () => {
  for (const mod of ["settingsRegistry", "retrieval/ddgsSource", "retrieval/sourceMode", "retrieval/webSources"]) {
    test(`${mod} loads first in a fresh process`, () => {
      const run = Bun.spawnSync([process.execPath, "-e", `await import("@/lib/${mod}"); console.log("ok")`], { cwd: root, stderr: "pipe", stdout: "pipe" });
      expect(run.stderr.toString()).toBe("");
      expect(run.stdout.toString().trim()).toBe("ok");
      expect(run.exitCode).toBe(0);
    });
  }
  test("ddgsConfig.ts imports nothing", () => {
    expect(readFileSync(join(root, "src/lib/retrieval/ddgsConfig.ts"), "utf8")).not.toMatch(/^\s*import\s/m);
  });
});
