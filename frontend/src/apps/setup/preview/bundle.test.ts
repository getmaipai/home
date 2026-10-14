import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
function buildAndAssertAbsent() {
  const result = spawnSync("bun", ["run", "build"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  const dist = join(root, "dist");
  const files = readdirSync(dist, { recursive: true }).map(String);
  expect(files.some((file) => file.endsWith("mockServiceWorker.js"))).toBe(false);
  const js = files.filter((file) => file.endsWith(".js")).map((file) => readFileSync(join(dist, file), "utf8")).join("\n");
  expect(js).not.toContain("SETUP_PREVIEW_ONLY_MARKER_20261014");
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
