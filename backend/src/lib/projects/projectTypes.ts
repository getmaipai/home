// PROJECT-START-01 (docs/plans/harness-turns-and-projects-2026-09-26.md,
// "How a project starts" and "Recipes first"): the project-type registry
// `start_project` classifies against and builds a real ProjectPlan from.
// The design's own words: "every project type is a catalog package" that
// "ships a recipe... a typed, declarative list of steps with parameter
// slots the model fills". PROJECT-PKGTYPE-01 built the real mechanism -
// plugins.ts's registerAllPackageProjectTypes() reads every installed
// `kind: "project"` package's manifest + plan.json and registers it
// here through fromManifest.ts's buildProjectTypeFromManifest(). A real
// package now ships (PROJECT-PACK-01, `backend/packages/
// bedtime-storybook/`), so the placeholder built-in type this file used
// to seed (`bedtime-story`, a stand-in the same role assemblers.ts's
// "markdown-concat" and steps.ts's UNIMPLEMENTED_STEP_KINDS still play
// for their own not-yet-built neighbors) is gone: it was retired the
// night the real package shipped alongside it made the model pick the
// older, generic-sounding placeholder over the real one and fail a
// live bedtime-story request (its own `additionalProperties: false`
// rejecting the model's `audience`/`length` fields) - see docs/dev.md's
// dated section for the incident. Only registered project types now
// come from real packages; a household with none installed has
// `start_project` offered with nothing it can start, which is correct,
// not a regression to guard against with a hardcoded stand-in.
//
// `minRole`/`consequential` here are exactly the fields a package's own
// manifest.json already declares for an ordinary tool (plugins.ts's
// PackageManifest) - policy.ts reads them from HERE, by the model's own
// `type` argument, rather than from start_project's own manifest,
// because a project's real classification depends on what it starts, not
// on the fact that something starts it (the design record: "min_role
// from the project type's manifest... child rules from the type's
// manifest exactly as package tools declare them today").
import type { ProjectPlan } from "./types";

/** The subset of JSON Schema this registry actually reads (tool.ts's own
 * ajv.compile()) - deliberately loose, the same "arbitrary, not a $ref
 * into spec's own dialect" posture plugins.ts's own comment gives a
 * package manifest's `args` field. */
export interface ProjectTypeParamsSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ProjectType {
  id: string;
  /** Person-readable, becomes the project's own `title` (shown in the
   * thread, per project.schema.json's own description of that field). */
  title: string;
  /** What the model reads to decide whether this type fits the request -
   * folded into start_project's own tool description at offer time. */
  description: string;
  minRole: string;
  /** "Anything that spends real compute for minutes" (the design record)
   * - every project type built so far qualifies; named per-type rather
   * than hardcoded on the tool so a future, genuinely instant type isn't
   * forced through a confirmation it doesn't need. */
  consequential: boolean;
  paramsSchema: ProjectTypeParamsSchema;
  /** Fills the type's own step template with the model's params. Called
   * only after `paramsSchema` has already validated them (tool.ts) -
   * free to assume they're well-shaped. No separate `estimatedSeconds`
   * field: the starting turn's reply names the plan's own returned
   * `ceilings.maxWallSeconds` (tool.ts's `durationLabel()`) as the
   * duration, a real, enforced number rather than a second, hand-picked
   * one that could silently drift from what the runner would actually
   * cut the project off at (a review's own finding: an earlier draft
   * carried both, and nothing ever read the separate one). */
  buildPlan: (params: Record<string, unknown>) => ProjectPlan;
}

const registry = new Map<string, ProjectType>();

export function registerProjectType(type: ProjectType): void {
  registry.set(type.id, type);
}

export function getProjectType(id: string): ProjectType | undefined {
  return registry.get(id);
}

export function listProjectTypes(): ProjectType[] {
  return [...registry.values()];
}

/** Test-only: clears every registered project type back to empty. No
 * built-in is re-seeded (there is none) - a test that needs a project
 * type registers its own fixture via `registerProjectType()` right
 * after calling this, the same way plugins.test.ts and
 * project-pack-01-live.ts already register real ones. */
export function __resetProjectTypesForTests(): void {
  registry.clear();
}
