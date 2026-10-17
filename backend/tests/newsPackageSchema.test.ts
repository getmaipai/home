import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { checkAppPackage } from "@maipai/spec/ui/app-check.js";
import uiSchema from "@maipai/spec/ui/schema.json";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
const dir = join(import.meta.dir, "../packages/news");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const ajv = new Ajv2020({ strict: false, validateFormats: false });
test("News manifest and all six pages match the pinned schemas and package contract", () => {
  const parsed = PackageManifest.safeParse(manifest);
  expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
  const validatePage = ajv.compile(uiSchema);
  expect(checkAppPackage("news", manifest.contributes, (module) => {
    const page = JSON.parse(readFileSync(join(dir, "pages", `${module}.json`), "utf8"));
    expect(validatePage(page), JSON.stringify(validatePage.errors)).toBe(true);
    return page;
  }, manifest.min_role)).toEqual([]);
});
