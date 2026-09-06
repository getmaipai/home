// Tier 0 package loading and execution (platform plan 4.9/5.2): reads a
// manifest + recipe pair off disk, validates both against spec's
// generated Zod schemas, and runs the recipe through spec's interpreter
// against a real host (lib/packageHost.ts). No catalog, no install flow,
// no signing yet: packages here are the "default set bundled with the
// release" the roadmap names, read straight from backend/packages/.
//
// Renamed from lib/skills.ts (2026-09-05): what this file loads and runs
// is a `kind: "plugin"` package (a self-contained, permissioned,
// installable capability - weather/joke/trivia/define/remember/recall),
// not a Claude-shaped Skill (plain instructions, no permissions of its
// own). See docs/dev.md's "Naming: skill, plugin, command, connector"
// entry for the full research and reasoning.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { Recipe } from "@maipai/spec/gen/ts/recipe.js";
import { runRecipe, type PluginResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { createHost } from "@/lib/packageHost";
import { registerPackageNotificationTypes } from "@/lib/notificationTypes";
import { ROLE_LADDER, type Role } from "@/middleware/auth";
import type { PersonRow } from "@/types";

// Same engine and dialect spec/tests/ts/ui-schema.test.ts uses for a
// JSON-Schema-2020-12 body: manifest.schema.json's own `args` field is
// "a JSON Schema for this package's call arguments" (arbitrary, not a
// $ref into spec's own dialect), and codegen leaves it typed `z.any()`
// since it can't be known at generation time.
const ajv = new Ajv2020({ strict: false });

export const PACKAGES_DIR = join(import.meta.dir, "..", "..", "packages");

export interface LoadedPackage {
  manifest: PackageManifest;
  recipe: Recipe;
}

export type PluginOpResult<T> =
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

/** Reads and validates just manifest.json, for lib/persona.ts's own
 * companion-catalog loader (step 8, session-a-intelligence.md): a
 * `kind: "companion"` package has no recipe.json at all (it composes
 * into the prompt directly, it's never run), so it can't go through
 * loadPackage() below at all. Deliberately its OWN read-and-validate
 * logic, not shared with loadPackage()'s: a code review (2026-09-05)
 * found an earlier version that had loadPackage() call this function
 * first, before reading recipe.json, changed loadPackage()'s own
 * existing behavior for a package with BOTH an invalid manifest and a
 * missing/malformed recipe.json - it used to always report the plain
 * 404 below (both files were read inside one try, so a recipe-read
 * failure masked whatever the manifest's own validation would have
 * said) and would have started reporting the manifest's own 400
 * instead. loadPackage() keeps its original read-both-then-validate
 * shape untouched below. */
export function loadManifestOnly(id: string): PluginOpResult<PackageManifest> {
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(readFileSync(join(PACKAGES_DIR, id, "manifest.json"), "utf-8"));
  } catch {
    return { ok: false, status: 404, error: `no bundled package ${id}` };
  }
  const manifestParsed = PackageManifest.safeParse(manifestJson);
  if (!manifestParsed.success) {
    return { ok: false, status: 400, error: `package ${id}'s manifest failed validation: ${manifestParsed.error.message}` };
  }
  return { ok: true, value: manifestParsed.data };
}

export function loadPackage(id: string): PluginOpResult<LoadedPackage> {
  let manifestJson: unknown, recipeJson: unknown;
  try {
    manifestJson = JSON.parse(readFileSync(join(PACKAGES_DIR, id, "manifest.json"), "utf-8"));
    recipeJson = JSON.parse(readFileSync(join(PACKAGES_DIR, id, "recipe.json"), "utf-8"));
  } catch {
    // The JSON.parse calls are inside the try on purpose. A code review
    // (2026-09-05) found them outside it, so a truncated or half-written
    // manifest (an interrupted install, a bad copy) threw straight out of
    // every caller instead of being reported as an unloadable package -
    // which took GET /api/privacy, whose whole job is to be readable, down
    // with a 500.
    return { ok: false, status: 404, error: `no bundled package ${id}` };
  }
  const manifestParsed = PackageManifest.safeParse(manifestJson);
  if (!manifestParsed.success) {
    return { ok: false, status: 400, error: `package ${id}'s manifest failed validation: ${manifestParsed.error.message}` };
  }
  if (manifestParsed.data.tier !== 0) {
    return { ok: false, status: 400, error: `package ${id} is tier ${manifestParsed.data.tier}, only tier 0 runs today` };
  }
  const recipeParsed = Recipe.safeParse(recipeJson);
  if (!recipeParsed.success) {
    return { ok: false, status: 400, error: `package ${id}'s recipe failed validation: ${recipeParsed.error.message}` };
  }
  return { ok: true, value: { manifest: manifestParsed.data, recipe: recipeParsed.data } };
}

/** Called once at boot (index.ts): every bundled package's own manifest
 * `notifications[]` becomes a real dispatchable type in F's shared
 * registry (lib/notificationTypes.ts). A package with no manifest yet
 * (an interrupted install) is skipped rather than failing the whole
 * pass, the same "one bad package can't take down boot" posture
 * lib/smoke.ts's own runAllSmokeTests() already has. */
export function registerAllPackageNotificationTypes(): void {
  for (const id of listPackageIds()) {
    const loaded = loadManifestOnly(id);
    if (loaded.ok) registerPackageNotificationTypes(loaded.value);
  }
}

export function meetsMinRole(actorRole: string, minRole: string): boolean {
  const actorIdx = ROLE_LADDER.indexOf(actorRole as Role);
  const minIdx = ROLE_LADDER.indexOf(minRole as Role);
  if (actorIdx === -1 || minIdx === -1) return false;
  return actorIdx <= minIdx; // lower index = higher on the ladder (owner first)
}

/** Runs one bundled Tier 0 package's recipe for `actor`, checking
 * min_role before the recipe ever executes (4.9: the floor role a
 * person needs to invoke this package) and mapping a raised HostError to
 * the same result shape every other route returns. Async (2026-09-05):
 * runRecipe() itself now is, since a real host.fetch is real network I/O -
 * see recipe-interpreter.ts and packageHost.ts.
 *
 * `turnId`, when this run is happening inside a conversation turn
 * (turnEngine.ts's prepareTurn(), the only real caller that has one),
 * is handed straight to createHost() so anything the recipe remembers
 * is attributed to that turn (step 2's provenance rule) rather than the
 * package id. Omitted for every other caller (a direct
 * `POST /api/plugins/:id/run`, a scheduled job): there's no turn to
 * attribute to, so memory.remember() falls back to the package id, same
 * as before this existed. */
export async function runPlugin(
  id: string,
  actor: PersonRow,
  inputs: Record<string, unknown>,
  turnId?: string,
): Promise<PluginOpResult<PluginResult>> {
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
  const host = createHost(actor, manifest, [], turnId);
  try {
    return { ok: true, value: await runRecipe(recipe, inputs, host) };
  } catch (err) {
    if (err instanceof HostError) {
      const status = err.code === "permission_denied" ? 403 : err.code === "not_found" ? 404 : 400;
      return { ok: false, status, error: err.message };
    }
    throw err;
  }
}
