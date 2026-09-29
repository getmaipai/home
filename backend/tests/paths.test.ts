import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { tier1PackageDataDir, installedPackageVersionDir, installStagingDir } from "@/lib/paths";

// A Tier 1 package's Deno sandbox gets --allow-read on its own source
// PLUS its writable data dir, but --allow-write on the data dir alone
// (lib/denoHost.ts's buildDenoRunArgs). That guarantee - "can never
// write into its own source tree" - only holds if the writable data
// dir is never a PARENT of a store-installed version's own source
// directory. A real gap found by code review: tier1PackageDataDir used
// to be `data/packages/<id>/` directly, and installedPackageVersionDir
// nested `versions/<version>/` INSIDE that same directory, making a
// store-installed Tier 1 package's source a subdirectory of its own
// writable grant. Fixed by giving tier1PackageDataDir its own `state/`
// subdirectory, a true sibling of `versions/` and `.staging/` - this
// test pins that relationship so it can never silently regress.
describe("data/packages/<id>/ subdirectories never nest inside one another", () => {
  const id = "test-package";
  const version = "1.0.0";

  test("a Tier 1 package's writable state dir is not a parent of its installed source dir", () => {
    const state = tier1PackageDataDir(id);
    const source = installedPackageVersionDir(id, version);
    expect(source.startsWith(`${state}/`)).toBe(false);
    expect(state.startsWith(`${source}/`)).toBe(false);
  });

  test("the install staging dir is not a parent of the writable state dir either", () => {
    const state = tier1PackageDataDir(id);
    const staging = installStagingDir(id);
    expect(state.startsWith(`${staging}/`)).toBe(false);
    expect(staging.startsWith(`${state}/`)).toBe(false);
  });

  test("the install staging dir is not a parent of the installed source dir", () => {
    const source = installedPackageVersionDir(id, version);
    const staging = installStagingDir(id);
    expect(source.startsWith(`${staging}/`)).toBe(false);
    expect(staging.startsWith(`${source}/`)).toBe(false);
  });
});

// SINGLE-INSTANCE-01 (#194): a hub started by hand from the repo root
// (`bun backend/src/index.ts`) resolved `../data` against the shell's
// cwd and silently became a brand-new hub in the org folder. The default
// data directory is anchored to the source file, never the cwd.
describe("the default data directory does not depend on the working directory", () => {
  const pathsFile = join(import.meta.dir, "../src/lib/paths.ts");
  const repoData = resolve(import.meta.dir, "../../data");

  async function dataDirFrom(cwd: string, env: Record<string, string | undefined>): Promise<string> {
    const child = Bun.spawn(
      [process.execPath, "-e", `import { dataDir } from ${JSON.stringify(pathsFile)}; console.log(dataDir);`],
      { cwd, env: { ...process.env, MAIPAI_DATA_DIR: undefined, ...env }, stdout: "pipe", stderr: "pipe" },
    );
    const out = await new Response(child.stdout).text();
    await child.exited;
    return out.trim();
  }

  test("repo root, backend, and an unrelated directory all resolve to <repo>/data", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "maipai-cwd-"));
    try {
      for (const cwd of [resolve(import.meta.dir, "../.."), resolve(import.meta.dir, ".."), elsewhere]) {
        expect(await dataDirFrom(cwd, {})).toBe(repoData);
      }
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test("MAIPAI_DATA_DIR still overrides, and an empty value is treated as unset", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "maipai-cwd-"));
    try {
      expect(await dataDirFrom(elsewhere, { MAIPAI_DATA_DIR: "/tmp/maipai-explicit" })).toBe("/tmp/maipai-explicit");
      expect(await dataDirFrom(elsewhere, { MAIPAI_DATA_DIR: "" })).toBe(repoData);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
