import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("no shipped package page declares the cinema tone", () => {
  const packagesDir = join(import.meta.dir, "../packages");
  const declarations: string[] = [];

  for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const pagesDir = join(packagesDir, pkg.name, "pages");
    if (!existsSync(pagesDir)) continue;
    const pages = readdirSync(pagesDir, { withFileTypes: true });

    for (const page of pages) {
      if (!page.isFile() || !page.name.endsWith(".json")) continue;
      const file = join(pagesDir, page.name);
      const config = JSON.parse(readFileSync(file, "utf8")) as { tone?: unknown };
      if (config.tone === "cinema") declarations.push(`${pkg.name}/pages/${page.name}`);
    }
  }

  expect(declarations).toEqual([]);
});
