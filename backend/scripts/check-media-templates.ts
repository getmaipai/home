import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MediaTemplate } from "@maipai/spec/gen/ts/media-template.js";
const root = join(import.meta.dir, "../packages/generate_image/images/templates");
const files = readdirSync(root).filter((name) => name.endsWith(".json")).sort();
if (files.length < 16) throw new Error(`Expected at least 16 picture templates, found ${files.length}`);
let templates = 0;
for (const name of files) {
  const parsed = MediaTemplate.safeParse(JSON.parse(readFileSync(join(root, name), "utf8")));
  if (!parsed.success) throw new Error(`${name}: ${parsed.error.message}`);
  // CREATOR-01: a fragment is not a template; the fragment records are validated below, from their own folder.
  if (parsed.data.kind === "fragment") continue;
  if (parsed.data.kind !== "picture") throw new Error(`${name}: expected kind picture`);
  templates += 1;
}
// CREATOR-13: the picture preset records, one array file per family under fragments/. Each must be a fragment with its group, ids unique across both folders.
const fragmentRoot = join(root, "fragments");
const ids = new Set<string>(files.map((name) => String(JSON.parse(readFileSync(join(root, name), "utf8")).id)));
const perGroup: Record<string, number> = {};
for (const name of readdirSync(fragmentRoot).filter((n) => n.endsWith(".json")).sort()) {
  const rows = JSON.parse(readFileSync(join(fragmentRoot, name), "utf8")) as unknown[];
  if (!Array.isArray(rows)) throw new Error(`fragments/${name}: expected an array of records`);
  for (const row of rows) {
    const parsed = MediaTemplate.safeParse(row);
    if (!parsed.success) throw new Error(`fragments/${name}: ${parsed.error.message}`);
    if (parsed.data.kind !== "fragment" || !parsed.data.group) throw new Error(`fragments/${name}: ${parsed.data.id} must be a fragment with a group`);
    if (ids.has(parsed.data.id)) throw new Error(`fragments/${name}: duplicate id ${parsed.data.id}`);
    ids.add(parsed.data.id);
    perGroup[parsed.data.group] = (perGroup[parsed.data.group] ?? 0) + 1;
  }
}
console.log(`Validated ${templates} media templates and ${ids.size - files.length} preset fragments (${Object.entries(perGroup).map(([g, n]) => `${g} ${n}`).join(", ")}) against @maipai/spec.`);
