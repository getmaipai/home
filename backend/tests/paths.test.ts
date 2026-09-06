import { describe, expect, test } from "bun:test";
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
