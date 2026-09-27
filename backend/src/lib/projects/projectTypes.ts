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
   * thread, per project.schema.json's own description of that field).
   * No one fixed grammatical shape: a package's own manifest.json can
   * read like a proper noun ("Bedtime storybook") or, same as the
   * placeholder fixture backend/tests/projects/startProject.test.ts
   * registers, a lowercase noun phrase carrying its own article ("a
   * bedtime story") - `sentenceInitial()` below is for the one place
   * that distinction actually bites: splicing `title` in as a
   * sentence's own FIRST word. */
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

// A code review caught this (2026-09-27): policy.ts's own confirm
// prompt and post.ts's own finishedReplyText() both splice a
// ProjectType's `title` in as a sentence's first word - fine for the
// proper-noun-style titles, but the noun-phrase-style ones (this
// module's own doc comment above) produced a reply that opened
// lowercase. Not `sentenceCaseOpener()` (turnEngine.ts): that one is
// deliberately scoped to a MODEL reply's own opener, never "a
// package's own reply... left as authored" per its own comment - a
// project's title isn't authored prose at all, it's a data field, so
// the right fix is at the splice point. Lives here, not in tool.ts or
// post.ts, to avoid a real import cycle: tool.ts's own `startProject()`
// comes from runner.ts, which calls post.ts's `postProjectResult()`
// directly - this module imports neither.
export function sentenceInitial(title: string): string {
  return title.length > 0 ? title.charAt(0).toUpperCase() + title.slice(1) : title;
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
