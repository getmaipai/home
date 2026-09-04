// Tier 0 package loading and execution (platform plan 4.9/5.2): reads a
// manifest + recipe pair off disk, validates both against spec's
// generated Zod schemas, and runs the recipe through spec's interpreter
// against a real host (lib/packageHost.ts). No catalog, no install flow,
// no signing yet: packages here are the "default set bundled with the
// release" the roadmap names, read straight from backend/packages/.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { Recipe } from "@maipai/spec/gen/ts/recipe.js";
import { runRecipe, type SkillResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { createHost } from "@/lib/packageHost";
import { ROLE_LADDER, type Role } from "@/middleware/auth";
import type { PersonRow } from "@/types";

// Same engine and dialect spec/tests/ts/ui-schema.test.ts uses for a
// JSON-Schema-2020-12 body: manifest.schema.json's own `args` field is
// "a JSON Schema for this package's call arguments" (arbitrary, not a
// $ref into spec's own dialect), and codegen leaves it typed `z.any()`
// since it can't be known at generation time.
const ajv = new Ajv2020({ strict: false });

const PACKAGES_DIR = join(import.meta.dir, "..", "..", "packages");

export interface LoadedPackage {
  manifest: PackageManifest;
  recipe: Recipe;
}

export type SkillOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404; error: string };

/** Every bundled package's id, from its directory name. */
export function listPackageIds(): string[] {
  try {
    return readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function loadPackage(id: string): SkillOpResult<LoadedPackage> {
  let manifestRaw: string, recipeRaw: string;
  try {
    manifestRaw = readFileSync(join(PACKAGES_DIR, id, "manifest.json"), "utf-8");
    recipeRaw = readFileSync(join(PACKAGES_DIR, id, "recipe.json"), "utf-8");
  } catch {
    return { ok: false, status: 404, error: `no bundled package ${id}` };
  }
  const manifestParsed = PackageManifest.safeParse(JSON.parse(manifestRaw));
  if (!manifestParsed.success) {
    return { ok: false, status: 400, error: `package ${id}'s manifest failed validation: ${manifestParsed.error.message}` };
  }
  if (manifestParsed.data.tier !== 0) {
    return { ok: false, status: 400, error: `package ${id} is tier ${manifestParsed.data.tier}, only tier 0 runs today` };
  }
  const recipeParsed = Recipe.safeParse(JSON.parse(recipeRaw));
  if (!recipeParsed.success) {
    return { ok: false, status: 400, error: `package ${id}'s recipe failed validation: ${recipeParsed.error.message}` };
  }
  return { ok: true, value: { manifest: manifestParsed.data, recipe: recipeParsed.data } };
}

function meetsMinRole(actorRole: string, minRole: string): boolean {
  const actorIdx = ROLE_LADDER.indexOf(actorRole as Role);
  const minIdx = ROLE_LADDER.indexOf(minRole as Role);
  if (actorIdx === -1 || minIdx === -1) return false;
  return actorIdx <= minIdx; // lower index = higher on the ladder (owner first)
}

/** Runs one bundled Tier 0 package's recipe for `actor`, checking
 * min_role before the recipe ever executes (4.9: the floor role a
 * person needs to invoke this package) and mapping a raised HostError to
 * the same result shape every other route returns. */
export function runSkill(id: string, actor: PersonRow, inputs: Record<string, unknown>): SkillOpResult<SkillResult> {
  const loaded = loadPackage(id);
  if (!loaded.ok) return loaded;
  const { manifest, recipe } = loaded.value;
  if (!meetsMinRole(actor.role, manifest.min_role)) {
    return { ok: false, status: 403, error: `${id} needs role ${manifest.min_role} or higher` };
  }
  // errors.json's invalid_input is exactly this: "The call's arguments
  // failed validation against the manifest's args schema." Without this,
  // a missing required input (e.g. remember's `fact`) reached the
  // interpreter, left its `{fact}` placeholder un-interpolated, and got
  // written to the real memory store as literal text with a 200 back —
  // found by review before this ever shipped.
  if (manifest.args) {
    const validate = ajv.compile(manifest.args as object);
    if (!validate(inputs)) {
      const detail = ajv.errorsText(validate.errors, { separator: "; " });
      return { ok: false, status: 400, error: `${id}'s inputs failed validation: ${detail}` };
    }
  }
  const host = createHost(actor, manifest);
  try {
    return { ok: true, value: runRecipe(recipe, inputs, host) };
  } catch (err) {
    if (err instanceof HostError) {
      const status = err.code === "permission_denied" ? 403 : err.code === "not_found" ? 404 : 400;
      return { ok: false, status, error: err.message };
    }
    throw err;
  }
}
