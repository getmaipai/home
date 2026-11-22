import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorkspaceDir, readWorkspaceFile, WorkspacePathError } from "@/lib/workspaceFs";

let base = ""; let root = ""; let outside = "";
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "ws-fs-"));
  root = join(base, "workspace"); outside = join(base, "outside");
  mkdirSync(join(root, "src"), { recursive: true }); mkdirSync(outside);
  writeFileSync(join(root, "src", "a.txt"), "inside"); writeFileSync(join(outside, "secret.txt"), "TOP SECRET");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test("a normal file inside the workspace reads", async () => {
  expect((await readWorkspaceFile(root, "src/a.txt")).toString()).toBe("inside");
});
test("an outward symlink to a file is refused and the secret is not read", async () => {
  symlinkSync(join(outside, "secret.txt"), join(root, "leak.txt"));
  const err = await readWorkspaceFile(root, "leak.txt").catch((e) => e);
  expect(err).toBeInstanceOf(WorkspacePathError);
  expect(String(err.message)).not.toContain("TOP SECRET");
});
test("a symlinked directory that leaves the root is refused for any file under it", async () => {
  symlinkSync(outside, join(root, "src", "out"));
  expect(await readWorkspaceFile(root, "src/out/secret.txt").catch((e) => e)).toBeInstanceOf(WorkspacePathError);
});
test("dot-dot, absolute and NUL paths are refused", async () => {
  for (const bad of ["../outside/secret.txt", join(outside, "secret.txt"), "src/a.txt\0x"]) expect(await readWorkspaceFile(root, bad).catch((e) => e)).toBeInstanceOf(WorkspacePathError);
});
test("a link to a file inside the workspace is refused too (the final link is never followed)", async () => {
  symlinkSync(join(root, "src", "a.txt"), join(root, "alias.txt"));
  expect(await readWorkspaceFile(root, "alias.txt").catch((e) => e)).toBeInstanceOf(WorkspacePathError);
});
test("listing marks links and never follows them", async () => {
  symlinkSync(outside, join(root, "out"));
  const names = await listWorkspaceDir(root);
  expect(names.find((e) => e.name === "out")?.kind).toBe("link");
  expect(await listWorkspaceDir(root, "out").catch((e) => e)).toBeInstanceOf(WorkspacePathError);
});
