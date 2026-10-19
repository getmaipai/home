import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { iconNames } from "@maipai/ui/src/icons";

// The rail shows each package app's `index` page icon (backend/src/lib/apps.ts). A name the kit's
// icon registry does not know draws no icon (Videos shipped "circle-play" and lost its rail icon).
const PACKAGES = new URL("../../../backend/packages/", import.meta.url).pathname;

describe("package app rail icons", () => {
  const known = new Set<string>(iconNames);
  const apps = readdirSync(PACKAGES).flatMap((id) => {
    const file = `${PACKAGES}${id}/manifest.json`;
    if (!existsSync(file)) return [];
    const pages = (JSON.parse(readFileSync(file, "utf8")) as { contributes?: { pages?: Array<{ id: string; nav?: boolean; icon?: string }> } }).contributes?.pages ?? [];
    const index = pages.find((page) => page.id === "index" && page.nav);
    return index?.icon ? [[id, index.icon] as const] : [];
  });

  test("finds the media apps", () => {
    expect(apps.map(([id]) => id)).toEqual(expect.arrayContaining(["music", "podcasts", "videos"]));
  });

  test.each(apps)("%s rail icon %s is registered in the kit", (_id, icon) => {
    expect(known.has(icon)).toBe(true);
  });
});
