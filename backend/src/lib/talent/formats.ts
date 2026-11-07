import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ShowFormat } from "@maipai/spec/gen/ts/show-format.js";
import type { ShowFormat as ShowFormatShape } from "@maipai/spec/gen/ts/show-format.js";

let cached: Map<string, ShowFormatShape> | null = null;
export function loadFormats(): Map<string, ShowFormatShape> {
  if (cached) return new Map(cached);
  const directory = join(import.meta.dir, "../../../packages/talent/formats");
  const formats = new Map<string, ShowFormatShape>();
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
    let parsed: ShowFormatShape;
    try { parsed = ShowFormat.parse(JSON.parse(readFileSync(join(directory, file), "utf8"))); }
    catch { throw new Error(`Talent format ${file} is invalid. Fix its JSON fields to match the pinned ShowFormat schema.`); }
    if (formats.has(parsed.id)) throw new Error(`Talent format ${parsed.id} appears more than once. Keep one file per format ID.`);
    formats.set(parsed.id, parsed);
  }
  cached = formats;
  return new Map(formats);
}
export function formatById(id: string): ShowFormatShape | null { return loadFormats().get(id) ?? null; }

// Importing the Talent backend loads and validates its complete format catalog before a show can be written.
loadFormats();
