// PROJECT-PKGTYPE-01 (docs/plans/harness-turns-and-projects-2026-09-26.md,
// "Recipes first"): turns one `"project"`-kind package's manifest +
// `plan.json` (plugins.ts's loadProjectPackage()) into a real
// `ProjectType` (projectTypes.ts's own registerProjectType() shape) -
// the generic `buildPlan` every package-declared project type shares,
// written once here rather than per package.
//
// Two load-time refusal checks keep a malformed plan/manifest pair from
// ever reaching the model: every `{arg}` placeholder in a promptTemplate
// must be a declared manifest arg that's either `required` or carries a
// JSON-Schema `default` (never a slot the model could leave unfilled),
// and no declared arg name may collide with a step's own id. The
// runner's own step-output interpolation (steps.ts's renderTemplate())
// uses a visually distinct double-brace `{{stepId}}` grammar - this
// file's own `{arg}` substitution is brace-guarded (see ARG_PLACEHOLDER
// below) so it never touches a `{{stepId}}` sequence even when both
// appear in the same promptTemplate; the arg-name/step-id check here
// guards against confusing the two BY NAME, a separate, real
// requirement, not a grammar-collision workaround.
import Ajv2020 from "ajv/dist/2020.js";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { ProjectType, ProjectTypeParamsSchema } from "./projectTypes";
import type { ProjectPlan, PlanStep } from "./types";
import { planSteps } from "./types";

// Its own Ajv instance, not plugins.ts's shared one: `useDefaults: true`
// mutates the object it validates to fill in a manifest arg's own
// JSON-Schema `default` when the model omits it - a behavior specific
// to this file's own buildPlan (below), never wanted on plugins.ts's
// existing package-args validation path.
const ajv = new Ajv2020({ strict: false, useDefaults: true });

// `{arg}` only - never `{{stepId}}`. The negative lookbehind/lookahead
// keep this from matching the INNER braces of a `{{stepId}}` sequence,
// so a promptTemplate that mixes both (an arg plus a reference to an
// earlier step's own output) substitutes only its own slots and leaves
// the runner's own placeholders untouched for steps.ts to fill later.
// `[\w-]+` (not just `\w+`): a manifest arg name is free to use a
// hyphen (nothing in manifest.schema.json's `args` field forbids one,
// and `params[name]` below reads it fine either way) - a review caught
// an earlier version here silently leaving a hyphenated slot like
// "{reader-age}" both unvalidated and unsubstituted.
const ARG_PLACEHOLDER = /(?<!\{)\{([\w-]+)\}(?!\})/g;

const EMPTY_ARGS_SCHEMA: ProjectTypeParamsSchema = { type: "object", properties: {}, additionalProperties: false };

// Only a primitive may be substituted into a promptTemplate: `String()`
// on an object or array arg (a package could otherwise declare a
// `type: "object"` arg and reference it directly) produces literal
// "[object Object]" text in a prompt sent to the generation model - a
// silently corrupted deliverable, not a validation failure, so this is
// checked at refusal time (below), never left to substituteArgs() to
// discover at call time.
const SAFE_PROMPT_ARG_TYPES = new Set(["string", "number", "integer", "boolean"]);

/** Accepts a scalar `type` ("string") or a JSON-Schema array `type`
 * (`["string", "null"]`, the ordinary way to declare a nullable
 * primitive) as long as every member is one of SAFE_PROMPT_ARG_TYPES or
 * "null" itself (safe to `String()` - it becomes the literal text
 * "null", no worse than any other value a person could type). A
 * re-review caught an earlier version reading only a literal string,
 * refusing a legitimate nullable-primitive arg outright. Anything else
 * (no `type` at all, a `$ref`, an `allOf`/`anyOf` composition) stays
 * refused - too little is known about the resolved shape to promise
 * substituting it is safe, and refusing is the fail-closed default. */
function isSafePromptArgType(declared: Record<string, unknown>): boolean {
  const declaredType = declared.type;
  const types = Array.isArray(declaredType) ? declaredType : [declaredType];
  return types.length > 0 && types.every((t) => t === "null" || (typeof t === "string" && SAFE_PROMPT_ARG_TYPES.has(t)));
}

interface ManifestArgsSchema {
  type?: string;
  properties?: Record<string, { default?: unknown } & Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
}

function argsSchemaOf(manifest: PackageManifest): ManifestArgsSchema {
  return (manifest.args ?? EMPTY_ARGS_SCHEMA) as ManifestArgsSchema;
}

// Only `text`/`media` steps have a `promptTemplate` at all (`tool`'s own
// `params.args` and `assemble`'s `inputs` carry no free-text field this
// grammar could apply to) - and `tool` steps aren't runnable yet
// (steps.ts's own UNIMPLEMENTED_STEP_KINDS), so a `{arg}` placeholder
// buried in a `tool` step's `args` is neither refused nor substituted
// today. A real, deliberately deferred gap: whichever item wires up
// `tool` steps needs to extend both this function and `planFilledWith()`
// below to cover it, not carry it silently.
function promptTemplatesIn(plan: ProjectPlan): string[] {
  return planSteps(plan)
    .map((step) => (step.kind === "text" || step.kind === "media" ? step.params.promptTemplate : null))
    .filter((t): t is string => typeof t === "string");
}

