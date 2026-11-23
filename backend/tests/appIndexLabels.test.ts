// RAIL-LABEL-01: an app's index page is labeled with the app's own name, so the rail never shows a bare "Home" for the Image app.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "packages");

describe("app index labels", () => {
  test("every packaged app's index page label equals the app's display name", () => {
    const bad: string[] = [];
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      let manifest: { display?: string; contributes?: { pages?: Array<{ id: string; label?: string }> }; pages?: Array<{ id: string; label?: string }> };
      try { manifest = JSON.parse(readFileSync(join(root, dir.name, "manifest.json"), "utf8")); } catch { continue; }
      const index = (manifest.contributes?.pages ?? manifest.pages ?? []).find((page) => page.id === "index");
      if (index?.label && manifest.display && index.label !== manifest.display) bad.push(`${dir.name}: ${index.label} vs ${manifest.display}`);
    }
    expect(bad).toEqual([]);
  });
});
