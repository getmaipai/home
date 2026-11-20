import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const helper = join(import.meta.dir, "maipai-prune-rollbacks");
const root = mkdtempSync(join(tmpdir(), "maipai-rollback-helper-"));
const bin = join(root, "bin");
mkdirSync(bin);
const fakeId = join(bin, "id");
writeFileSync(fakeId, "#!/bin/sh\necho 0\n");
chmodSync(fakeId, 0o755);
afterAll(() => rmSync(root, { recursive: true, force: true }));
function run(...args: string[]) { return Bun.spawnSync(["bash", helper, ...args], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MAIPAI_PRUNE_TEST_ROOT: root } }); }

describe("rollback pruning helper", () => {
  test("lists names and byte sizes", () => {
    mkdirSync(join(root, "data.rolled-back-20261118-000000"));
    const result = run("list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toMatch(/^data\.rolled-back-20261118-000000\t\d+\n$/);
  });
  test("refuses names outside the exact rollback directory shape", () => {
    for (const name of ["other", "data.rolled-back-2026/11", "data.rolled-back-..", "data.rolled-back-2026-../x"]) {
      expect(run("prune", name).exitCode).not.toBe(0);
    }
  });
  test("refuses symlinks", () => {
    symlinkSync("data.rolled-back-20261118-000000", join(root, "data.rolled-back-20261117-000000"));
    expect(run("prune", "data.rolled-back-20261117-000000").exitCode).not.toBe(0);
  });
  test("refuses to remove either of the newest two copies", () => {
    for (const name of ["20261120-000001", "20261120-000002", "20261120-000003"]) mkdirSync(join(root, `data.rolled-back-${name}`));
    expect(run("prune", "data.rolled-back-20261120-000003").exitCode).not.toBe(0);
    expect(run("prune", "data.rolled-back-20261120-000002").exitCode).not.toBe(0);
    expect(existsSync(join(root, "data.rolled-back-20261120-000003"))).toBe(true);
  });
  test("removes copies older than the newest two", () => {
    for (const name of ["20261121-000001", "20261121-000002", "20261121-000003", "20261121-000004"]) mkdirSync(join(root, `data.rolled-back-${name}`));
    // everything from earlier tests is older than these four, so only the two newest are protected
    expect(run("prune", "data.rolled-back-20261121-000001").exitCode).toBe(0);
    expect(existsSync(join(root, "data.rolled-back-20261121-000001"))).toBe(false);
    expect(existsSync(join(root, "data.rolled-back-20261121-000004"))).toBe(true);
  });
});
