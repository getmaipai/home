import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GENERATED_PATH, generatedIsCurrent } from "./extract-setting-copy";

test("the committed setting copy matches the registry, and a stale copy is detected", () => {
  expect(generatedIsCurrent()).toBe(true);
  const dir = mkdtempSync(join(tmpdir(), "maipai-setting-copy-"));
  try {
    const stale = join(dir, "stale.ts");
    writeFileSync(stale, readFileSync(GENERATED_PATH, "utf8").replace("export const SETTING_COPY", "// a key was added\nexport const SETTING_COPY"));
    expect(generatedIsCurrent(stale)).toBe(false);
    expect(generatedIsCurrent(join(dir, "missing.ts"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
