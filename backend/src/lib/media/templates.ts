import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MediaTemplate, type MediaTemplate as MediaTemplateRecord } from "@maipai/spec/gen/ts/media-template.js";
import type { PersonRow } from "@/types";
import { speakerAgeBand } from "@/lib/ageBand";
import { adultStylesAllowed } from "@/lib/pictures/policy";

const ROOT = join(import.meta.dir, "../../../packages/generate_image/images/templates");
/** CREATOR-13: the preset records (looks, lights, angles, formats) live beside the templates, one array file per family. */
const FRAGMENTS = join(ROOT, "fragments");
/** A template a person can start from. CREATOR-01: records of kind "fragment" (shot-card vocabulary, picture presets) are not templates, so every template reader skips them. */
type PickableTemplate = MediaTemplateRecord & { kind: "picture" | "video" };
export type FragmentRecord = MediaTemplateRecord & { kind: "fragment"; group: NonNullable<MediaTemplateRecord["group"]> };
let cache: { stamp: number; templates: PickableTemplate[]; fragments: FragmentRecord[] } | undefined;
function jsonFiles(dir: string): string[] { return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => join(dir, name)) : []; }
/** The one reader: every bundled record is parsed against the spec once per change, then split into templates and fragments. */
function all(): { templates: PickableTemplate[]; fragments: FragmentRecord[] } {
  const files = [...jsonFiles(ROOT), ...jsonFiles(FRAGMENTS)];
  const stamp = files.reduce((n, file) => Math.max(n, statSync(file).mtimeMs), 0) + files.length;
  if (cache?.stamp === stamp) return cache;
  const parsed = files.flatMap((file) => {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return (Array.isArray(raw) ? raw : [raw]).map((row) => MediaTemplate.parse(row));
  });
  cache = { stamp, templates: parsed.filter((row): row is PickableTemplate => row.kind !== "fragment"), fragments: parsed.filter((row): row is FragmentRecord => row.kind === "fragment" && row.group !== undefined) };
  return cache;
}
const visibleTo = (actor: PersonRow, row: MediaTemplateRecord): boolean => row.audience === "all-ages" || (speakerAgeBand(actor, new Date()) === "adult" && adultStylesAllowed());
export function listTemplates(input: { actor: PersonRow; kind?: "picture" | "video" }): PickableTemplate[] {
  return all().templates.filter((row) => (!input.kind || row.kind === input.kind) && visibleTo(input.actor, row));
}
export function getTemplate(id: string): PickableTemplate | null { return all().templates.find((row) => row.id === id) ?? null; }
/** The preset records this person may use, in file order. An adult-only record is hidden by the same rule as an adult-only template. */
export function listFragments(input: { actor: PersonRow; group?: FragmentRecord["group"] }): FragmentRecord[] {
  return all().fragments.filter((row) => (!input.group || row.group === input.group) && visibleTo(input.actor, row));
}
/** One preset record by id, whoever may see it (callers check `audience`). Null for a template id. */
export function getFragment(id: string): FragmentRecord | null { return all().fragments.find((row) => row.id === id) ?? null; }
