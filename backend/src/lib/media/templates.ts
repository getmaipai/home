import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MediaTemplate, type MediaTemplate as MediaTemplateRecord } from "@maipai/spec/gen/ts/media-template.js";
import type { PersonRow } from "@/types";
import { ContentRating } from "@maipai/spec/ratings/ts/contentRating";
import { passForPerson } from "@/lib/filter/pass";
import { stampAllowed } from "@/lib/filter/stampCompare";
import { adultStylesAllowed } from "@/lib/pictures/policy";
import { videoLookFor, videoRecipeFor } from "@/lib/videos/recipes";
import { getSavedTemplate, listSavedTemplates, savedTemplateSettings } from "./savedTemplates";

const ROOT = join(import.meta.dir, "../../../packages/generate_image/images/templates");
const VIDEO_ROOT = join(import.meta.dir, "../../../packages/generate_video/video/templates");
const VIDEO_SETTINGS_PATH = join(VIDEO_ROOT, "template-settings.json");
export type VideoTemplateSettings = { seconds: number; look?: string; camera?: string; orientation?: "landscape" | "portrait"; tier?: "standard" | "boost" | "max" };
let settingsCache: { stamp: number; values: Record<string, VideoTemplateSettings> } | undefined;
export function videoTemplateSettings(): Record<string, VideoTemplateSettings> {
  const stamp = statSync(VIDEO_SETTINGS_PATH).mtimeMs;
  if (settingsCache?.stamp === stamp) return settingsCache.values;
  const values = JSON.parse(readFileSync(VIDEO_SETTINGS_PATH, "utf8")) as Record<string, VideoTemplateSettings>;
  settingsCache = { stamp, values }; return values;
}
export function validVideoTemplateSettings(values = videoTemplateSettings()): boolean {
  const ids = all().templates.filter((row) => row.kind === "video").map((row) => row.id);
  return ids.length > 0 && ids.every((id) => !!values[id]) && Object.entries(values).every(([id, value]) => ids.includes(id) && Number.isInteger(value.seconds) && value.seconds >= 1 && value.seconds <= 30 && (!value.look || !!videoLookFor(value.look)) && (!value.camera || value.camera === "none" || !!videoRecipeFor(value.camera)) && (!value.orientation || value.orientation === "landscape" || value.orientation === "portrait") && (!value.tier || value.tier === "standard" || value.tier === "boost" || value.tier === "max"));
}

