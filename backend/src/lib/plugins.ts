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
import ERROR_CATALOG from "@maipai/spec/errors/errors.json" with { type: "json" };
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { Recipe } from "@maipai/spec/gen/ts/recipe.js";
import { Project } from "@maipai/spec/gen/ts/project.js";
import { runRecipe, type PluginResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { ComputeError } from "@maipai/spec/interpreters/ts/compute.js";
import { createHost, type PackageHostTurnContext } from "@/lib/packageHost";
import { callTier1Handle } from "@/lib/denoHost";
import { registerPackageNotificationTypes } from "@/lib/notificationTypes";
import { registerProjectType } from "@/lib/projects/projectTypes";
import { buildProjectTypeFromManifest } from "@/lib/projects/fromManifest";
import type { ProjectPlan } from "@/lib/projects/types";
import { parseWhen } from "@/lib/scheduler";
import { listActivePeople } from "@/lib/access";
import { getHouseholdSettingValue } from "@/lib/settings";
import { PACKAGES_DIR, statMtimeMs, isValidPackageId } from "@/lib/paths";
import { resolvePackageDir, listInstalledPackageIds } from "@/lib/packageResolve";
import { promptNow } from "@/lib/benchSampling";
import { ROLE_LADDER, type Role } from "@/middleware/auth";
import type { PersonRow } from "@/types";

// Same engine and dialect spec/tests/ts/ui-schema.test.ts uses for a
// JSON-Schema-2020-12 body: manifest.schema.json's own `args` field is
// "a JSON Schema for this package's call arguments" (arbitrary, not a
// $ref into spec's own dialect), and codegen leaves it typed `z.any()`
// since it can't be known at generation time.
const ajv = new Ajv2020({ strict: false });

function localClockInput(now: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

export interface LoadedPackage {
  manifest: PackageManifest;
  recipe: Recipe;
}

export type PluginOpResult<T> =
  | { ok: true; value: T }
  // `code` (#92): the HostError code a recipe step raised, when one did,
  // so a caller can tell a fetch's typed not_found from the loader's own
  // 404 ("no such package") without parsing the message.
  | { ok: false; status: 400 | 403 | 404; error: string; code?: string }
  // Fix B (docs/dev.md's "Chat reliability: the 2026-09-07 incident and
  // the five fixes"): a Tier 1 handler's own typed report that it
  // couldn't answer (denoHost.ts's `CallTier1Result`, its `ok: false`
  // branch) - distinct from 400/403/404 (the CALLER's own request was
  // invalid) the way a real 502 is distinct from a 4xx: the request was
  // fine, something downstream of this package failed. `fallback_reply`
  // is the manifest's own honest line (or the generic default) for a
  // caller to speak with `source: "plugin_error"`, never silently
  // treated as if the package itself had said it.
  | { ok: false; status: 502; error: string; code: string; fallback_reply: PluginResult };

/** Every package id this hub can load: every bundled directory name,
 * plus any id the store has installed that was never bundled at all (a
 * genuinely new community package). A `Set` so a package that's both
 * bundled AND store-installed (an update to a default package, step 6's
 * own "weather installed from the local index" case) is listed once. */
export function listPackageIds(): string[] {
  let bundled: string[] = [];
  try {
    bundled = readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    bundled = [];
  }
  return [...new Set([...bundled, ...listInstalledPackageIds()])];
}

// mtime-keyed caches for loadManifestOnly()/loadPackage() (a latency
// review, 2026-09-06: every one of the retired turn engine's loadAllManifests()
// calls re-read and re-Zod-validated every bundled package's manifest,
// twelve packages' worth every single turn, none of it ever changing
// between household messages). Keyed by file mtime rather than a plain
// "load once at boot" cache, so an installed or edited package (the
// catalog install flow, a developer editing manifest.json by hand) is
// picked up on its very next read - the same "unchanged reads for free,
// a real change re-reads" contract lib/settings.ts's own cache (below)
// uses. `statMtimeMs()` (lib/paths.ts) on two small files per package is
// orders of magnitude cheaper than the read + JSON.parse + Zod safeParse
// it replaces.
const manifestCache = new Map<string, { mtimeMs: number; manifest: PackageManifest }>();
const packageCache = new Map<string, { manifestMtimeMs: number; recipeMtimeMs: number; value: LoadedPackage }>();

// MANIFEST-REFUSAL-01 (fixes getmaipai/home#166): a manifest that fails
// validation (the 400 path below) is never added to manifestCache above
// (only a successful parse is), so loadManifestOnly() re-reads and
// re-validates it on EVERY call - every turn that ever tries the broken
// package's tool. Logging unconditionally on that path would flood the
// log the same way; this is a separate, tiny once-per-mtime memory,
// beside manifestCache rather than inside it, so it changes nothing
// about the real cache's own behavior or contents. Keyed by id only
// (one mtime remembered at a time) - a package edited twice back to a
// previously-warned mtime warns again, which is fine: that is a real
// second occurrence of that exact broken content being live.
const manifestWarnedAtMtime = new Map<string, number>();

export function __resetPackageCachesForTests(): void {
  manifestCache.clear();
  packageCache.clear();
  manifestWarnedAtMtime.clear();
  projectPlanCache.clear();
  projectTypeWarnedAtMtime.clear();
}

// MANIFEST-REFUSAL-01: the bracketed-tag console.warn convention
// the retired turn engine and friends already use for a household-invisible
// diagnostic (`[conversation]`, `[background]`) - `[packages]` is a new
// tag for the same reason, never a rule reading anything a household
// member said (this only ever logs the loader's own Zod message about
// a manifest's shape).
function warnOncePerMtime(id: string, mtimeMs: number, line: string): void {
  if (manifestWarnedAtMtime.get(id) === mtimeMs) return;
  manifestWarnedAtMtime.set(id, mtimeMs);
  console.warn(line);
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
  if (!isValidPackageId(id)) {
    return { ok: false, status: 400, error: `${id} is not a valid package id` };
  }
  const manifestPath = join(resolvePackageDir(id), "manifest.json");
  const mtimeMs = statMtimeMs(manifestPath);
  if (mtimeMs === null) {
    manifestCache.delete(id);
    return { ok: false, status: 404, error: `no bundled package ${id}` };
  }
  const cached = manifestCache.get(id);
  if (cached && cached.mtimeMs === mtimeMs) return { ok: true, value: cached.manifest };
  // packageCache (loadPackage()'s own cache, below) already holds this
  // exact manifest, at this exact mtime, when a Tier 0 turn calls
  // loadAllManifests() (which uses loadPackage()) and then runPlugin()
  // calls this function moments later for the SAME package - a code
  // review (2026-09-06) found that re-parsed manifest.json from scratch
  // a second time in the same turn instead of reusing what packageCache
  // had just read. Populates manifestCache too, so a third call in the
  // same turn hits the cheaper map directly.
  const cachedPackage = packageCache.get(id);
  if (cachedPackage && cachedPackage.manifestMtimeMs === mtimeMs) {
    manifestCache.set(id, { mtimeMs, manifest: cachedPackage.value.manifest });
    return { ok: true, value: cachedPackage.value.manifest };
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    // MANIFEST-REFUSAL-01 (fixes getmaipai/home#166): the file exists
    // (mtimeMs above is real) but couldn't be read or parsed - warned
    // once per mtime, the same as the validation failure below, so the
    // hub log shows it the minute it happens rather than a household
    // member seeing a refusal with no diagnostic anywhere (the actual
    // live incident this fixes was the validation branch below, but
    // this sibling failure mode gets the identical treatment). The
    // genuinely-missing-file case above (mtimeMs === null) logs
    // nothing - that's the ordinary "no such package" a model
    // inventing a tool name produces, never a defect worth a log line.
    warnOncePerMtime(id, mtimeMs, `[packages] ${id}: manifest.json is unreadable`);
    return { ok: false, status: 404, error: `no such package ${id}` };
  }
  const manifestParsed = PackageManifest.safeParse(manifestJson);
  if (!manifestParsed.success) {
    warnOncePerMtime(id, mtimeMs, `[packages] ${id}: manifest failed validation: ${manifestParsed.error.message}`);
    // `code: "manifest_invalid"` (#92's own established pattern above,
    // PluginOpResult's own comment) - so policy.ts can tell this apart
    // from the OTHER 400 this function returns (an id that fails
    // isValidPackageId(), above, before any file is even read) without
    // parsing `error`'s own text. That other 400 stays uncoded and
    // unlogged on purpose: it never reaches disk, so there's no real
    // package content to diagnose, and it's the same "model invented a
    // tool name" case 404 already is.
    return { ok: false, status: 400, error: `package ${id}'s manifest failed validation: ${manifestParsed.error.message}`, code: "manifest_invalid" };
  }
  manifestCache.set(id, { mtimeMs, manifest: manifestParsed.data });
  return { ok: true, value: manifestParsed.data };
}

export function loadPackage(id: string): PluginOpResult<LoadedPackage> {
  if (!isValidPackageId(id)) {
    return { ok: false, status: 400, error: `${id} is not a valid package id` };
  }
  const packageDir = resolvePackageDir(id);
  const manifestPath = join(packageDir, "manifest.json");
  const recipePath = join(packageDir, "recipe.json");
  const manifestMtimeMs = statMtimeMs(manifestPath);
  const recipeMtimeMs = statMtimeMs(recipePath);
  if (manifestMtimeMs === null || recipeMtimeMs === null) {
    packageCache.delete(id);
    return { ok: false, status: 404, error: `no bundled package ${id}` };
  }
  const cached = packageCache.get(id);
  if (cached && cached.manifestMtimeMs === manifestMtimeMs && cached.recipeMtimeMs === recipeMtimeMs) {
    return { ok: true, value: cached.value };
  }

  let manifestJson: unknown, recipeJson: unknown;
  try {
    manifestJson = JSON.parse(readFileSync(manifestPath, "utf-8"));
    recipeJson = JSON.parse(readFileSync(recipePath, "utf-8"));
  } catch {
    // The JSON.parse calls are inside the try on purpose. A code review
    // (2026-09-05) found them outside it, so a truncated or half-written
    // manifest (an interrupted install, a bad copy) threw straight out of
    // every caller instead of being reported as an unloadable package -
    // which took GET /api/privacy, whose whole job is to be readable, down
    // with a 500.
    return { ok: false, status: 404, error: `no such package ${id}` };
  }
  const manifestParsed = PackageManifest.safeParse(manifestJson);
  if (!manifestParsed.success) {
    return { ok: false, status: 400, error: `package ${id}'s manifest failed validation: ${manifestParsed.error.message}` };
  }
  if (manifestParsed.data.tier !== 0) {
    return { ok: false, status: 400, error: `package ${id} is tier ${manifestParsed.data.tier}, not a Tier 0 recipe package - use runPlugin(), not loadPackage(), for a Tier 1 one` };
  }
  const recipeParsed = Recipe.safeParse(recipeJson);
  if (!recipeParsed.success) {
    return { ok: false, status: 400, error: `package ${id}'s recipe failed validation: ${recipeParsed.error.message}` };
  }
  const value: LoadedPackage = { manifest: manifestParsed.data, recipe: recipeParsed.data };
  packageCache.set(id, { manifestMtimeMs, recipeMtimeMs, value });
  return { ok: true, value };
}

export interface LoadedProjectPackage {
  manifest: PackageManifest;
  plan: ProjectPlan;
}

const projectPlanCache = new Map<string, { manifestMtimeMs: number; planMtimeMs: number; value: LoadedProjectPackage }>();
const projectTypeWarnedAtMtime = new Map<string, number>();

// PROJECT-PKGTYPE-01: the same bracketed-tag, warn-once-per-mtime
// convention MANIFEST-REFUSAL-01 (above) uses, kept as its own small
// map rather than sharing `manifestWarnedAtMtime` - that map is keyed
// only by id, against the MANIFEST's own mtime, for a manifest
// validation failure; a project package can fail to register for a
// reason that's about `plan.json` specifically (this map's own key),
// and conflating the two would let a real manifest-validation warning
// suppress a later plan-shaped one for the same id, or vice versa.
function warnProjectTypeOnce(id: string, mtimeMs: number, line: string): void {
  if (projectTypeWarnedAtMtime.get(id) === mtimeMs) return;
  projectTypeWarnedAtMtime.set(id, mtimeMs);
  console.warn(line);
}

/** The `"project"`-kind mirror of `loadPackage()` above (PROJECT-
 * PKGTYPE-01, manifest.schema.json's own `project` kind description): a
 * project-type package has no `recipe.json` at all - its body is
 * `plan.json`, a `ProjectPlan` validated against spec's own generated
 * `Project` Zod object's `.shape.plan` (project.schema.json's `$defs`
 * aren't exported as their own named consts, so this reads the one
 * sub-schema that already stands on its own). Same mtime-cached,
 * same read-both-then-validate, same truncated-file try/catch posture
 * as `loadPackage()`; kept fully separate rather than branching inside
 * it, the same reasoning `loadManifestOnly()`'s own header gives for
 * staying its own function - a project package's `plan.json` failing to
 * read must never change what `loadPackage()`'s existing callers see
 * for an ordinary recipe package. */
export function loadProjectPackage(id: string): PluginOpResult<LoadedProjectPackage> {
  if (!isValidPackageId(id)) {
    return { ok: false, status: 400, error: `${id} is not a valid package id` };
  }
  // Reuses loadManifestOnly()'s own cache rather than re-reading,
  // re-parsing and re-validating manifest.json a second time - a review
  // caught an earlier version doing exactly that duplicate work for
  // every project-kind package, the identical "packageCache already
  // holds this exact manifest" reuse loadManifestOnly() itself already
  // does against loadPackage()'s cache, above.
  const manifestResult = loadManifestOnly(id);
  if (!manifestResult.ok) return manifestResult;
  const manifest = manifestResult.value;
  if (manifest.kind !== "project") {
    // `code` distinguishes this from every other failure below: every
    // non-project package (the overwhelming majority) hits this branch
    // on every boot, and it's never worth a warning - only
    // registerAllPackageProjectTypes() (below) reads this code, to
    // skip silently instead of logging a spurious refusal for every
    // ordinary plugin/skill/app package installed.
    return { ok: false, status: 400, error: `package ${id} is kind "${manifest.kind}", not a project package - use loadPackage(), not loadProjectPackage(), for one`, code: "not_a_project_package" };
  }

  const packageDir = resolvePackageDir(id);
  const planPath = join(packageDir, "plan.json");
  // loadManifestOnly() (above) already stat()'d manifest.json to reach
  // this point and recorded that exact mtime in manifestCache before
  // returning - a re-review caught an earlier version stat()-ing it a
  // second time here for no reason beyond building this cache's own
  // key; reading it back out is free.
  const manifestMtimeMs = manifestCache.get(id)!.mtimeMs;
  const planMtimeMs = statMtimeMs(planPath);
  if (planMtimeMs === null) {
    projectPlanCache.delete(id);
    return { ok: false, status: 404, error: `no bundled package ${id}` };
  }
  const cached = projectPlanCache.get(id);
  if (cached && cached.manifestMtimeMs === manifestMtimeMs && cached.planMtimeMs === planMtimeMs) {
    return { ok: true, value: cached.value };
  }

  let planJson: unknown;
  try {
    planJson = JSON.parse(readFileSync(planPath, "utf-8"));
  } catch {
    // Same posture as loadPackage()'s identical try/catch: a truncated
    // or half-written file (an interrupted install) is reported as an
    // unloadable package, never thrown straight out of a caller.
    return { ok: false, status: 404, error: `no such package ${id}` };
  }
  const planParsed = Project.shape.plan.safeParse(planJson);
  if (!planParsed.success) {
    return { ok: false, status: 400, error: `package ${id}'s plan.json failed validation: ${planParsed.error.message}` };
  }
  const value: LoadedProjectPackage = { manifest, plan: planParsed.data as ProjectPlan };
  projectPlanCache.set(id, { manifestMtimeMs, planMtimeMs, value });
  return { ok: true, value };
}

/** Every loadable package's own manifest, in `listPackageIds()`'s
 * order - the exact `listPackageIds().map(loadPackage).filter(ok).map(
 * manifest)` pipeline `GET /api/plugins` (routes/plugins.ts) already
 * ran inline; a review (SHELL-SEARCH-02) caught the search route's own
 * apps provider re-typing an identical copy rather than calling one
 * definition. A package that fails to load (an interrupted install) is
 * skipped, the same posture `registerAllPackageNotificationTypes()`
 * above already takes. */
export function listInstalledManifests(): PackageManifest[] {
  return listPackageIds()
    .map((id) => loadPackage(id))
    .filter((r) => r.ok)
    .map((r) => (r as { ok: true; value: LoadedPackage }).value.manifest);
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

/** Called once at boot (index.ts), beside `registerAllPackageNotificationTypes()`
 * above: every installed `kind: "project"` package's manifest + `plan.json`
 * becomes a real, registered `ProjectType` (`projects/projectTypes.ts`) -
 * PROJECT-PKGTYPE-01, closing the gap PROJECT-START-01 left ("nothing
 * loads a real package's manifest into either registry"). A package
 * that isn't `kind: "project"` is skipped without a warning (the
 * ordinary case, every other package kind); one that IS but fails to
 * load, or whose plan/args combination fails `buildProjectTypeFromManifest()`'s
 * own refusal checks (an unbound `{arg}` placeholder, an arg name that
 * collides with a step id), is warned about once per `plan.json` mtime
 * and skipped - the same "one bad package can't take down boot" posture
 * `registerAllPackageNotificationTypes()` already has, mirrored for a
 * project-shaped reason (a bad plan.json is a package bug, never a
 * household-visible crash). */
export function registerAllPackageProjectTypes(): void {
  for (const id of listPackageIds()) {
    // Checked here, not just inside loadProjectPackage(): a re-review
    // caught the earlier version relying on `code === "not_a_project_
    // package"` alone to decide what's silent - but that code is only
    // ever set for a manifest that loaded fine and simply isn't
    // kind:"project". Every OTHER manifest-load failure (unreadable,
    // fails Zod validation) forwards loadManifestOnly()'s own result
    // verbatim with no such code, and loadManifestOnly() has already
    // warned about that failure itself (registerAllPackageNotification
    // Types() calls it for the identical id, earlier in the same boot) -
    // a second, misleading "project plan failed to load" warning here
    // would be about a manifest that was never a project package's
    // problem to begin with. Filtering by kind up front, before ever
    // calling loadProjectPackage(), means any failure THAT returns is
    // real: the manifest was confirmed kind:"project" already, so it's
    // plan.json specifically that failed.
    const manifestResult = loadManifestOnly(id);
    if (!manifestResult.ok || manifestResult.value.kind !== "project") continue;
    const loaded = loadProjectPackage(id);
    const planMtimeMs = statMtimeMs(join(resolvePackageDir(id), "plan.json")) ?? -1;
    if (!loaded.ok) {
      warnProjectTypeOnce(id, planMtimeMs, `[packages] ${id}: project plan failed to load: ${loaded.error}`);
      continue;
    }
    let built: ReturnType<typeof buildProjectTypeFromManifest>;
    try {
      // A review's own finding: PackageManifest.safeParse only checks
      // `args` loosely (it's declared `z.any()` - an arbitrary JSON
      // Schema, not spec's own dialect), so a schema-invalid `args`
      // field passes manifest validation and only fails once
      // buildProjectTypeFromManifest()'s own `ajv.compile()` actually
      // tries to compile it - synchronously, and uncaught would crash
      // this whole loop, and with it every household's boot, over one
      // bad package. This function's own doc comment already promises
      // "one bad package can't take down boot"; this is what keeps
      // that promise true for a throw, not just an `ok: false`.
      built = buildProjectTypeFromManifest(loaded.value.manifest, loaded.value.plan);
    } catch (err) {
      warnProjectTypeOnce(id, planMtimeMs, `[packages] ${id}: project type threw while building: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!built.ok) {
      warnProjectTypeOnce(id, planMtimeMs, `[packages] ${id}: project type refused: ${built.error}`);
      continue;
    }
    registerProjectType(built.value);
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
 * (the retired turn engine's prepareTurn(), the only real caller that has one),
 * is handed straight to createHost() so anything the recipe remembers
 * is attributed to that turn (step 2's provenance rule) rather than the
 * package id. Omitted for every other caller (a direct
 * `POST /api/plugins/:id/run`, a scheduled job): there's no turn to
 * attribute to, so memory.remember() falls back to the package id, same
 * as before this existed. */
function validateArgs(id: string, manifest: PackageManifest, inputs: Record<string, unknown>): string | null {
  // errors.json's invalid_input is exactly this: "The call's arguments
  // failed validation against the manifest's args schema." Without this,
  // a missing required input (e.g. remember's `fact`) reached the
  // interpreter, left its `{fact}` placeholder un-interpolated, and got
  // written to the real memory store as literal text with a 200 back —
  // found by review before this ever shipped.
  if (!manifest.args) return null;
  const validate = ajv.compile(manifest.args as object);
  if (validate(inputs)) return null;
  return ajv.errorsText(validate.errors, { separator: "; " });
}

/** CHAT-15: the one argument validator, exported so the turn engine
 * checks a whole batch of proposed calls against each package's own
 * args schema before any of them executes or asks for confirmation;
 * runPlugin() runs the identical check again at the door. A missing
 * package or a non-object argument set is a refusal too, so nothing
 * malformed ever reaches a host. */
export function validatePackageArgs(manifest: PackageManifest, inputs: unknown): { ok: true } | { ok: false; error: string } {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return { ok: false, error: "arguments must be an object" };
  const argsError = validateArgs(manifest.id, manifest, inputs as Record<string, unknown>);
  return argsError ? { ok: false, error: `${manifest.id}'s inputs failed validation: ${argsError}` } : { ok: true };
}

/** CHAT-15: the household-safe line for a failed run, never the
 * diagnostic: a Tier 1 handler's own fallback line (502), the error
 * catalogue's spoken fallback for a typed code, or the plain apology. */
export function safeFailureMessage(result: Extract<PluginOpResult<PluginResult>, { ok: false }>): string {
  if (result.status === 502 && result.fallback_reply?.reply?.text) return result.fallback_reply.reply.text;
  const code = (result as { code?: string }).code;
  const catalogued = code ? ERROR_CATALOG.find((e) => e.code === code) : undefined;
  return catalogued?.spoken_fallback ?? "Sorry, I couldn't do that.";
}

/** Runs a bundled package - Tier 0's own recipe, or (session-d-packages-
 * and-store.md step 5) Tier 1's Deno sandbox - for `actor`, checking
 * min_role first (4.9: the floor role a person needs to invoke this
 * package) and mapping a raised HostError to the same result shape every
 * other route returns. Tier branches after the manifest loads since the
 * two tiers need genuinely different loading (Tier 0 also reads and
 * validates recipe.json; Tier 1 has none) - `loadManifestOnly()` is the
 * one read both share.
 *
 * `turn`, when this run is happening inside a conversation turn
 * (the retired turn engine's prepareTurn(), the only real caller that has one), is
 * handed straight to createHost() so anything the recipe remembers is
 * attributed to that turn (step 2's provenance rule) rather than the
 * package id. Omitted for every other caller (a direct
 * `POST /api/plugins/:id/run`, a scheduled job): there's no turn to
 * attribute to, so memory.remember() falls back to the package id, same
 * as before this existed. `turn.conversationId` rides alongside `turn.id`
 * for the same reason and travels no further than createHost() -
 * host.artifact.create() needs it up front, before conversationTurns has
 * a row for this turn at all (logTurn() writes that row only once the
 * whole turn finishes composing, after every tool outcome including this
 * one) - bundled with the turn id in one object, not a second positional
 * parameter (a code review, 2026-09-21: two adjacent same-typed optional
 * strings have no runtime cross-check against each other). */
export async function runPlugin(
  id: string,
  actor: PersonRow,
  inputs: Record<string, unknown>,
  turn?: PackageHostTurnContext,
  options: { signal?: AbortSignal; deadlineAt?: number } = {},
): Promise<PluginOpResult<PluginResult>> {
  const manifestResult = loadManifestOnly(id);
  if (!manifestResult.ok) return manifestResult;
  const manifest = manifestResult.value;
  if (!meetsMinRole(actor.role, manifest.min_role)) {
    return { ok: false, status: 403, error: `${id} needs role ${manifest.min_role} or higher` };
  }
  const argsError = validateArgs(id, manifest, inputs);
  if (argsError) return { ok: false, status: 400, error: `${id}'s inputs failed validation: ${argsError}`, code: "bad_arguments" };

  if (manifest.tier === 1) {
    // ALM-01: the almanac handlers are sandboxed Tier 1 packages, so the
    // turn's already-frozen clock crosses the MCP boundary as an internal
    // argument. The production path gets the real current instant from
    // promptNow(); the bench pins that same source without changing Date.
    const handlerInputs = id.startsWith("almanac-") ? { ...inputs, __now: localClockInput(promptNow()) } : inputs;
    const result = await callTier1Handle(id, manifest, actor, handlerInputs, turn);
    if (!result.ok) {
      return { ok: false, status: 502, error: result.message, code: result.code, fallback_reply: result.fallback };
    }
    return { ok: true, value: result.value };
  }

  const loaded = loadPackage(id);
  if (!loaded.ok) return loaded;
  const { recipe } = loaded.value;
  const host = createHost(actor, manifest, [], turn, options);
  try {
    return { ok: true, value: await runRecipe(recipe, inputs, host) };
  } catch (err) {
    if (err instanceof HostError) {
      const status = err.code === "permission_denied" ? 403 : err.code === "not_found" ? 404 : 400;
      return { ok: false, status, error: err.message, code: err.code };
    }
    // A `compute` step's own bad input (an expression the restricted
    // evaluator can't parse) - a real, expected, recoverable case now
    // that `math`/`convert` (step 7) hand it a household member's own
    // free-typed text rather than a package's own hardcoded template. A
    // real gap found while building those: this used to have no case
    // for it at all, so a malformed expression fell through to `throw
    // err` below and propagated as an unhandled error all the way to
    // POST /api/plugins/:id/run's own route handler (no try/catch of
    // its own), instead of the clean 400 every other bad-input case
    // here already gets.
    if (err instanceof ComputeError) {
      return { ok: false, status: 400, error: err.message };
    }
    throw err;
  }
}

// --- Warming (session-d-packages-and-store.md step 3) ---------------
//
// A package's own `manifest.warm.schedule`/`warm.keys` (spec/schemas/
// manifest.schema.json) pre-populates lib/packageCache.ts's cache before
// anyone asks, by simply running the recipe with realistic inputs the
// ordinary way: `host.fetch` (already cache-aware, packageHost.ts) does
// the actual caching, so warming needs no cache-specific code of its own
// here - it only needs an actor to run the recipe as, and a clock to
// decide when a package is next due.
//
// The "last warmed" clock is in-memory, not a DB column: a restart
// resetting it just means a package might warm sooner than its ideal
// schedule once after a reboot, never a correctness problem, and the
// same operational-not-synced posture lib/engineStats.ts's ring buffer
// already has for data that only matters while the process is running.
const lastWarmedAt = new Map<string, number>();

/** The household's own owner (falling back to any active adult, then any
 * active person) runs a warm pass - warming is a trusted background
 * operation, not a chat request from someone, so there is no real
 * "actor" to attribute it to; picking the highest-privileged real person
 * guarantees `meetsMinRole()` never blocks a warm run that a live chat
 * request from that same household would also be allowed to make. `null`
 * on a fresh install with no household set up yet - nothing to warm as,
 * so warming is skipped entirely rather than inventing a synthetic
 * person no spec record backs. */
function warmActor(): PersonRow | null {
  const people = listActivePeople();
  if (people.length === 0) return null;
  // ROLE_LADDER (imported above for meetsMinRole()) is already ordered
  // highest-privileged first - reusing it here instead of a second,
  // independently-maintained literal means a future role change updates
  // both call sites at once, not just the one someone remembered to.
  people.sort((a, b) => ROLE_LADDER.indexOf(a.role as Role) - ROLE_LADDER.indexOf(b.role as Role));
  return people[0]!;
}

/** Overrides `weather`'s own `place` input with `household.home_place`
 * (backend/src/settings/coreKeys.ts) when the household has set one, so
 * its warm keys and widget default (a manifest literal, "Seattle")
 * answer for the household actually running it instead of the
 * placeholder every install ships with. Scoped to `weather` by package
 * id, not just by the presence of a `place` field (code review,
 * 2026-09-11): a future package could declare its own unrelated `place`
 * input (a travel planner's destination, say) that this must never
 * silently rewrite. Never touches a live chat turn's own explicit place
 * (a user asking "weather in Chicago" reaches `runPlugin()` directly with
 * that place already resolved, never through here). */
export function withHouseholdPlaceDefault(packageId: string, inputs: Record<string, unknown>): Record<string, unknown> {
  if (packageId !== "weather" || !("place" in inputs)) return inputs;
  const place = getHouseholdSettingValue("household.home_place");
  if (typeof place !== "string" || place.length === 0) return inputs;
  return { ...inputs, place };
}

/** Runs one package's own `warm.keys` (each a recipe input object) so its
 * cache holds a fresh answer before anyone asks. Takes the manifest
 * already loaded by the caller (runDueWarmJobs() below) rather than
 * re-reading and re-validating manifest.json a second time for the same
 * tick. Never throws: a warm failure (the third-party service is down, a
 * bad key, a role check runPlugin() itself enforces) is exactly the
 * situation warming exists to protect a live request from, so it is
 * logged and skipped, not surfaced as this function's own failure -
 * `runPlugin()` reports a failure as a returned `{ ok: false }`, not a
 * throw, so both paths are checked. */
export async function warmPackage(id: string, manifest: PackageManifest): Promise<void> {
  const keys = manifest.warm?.keys ?? [];
  if (keys.length === 0) return;
  const actor = warmActor();
  if (!actor) return;
  for (const key of keys) {
    try {
      const result = await runPlugin(id, actor, withHouseholdPlaceDefault(id, key as Record<string, unknown>));
      if (!result.ok) {
        console.error(`[warm] ${id} failed to warm key ${JSON.stringify(key)}: ${result.error}`);
      }
    } catch (err) {
      console.error(`[warm] ${id} failed to warm key ${JSON.stringify(key)}: ${(err as Error).message}`);
    }
  }
}

/** The body of the `packages.warm` core job (index.ts): every bundled
 * package declaring `warm.schedule` gets warmed once its own interval has
 * elapsed since it was last warmed (or immediately, the first time this
 * ever runs for it) - independent per-package intervals over one shared
 * poll, the same shape lib/scheduler.ts's own recurring-job model already
 * uses, without needing a scheduled_jobs row per package. */
export async function runDueWarmJobs(): Promise<void> {
  const now = Date.now();
  for (const id of listPackageIds()) {
    const manifestResult = loadManifestOnly(id);
    if (!manifestResult.ok) continue;
    const schedule = manifestResult.value.warm?.schedule;
    if (!schedule) continue;
    const parsed = parseWhen(schedule, new Date(now));
    if (!parsed?.intervalMs) continue;
    const last = lastWarmedAt.get(id);
    if (last !== undefined && now - last < parsed.intervalMs) continue;
    await warmPackage(id, manifestResult.value);
    lastWarmedAt.set(id, now);
  }
}

export function __resetWarmStateForTests(): void {
  lastWarmedAt.clear();
}
