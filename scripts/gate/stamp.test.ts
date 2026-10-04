import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashInputs, stampMatches, writeStamp } from "./stamp";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "maipai-stamp-"));
  dirs.push(dir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  mkdirSync(join(dir, "frontend"));
  writeFileSync(join(dir, "frontend", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "frontend", "a.test.ts"), "// test\n");
  return dir;
}

describe("stamps", () => {
  test("the same inputs hash the same, and a matching stamp lets the step skip", () => {
    const dir = repo();
    const h = hashInputs(dir, ["frontend"]);
    expect(stampMatches(dir, "a11y", h)).toBe(false);
    writeStamp(dir, "a11y", h);
    expect(stampMatches(dir, "a11y", hashInputs(dir, ["frontend"]))).toBe(true);
  });

  test("changing one input byte invalidates the stamp", () => {
    const dir = repo();
    writeStamp(dir, "a11y", hashInputs(dir, ["frontend"]));
    writeFileSync(join(dir, "frontend", "a.ts"), "export const a = 2;\n");
    expect(stampMatches(dir, "a11y", hashInputs(dir, ["frontend"]))).toBe(false);
  });

  test("a new untracked input invalidates it too", () => {
    const dir = repo();
    writeStamp(dir, "a11y", hashInputs(dir, ["frontend"]));
    writeFileSync(join(dir, "frontend", "b.ts"), "export {};\n");
    expect(stampMatches(dir, "a11y", hashInputs(dir, ["frontend"]))).toBe(false);
  });

  test("an excluded path (a test file) does not invalidate it, a source file still does", () => {
    const dir = repo();
    const specs = ["frontend", ":!**/*.test.ts"];
    writeStamp(dir, "build", hashInputs(dir, specs));
    writeFileSync(join(dir, "frontend", "a.test.ts"), "// edited test\n");
    expect(stampMatches(dir, "build", hashInputs(dir, specs))).toBe(true);
    writeFileSync(join(dir, "frontend", "a.ts"), "export const a = 3;\n");
    expect(stampMatches(dir, "build", hashInputs(dir, specs))).toBe(false);
  });

  test("an untracked symlink to a directory (a linked node_modules) is hashed, not read", () => {
    const dir = repo();
    symlinkSync(tmpdir(), join(dir, "frontend", "node_modules"));
    expect(() => hashInputs(dir, ["frontend"])).not.toThrow();
  });

  test("a stamp for one step never satisfies another", () => {
    const dir = repo();
    writeStamp(dir, "build", hashInputs(dir, ["frontend"]));
    expect(stampMatches(dir, "a11y", hashInputs(dir, ["frontend"]))).toBe(false);
  });
});
