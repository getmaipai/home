// Guard (2026-11-13): every page the hub serves must pass the kit's page schema, the same PageNodeSchema the frontend runs in PackageAppPage.tsx.
// A 12-chip Video Create bar passed every JSON test and then showed "Could not open this app" because nothing validated the served page.
import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGES_DIR } from "@/lib/paths";
import { listPackageIds } from "@/lib/plugins";
import { PageNodeSchema } from "@/kit/schema/types";
import { resetDb } from "./reset-db";
import { household } from "./fixtures/adultLock";

/** Pages that fail today. Each line: "<package>/<page> for <band>", then the reason and an expiry. The test passes while the list names them. */
const KNOWN_BROKEN: Array<{ page: string; reason: string }> = [];

beforeEach(() => resetDb());

function pageIds(packageId: string): string[] {
  try {
    const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, packageId, "manifest.json"), "utf8")) as { contributes?: { pages?: Array<{ id: string }> } };
    return (manifest.contributes?.pages ?? []).map((page) => page.id);
  } catch {
    return [];
  }
}

test("every served package page passes the kit page schema for an adult, a teen and a child", async () => {
  const { owner, teen, child } = await household();
  const bands = [["adult", owner], ["teen", teen.client], ["child", child.client]] as const;
  const failures: string[] = [];
  let checked = 0;
  for (const packageId of listPackageIds().sort()) {
    for (const pageId of pageIds(packageId)) {
      for (const [band, client] of bands) {
        const res = await client.get(`/api/plugins/${packageId}/pages/${pageId}`);
        if (res.status === 403 || res.status === 404) continue; // this band may not open the page
        const label = `${packageId}/${pageId} for ${band}`;
        if (res.status !== 200) { failures.push(`${label}: status ${res.status}`); continue; }
        checked += 1;
        const parsed = PageNodeSchema.safeParse(await res.json());
        if (!parsed.success) for (const issue of parsed.error.issues.slice(0, 3)) failures.push(`${label}: ${issue.path.join(".")}: ${issue.message}`);
      }
    }
  }
  expect(checked).toBeGreaterThan(20);
  const known = (line: string) => KNOWN_BROKEN.some((entry) => line.startsWith(entry.page + ":"));
  expect(failures.filter((line) => !known(line))).toEqual([]);
});
