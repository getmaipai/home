import { beforeAll, describe, expect, test } from "bun:test";
import { appLoadProblems } from "@/lib/apps";
import { __resetPackageCachesForTests, bundledPackageIds, loadManifestOnly } from "@/lib/plugins";
import { resetDb } from "../../tests/reset-db";

// PACKAGE-VANISH-01: the loader hides an app whose manifest or pages fail its checks, and nothing else tells anyone. This runs the loader's own
// check (appLoadProblems, the function `loadApp` fills at boot) over every bundled package, so a bad page or manifest fails here, naming the package.
describe("every bundled package loads", () => {
  // Bundled copies only: no installed update from another test file in the same process may stand in for them.
  beforeAll(() => { resetDb(); __resetPackageCachesForTests(); });
  const ids = bundledPackageIds();
  test("there are bundled packages to check", () => { expect(ids.length).toBeGreaterThan(10); });
  for (const id of ids) {
    test(`${id}: manifest and pages pass the loader's checks`, () => {
      const manifest = loadManifestOnly(id);
      expect(manifest.ok ? [] : [`${id}: manifest refused: ${manifest.error}`]).toEqual([]);
      expect((appLoadProblems(id) ?? []).map((problem) => `${id}: ${problem}`)).toEqual([]);
    });
  }
});
