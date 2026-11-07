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
    expect(out).not.toContain("<Trans");
    expect(out).toContain('>{i18n._({ id: "Save changes", message: "Save changes" })}</button>');
    expect(out).toContain('title={i18n._({ id: "Save changes", message: "Save changes" })}');
    // Text around an expression becomes one message with a placeholder; the space before it stays outside; wrapped lines fold to one space.
    expect(out).toContain('<p>{i18n._({ id: "Hello", message: "Hello" })} <b>{name}</b>{" "}{i18n._({ id: "and {other} are here, and this wraps & folds.", message: "and {other} are here, and this wraps & folds.", values: { other } })}</p>');
    expect(out).toContain('{ok ? i18n._({ id: "Yes please", message: "Yes please" }) : i18n._({ id: "No thanks", message: "No thanks" })}');
    expect(out).toContain('toast.error(i18n._({ id: "Could not save", message: "Could not save" }))');
    expect(out).toContain('setError(i18n._({ id: "Try again", message: "Try again" }))');
    expect(out.indexOf('import { i18n } from "@lingui/core";')).toBe(0);
    const parsed = ts.transpileModule(out, { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve }, fileName: "fixture.tsx" });
    expect(parsed.diagnostics?.length ?? 0).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
