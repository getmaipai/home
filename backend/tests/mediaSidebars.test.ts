// Task 3 of the Media rebuild: the shell draws a left section column for any package app whose manifest declares
// `contributes.sidebar` (NEWS-SIDEBAR-01). Each media app declares one "library" group holding its nav pages.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGES_DIR } from "@/lib/paths";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";

const MEDIA_APPS = ["videos", "shows", "music", "podcasts", "books"];

for (const id of MEDIA_APPS) {
  test(`${id}: the sidebar's one group lists its nav pages, in the manifest's page order`, () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, id, "manifest.json"), "utf-8")) as PackageManifest;
    const pages = manifest.contributes?.pages ?? [];
    const realIds = pages.map((page) => page.id);
    const expected = pages.filter((page) => page.nav).map((page) => page.id);
    const sidebar = manifest.contributes?.sidebar;
    expect(sidebar?.groups).toHaveLength(1);
    const group = sidebar?.groups[0];
    expect(group?.id).toBe("library");
    const sidebarPages = group?.pages ?? [];
    expect(sidebarPages).toEqual(expected);
    for (const page of sidebarPages) {
      expect(realIds).toContain(page);
    }
  });
}
