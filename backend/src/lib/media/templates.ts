import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MediaTemplate, type MediaTemplate as MediaTemplateRecord } from "@maipai/spec/gen/ts/media-template.js";
import type { PersonRow } from "@/types";
import { speakerAgeBand } from "@/lib/ageBand";
import { adultStylesAllowed } from "@/lib/pictures/policy";

const ROOT = join(import.meta.dir, "../../../packages/generate_image/images/templates");
/** A template a person can start from. CREATOR-01: records of kind "fragment" (shot-card vocabulary) are not templates, so every template reader skips them. */
type PickableTemplate = MediaTemplateRecord & { kind: "picture" | "video" };
let cache: { stamp: number; rows: PickableTemplate[] } | undefined;
function rows(): PickableTemplate[] {
  const files = readdirSync(ROOT).filter((name) => name.endsWith(".json")).sort();
  const stamp = files.reduce((n, name) => Math.max(n, statSync(join(ROOT, name)).mtimeMs), 0);
  if (cache?.stamp === stamp) return cache.rows;
  const parsed = files
    .map((name) => MediaTemplate.parse(JSON.parse(readFileSync(join(ROOT, name), "utf8"))))
    .filter((row): row is PickableTemplate => row.kind !== "fragment");
  cache = { stamp, rows: parsed };
  return parsed;
}
export function listTemplates(input: { actor: PersonRow; kind?: "picture" | "video" }): PickableTemplate[] {
  const band = speakerAgeBand(input.actor, new Date());
  return rows().filter((row) => (!input.kind || row.kind === input.kind) && (row.audience === "all-ages" || (band === "adult" && adultStylesAllowed())));
}
export function getTemplate(id: string): PickableTemplate | null { return rows().find((row) => row.id === id) ?? null; }
