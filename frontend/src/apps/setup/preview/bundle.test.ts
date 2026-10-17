import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
function buildAndAssertAbsent() {
  const outputDir = mkdtempSync(join(tmpdir(), "setup-preview-build-"));
  try {
    const result = spawnSync("bunx", ["vite", "build", "--outDir", outputDir, "--emptyOutDir"], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
    const files = readdirSync(outputDir, { recursive: true }).map(String);
    expect(files.some((file) => file.endsWith("mockServiceWorker.js"))).toBe(false);
    const js = files.filter((file) => file.endsWith(".js")).map((file) => readFileSync(join(outputDir, file), "utf8")).join("\n");
    expect(js).not.toContain("SETUP_PREVIEW_ONLY_MARKER_20261014");
    // BUNDLE-SPLIT-01: the PWA precache refuses a file over 4 MiB (vite.config.ts), which fails the build, so an install
    // that builds the frontend breaks. Warn at 3 MiB, while a split is still cheap; the Routes chunk was 2.3 MB after it.
    const big = files.filter((file) => file.endsWith(".js") && !file.startsWith("ort/") && !/ort\.bundle/.test(file))
      .map((file) => ({ file, bytes: statSync(join(outputDir, file)).size })).filter((entry) => entry.bytes > 3 * 1024 * 1024);
    expect(big).toEqual([]);
  } finally { rmSync(outputDir, { recursive: true, force: true }); }
}

describe("production bundle excludes setup preview", () => {
  test("the absence check fails when its marker is planted, then production output is clean", () => {
    const temp = mkdtempSync(join(tmpdir(), "setup-preview-marker-"));
    try {
      const file = join(temp, "chunk.js");
      writeFileSync(file, "SETUP_PREVIEW_ONLY_MARKER_20261014");
      expect(() => expect(readFileSync(file, "utf8")).not.toContain("SETUP_PREVIEW_ONLY_MARKER_20261014")).toThrow();
      buildAndAssertAbsent();
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }, 120_000);
});