/** CREATOR-13: the preset records (looks, lights, angles, formats) live beside the templates, one array file per family. */
const FRAGMENTS = join(ROOT, "fragments");
/** A template a person can start from. CREATOR-01: records of kind "fragment" (shot-card vocabulary, picture presets) are not templates, so every template reader skips them. */
type PickableTemplate = MediaTemplateRecord & { kind: "picture" | "video" };
export type FragmentRecord = MediaTemplateRecord & { kind: "fragment"; group: NonNullable<MediaTemplateRecord["group"]> };
let cache: { stamp: number; templates: PickableTemplate[]; fragments: FragmentRecord[] } | undefined;
function jsonFiles(dir: string): string[] { return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => join(dir, name)) : []; }
/** The one reader: every bundled record is parsed against the spec once per change, then split into templates and fragments. */
function all(): { templates: PickableTemplate[]; fragments: FragmentRecord[] } {
  const files = [...jsonFiles(ROOT), ...jsonFiles(FRAGMENTS), ...jsonFiles(VIDEO_ROOT).filter((file) => file !== VIDEO_SETTINGS_PATH), ...jsonFiles(join(VIDEO_ROOT, "fragments"))];
  const stamp = files.reduce((n, file) => Math.max(n, statSync(file).mtimeMs), 0) + files.length;
  if (cache?.stamp === stamp) return cache;
  const parsed = files.flatMap((file) => {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return (Array.isArray(raw) ? raw : [raw]).map((row) => MediaTemplate.parse(row));
  });
  cache = { stamp, templates: parsed.filter((row): row is PickableTemplate => row.kind !== "fragment"), fragments: parsed.filter((row): row is FragmentRecord => row.kind === "fragment" && row.group !== undefined) };
  return cache;
}
/** TEMPLATE-02 (RULES.md C9): a bundled template's stamp is declared from its bundled audience, by a fixed mapping. */
export function declaredTemplateStamp(audience: "all-ages" | "adult-only"): ContentRating {
  return ContentRating.parse({ level: audience === "adult-only" ? "X" : "G", source: "declared", rater: "bundled-audience", rater_version: 1, rated_at: DECLARED_AT });
}
const DECLARED_AT = "2026-11-20T00:00:00.000Z";
/** A made-content ceiling: pictures and clips a person makes are held to the "made" ceiling and its unrated override (OVERRIDES-01), never to the person's age band (C3). */
function madeCeiling(actor: PersonRow): { ceiling: 0 | 1 | 2 | 3 | 4; unrated: boolean } {
  const pass = passForPerson(actor);
  return { ceiling: pass.ceiling.made, unrated: pass.unrated.has("made") };
}
/** The one filter, for bundled and saved rows alike: the stamp against the viewer's ceiling, then today's household check (`generation.styles.adult_only`), which the content filter never reads. */
const visibleTo = (actor: PersonRow, row: MediaTemplateRecord): boolean => {
  const { ceiling, unrated } = madeCeiling(actor);
  if (!stampAllowed(declaredTemplateStamp(row.audience), ceiling, unrated)) return false;
  return row.audience === "all-ages" || adultStylesAllowed();
};
export function bundledTemplates(kind?: "picture" | "video"): PickableTemplate[] { return all().templates.filter((row) => !kind || row.kind === kind); }
export function listTemplates(input: { actor: PersonRow; kind?: "picture" | "video" }): PickableTemplate[] {
  const bundled = all().templates.filter((row) => (!input.kind || row.kind === input.kind) && visibleTo(input.actor, row));
  // TEMPLATE-02: the viewer's own saved templates and the household-shared ones, filtered in savedTemplates.ts by the same ceiling and the same household check.
  return [...bundled, ...(listSavedTemplates(input.actor, input.kind) as PickableTemplate[])];
}
/** A template this person may use, by id: a bundled one they may see, or a saved one (their own or shared with the home) their ceiling allows. Null otherwise: absent, never "locked" (C10). */
export function resolveTemplate(actor: PersonRow, id: string): PickableTemplate | null {
  const bundled = getTemplate(id);
  if (bundled) return visibleTo(actor, bundled) ? bundled : null;
  return getSavedTemplate(actor, id) as PickableTemplate | null;
}
/** The video sidecar of a template: the bundled settings file, else the saved template's own. */
export function templateSettingsFor(id: string): VideoTemplateSettings | undefined { return videoTemplateSettings()[id] ?? savedTemplateSettings(id) ?? undefined; }
export function getTemplate(id: string): PickableTemplate | null { return all().templates.find((row) => row.id === id) ?? null; }
/** The preset records this person may use, in file order. An adult-only record is hidden by the same rule as an adult-only template. */
export function listFragments(input: { actor: PersonRow; group?: FragmentRecord["group"] }): FragmentRecord[] {
  return all().fragments.filter((row) => (!input.group || row.group === input.group) && visibleTo(input.actor, row));
}
/** One preset record by id, whoever may see it (callers check `audience`). Null for a template id. */
export function getFragment(id: string): FragmentRecord | null { return all().fragments.find((row) => row.id === id) ?? null; }

const BLANK = /\{\{([a-z][a-z0-9_]*)\|([^|}]+)\|([^}]*)\}\}/g;
/** The named blanks of a template prompt (`{{name|Label|example}}`), in order. */
export function templateBlanks(prompt: string): Array<{ name: string; label: string; example: string }> {
  return [...prompt.matchAll(BLANK)].map((match) => ({ name: match[1]!, label: match[2]!.trim(), example: match[3]!.trim() }));
}
/** The recipe's sentence with each blank filled: the person's words, else the blank's own example. A `cast_*` blank reads "this person" and a `photo_*` blank "the picture provided". */
export function fillTemplateBlanks(prompt: string, values: Record<string, string> = {}): string {
  return prompt.replace(BLANK, (_whole, name: string, _label: string, example: string) => name.startsWith("cast_") ? "this person" : name.startsWith("photo_") ? "the picture provided" : (values[name]?.trim() || example.trim()));
}
