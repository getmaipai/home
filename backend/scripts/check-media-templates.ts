import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MediaTemplate } from "@maipai/spec/gen/ts/media-template.js";
const root = join(import.meta.dir, "../packages/generate_image/images/templates");
const files = readdirSync(root).filter((name) => name.endsWith(".json")).sort();
if (files.length < 16) throw new Error(`Expected at least 16 picture templates, found ${files.length}`);
for (const name of files) {
  const parsed = MediaTemplate.safeParse(JSON.parse(readFileSync(join(root, name), "utf8")));
  if (!parsed.success) throw new Error(`${name}: ${parsed.error.message}`);
  if (parsed.data.kind !== "picture") throw new Error(`${name}: expected kind picture`);
}
console.log(`Validated ${files.length} media templates against @maipai/spec.`);
