import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installedLockMismatches } from "./installedLock";

test("installed package versions must occur in bun.lock and mismatches name the package", () => {
  const root = mkdtempSync(join(tmpdir(), "maipai-installed-lock-"));
  const packageDir = join(root, "node_modules", ".bun", "typescript@5.9.3", "node_modules", "typescript");
  mkdirSync(packageDir, { recursive: true });
  const lock = JSON.stringify({ packages: { typescript: ["typescript@5.9.3", "", {}] } });
  try {
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "typescript", version: "5.9.3" }));
    expect(installedLockMismatches(root, lock)).toEqual([]);
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "typescript", version: "5.9.2" }));
    expect(installedLockMismatches(root, lock)).toEqual(["installed typescript@5.9.2 does not match bun.lock (locked: 5.9.3)"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing node_modules tree fails preflight with a locked package name", () => {
  const root = mkdtempSync(join(tmpdir(), "maipai-installed-lock-empty-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { zod: "^4.0.0" } }));
    expect(installedLockMismatches(root, JSON.stringify({ packages: { zod: ["zod@4.6.5", "", {}] } }))).toContain(
      "missing installed zod required by root",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