function argPlaceholdersIn(template: string): string[] {
  return [...template.matchAll(ARG_PLACEHOLDER)].map((m) => m[1]!);
}

/** Every real reason a manifest + plan pair is refused at registration
 * time, or null when it's fine to register. Checked once, at boot,
 * never per call - a package that fails this never reaches the model
 * at all (registerAllPackageProjectTypes() warns and skips it). */
function refusalReason(manifest: PackageManifest, plan: ProjectPlan): string | null {
  const argsSchema = argsSchemaOf(manifest);
  const properties = argsSchema.properties ?? {};
  const required = new Set(argsSchema.required ?? []);
  const stepIds = new Set(planSteps(plan).map((step) => step.id));

  for (const argName of Object.keys(properties)) {
    if (stepIds.has(argName)) {
      return `arg "${argName}" collides with a step id of the same name - rename one`;
    }
  }

  for (const template of promptTemplatesIn(plan)) {
    for (const slot of argPlaceholdersIn(template)) {
      const declared = properties[slot];
      if (!declared) return `promptTemplate references "{${slot}}", which is not a declared arg`;
      const hasDefault = Object.prototype.hasOwnProperty.call(declared, "default");
      if (!required.has(slot) && !hasDefault) {
        return `arg "${slot}" is used in a promptTemplate but is neither required nor given a default - the model could omit it and leave the slot unfilled`;
      }
      if (!isSafePromptArgType(declared)) {
        return `arg "${slot}" is used in a promptTemplate but isn't declared "string"/"number"/"integer"/"boolean" (or a nullable union of those) - substituting an object or array would silently corrupt the prompt`;
      }
    }
  }
  return null;
}

function substituteArgs(template: string, params: Record<string, unknown>): string {
  return template.replace(ARG_PLACEHOLDER, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** The plan template with every `{arg}` slot filled from `params` -
 * `{{stepId}}` slots (steps.ts's own grammar) are left exactly as they
 * are, for the runner to fill per-step once the project actually runs. */
function planFilledWith(plan: ProjectPlan, params: Record<string, unknown>): ProjectPlan {
  // "text" and "media" get the identical treatment on purpose, kept as
  // two branches rather than one `||` guard: `step` is narrowed to
  // `PlanTextStep | PlanMediaStep` either way, but spreading a unioned
  // `step.params` into one object literal loses TypeScript's own tie
  // between `kind` and its matching params shape (tsc rejects the
  // merged version - tried first, see the diff this comment replaced),
  // so each branch stays separately narrowed. See promptTemplatesIn()
  // above for what this still doesn't cover.
  const steps = planSteps(plan).map((step): PlanStep => {
    if (step.kind === "text") {
      return { ...step, params: { ...step.params, promptTemplate: substituteArgs(step.params.promptTemplate, params) } };
    }
    if (step.kind === "media") {
      return { ...step, params: { ...step.params, promptTemplate: substituteArgs(step.params.promptTemplate, params) } };
    }
    return step;
  });
  return { ...plan, steps: steps as ProjectPlan["steps"] };
}

export type ProjectTypeFromManifestResult = { ok: true; value: ProjectType } | { ok: false; error: string };

export function buildProjectTypeFromManifest(manifest: PackageManifest, plan: ProjectPlan): ProjectTypeFromManifestResult {
  const refusal = refusalReason(manifest, plan);
  if (refusal) return { ok: false, error: refusal };

  const paramsSchema = (manifest.args ?? EMPTY_ARGS_SCHEMA) as ProjectTypeParamsSchema;
  // Compiled once, here, at registration time - reused by every call
  // this type's own buildPlan ever gets, the same "compile once, reuse"
  // shape tool.ts's own compiledParamsValidators cache already uses for
  // its pre-check (a review's own finding there).
  const validate = ajv.compile(paramsSchema as object);

  return {
    ok: true,
    value: {
      id: manifest.id,
      title: manifest.display,
      description: manifest.description,
      minRole: manifest.min_role,
      consequential: manifest.consequential,
      paramsSchema,
      buildPlan: (params) => {
        // A shallow copy: ajv's useDefaults mutates the object it
        // validates in place, and this must never surprise a caller
        // still holding a reference to the original `params` object
        // (tool.ts's own `input.args.params`).
        const working: Record<string, unknown> = { ...params };
        if (!validate(working)) {
          // Defensive only: tool.ts's own pre-check already validated
          // shape before calling buildPlan() at all (ProjectType's own
          // doc comment) - this ajv instance differs only in
          // useDefaults, which fills gaps, never rejects something the
          // shape check already accepted.
          throw new Error(`${manifest.id}'s params failed validation: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
        }
        return planFilledWith(plan, working);
      },
    },
  };
}
