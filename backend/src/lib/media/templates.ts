import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MediaTemplate, type MediaTemplate as MediaTemplateRecord } from "@maipai/spec/gen/ts/media-template.js";
import type { PersonRow } from "@/types";
import { speakerAgeBand } from "@/lib/ageBand";
import { adultStylesAllowed } from "@/lib/pictures/policy";

const ROOT = join(import.meta.dir, "../../../packages/generate_image/images/templates");
let cache: { stamp: number; rows: MediaTemplateRecord[] } | undefined;
function rows(): MediaTemplateRecord[] {
  const files = readdirSync(ROOT).filter((name) => name.endsWith(".json")).sort();
  const stamp = files.reduce((n, name) => Math.max(n, statSync(join(ROOT, name)).mtimeMs), 0);
  if (cache?.stamp === stamp) return cache.rows;
  const parsed = files.map((name) => MediaTemplate.parse(JSON.parse(readFileSync(join(ROOT, name), "utf8"))));
  cache = { stamp, rows: parsed };
  return parsed;
}
export function listTemplates(input: { actor: PersonRow; kind?: "picture" | "video" }): MediaTemplateRecord[] {
  const band = speakerAgeBand(input.actor, new Date());
  return rows().filter((row) => (!input.kind || row.kind === input.kind) && (row.audience === "all-ages" || (band === "adult" && adultStylesAllowed())));
}
export function getTemplate(id: string): MediaTemplateRecord | null { return rows().find((row) => row.id === id) ?? null; }
