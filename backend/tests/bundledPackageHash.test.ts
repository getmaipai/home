import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPackageDir } from "@/lib/bundledPackages";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maipai-bundled-hash-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("hashPackageDir", () => {
  test("is deterministic across repeated calls", () => {
    writeFileSync(join(dir, "manifest.json"), '{"id":"fixture"}');
    expect(hashPackageDir(dir)).toBe(hashPackageDir(dir));
  });

  test("changes when a file's content changes", () => {
    writeFileSync(join(dir, "manifest.json"), '{"id":"fixture"}');
    const before = hashPackageDir(dir);
    writeFileSync(join(dir, "manifest.json"), '{"id":"fixture-edited"}');
    expect(hashPackageDir(dir)).not.toBe(before);
  });

  test("changes when a file is added, even with identical total content", () => {
    writeFileSync(join(dir, "manifest.json"), '{"id":"fixture"}');
    const before = hashPackageDir(dir);
    writeFileSync(join(dir, "README.md"), "");
    expect(hashPackageDir(dir)).not.toBe(before);
  });

  test("changes when a file is renamed, even with identical content", () => {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "smoke.json"), "{}");
    const before = hashPackageDir(dir);
    rmSync(join(dir, "tests", "smoke.json"));
    writeFileSync(join(dir, "tests", "renamed.json"), "{}");
    expect(hashPackageDir(dir)).not.toBe(before);
  });

  test("is independent of the host filesystem's own directory-listing order", () => {
    writeFileSync(join(dir, "zzz.txt"), "z");
    writeFileSync(join(dir, "aaa.txt"), "a");
    const first = hashPackageDir(dir);

    const dir2 = mkdtempSync(join(tmpdir(), "maipai-bundled-hash-test-"));
    try {
      writeFileSync(join(dir2, "aaa.txt"), "a");
      writeFileSync(join(dir2, "zzz.txt"), "z");
      expect(hashPackageDir(dir2)).toBe(first);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  // A Dirent's isFile()/isDirectory() never follow a symlink - without
  // this check a symlink entry answers false to both and is silently
  // skipped, so swapping its target (or adding/removing it) would be
  // invisible to the hash even though catalog's own pack.ts refuses to
  // pack a symlink at all (found by code review).
  test("refuses a package directory containing a symlink", () => {
    writeFileSync(join(dir, "manifest.json"), '{"id":"fixture"}');
    symlinkSync("/etc/passwd", join(dir, "evil-link"));
    expect(() => hashPackageDir(dir)).toThrow("may not contain symlinks");
  });
});
