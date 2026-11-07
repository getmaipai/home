import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

test("the codemod rewrites JSX text and a string prop with ids equal to the English text, and the result still parses", () => {
  const dir = mkdtempSync(join(tmpdir(), "maipai-codemod-"));
  try {
    const file = join(dir, "fixture.tsx");
    copyFileSync("src/dev/i18n-codemod.fixture.tsx", file);
    const run = spawnSync("bun", ["scripts/i18n-codemod.ts", "--", file], { encoding: "utf8" });
    expect(run.status).toBe(0);
    const out = readFileSync(file, "utf8");
    expect(out).toContain('<Trans id="Save changes" message="Save changes" />');
    expect(out).toContain('i18n._({ id: "Save changes", message: "Save changes" })');
    const parsed = ts.transpileModule(out, { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve }, fileName: "fixture.tsx" });
    expect(parsed.diagnostics?.length ?? 0).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
