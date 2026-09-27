// PROJECT-START-01 (docs/plans/harness-turns-and-projects-2026-09-26.md,
// "How a project starts" and "Recipes first"): the project-type registry
// `start_project` classifies against and builds a real ProjectPlan from.
// The design's own words: "every project type is a catalog package" that
// "ships a recipe... a typed, declarative list of steps with parameter
// slots the model fills". PROJECT-PKGTYPE-01 built the real mechanism -
// plugins.ts's registerAllPackageProjectTypes() reads every installed
// `kind: "project"` package's manifest + plan.json and registers it
// here through fromManifest.ts's buildProjectTypeFromManifest() - but no
// such package actually ships yet (PROJECT-PACK-01, the coloring book,
// is still unbuilt), so `registerBuiltInProjectTypes()` below still
// seeds one hardcoded entry, the same stand-in role assemblers.ts's
// "markdown-concat" and steps.ts's UNIMPLEMENTED_STEP_KINDS already play
// for their own not-yet-built neighbors: a household with no project
// packages installed would otherwise have `start_project` offered with
// nothing it could ever start.
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

export function __resetProjectTypesForTests(): void {
  registry.clear();
  registerBuiltInProjectTypes();
}

function registerBuiltInProjectTypes(): void {
  // One built-in type, proving the whole start_project mechanism (offer,
  // classify, build a real ProjectPlan, run it, name a duration, post
  // the result) with a text-only plan - exactly the design record's own
  // "a text-only storybook variant may prove the runner before media
  // exists" (PROJECT-PACK-01's own line), the same stand-in role
  // assemblers.ts's "markdown-concat" plays. Retired the day
  // PROJECT-PACK-01 actually ships a real catalog package with its own
  // plan.json - not the day the loader that WOULD register one exists
  // (PROJECT-PKGTYPE-01, this file's own header above): removing this
  // hardcoded entry before PROJECT-PACK-01 lands would leave every
  // household with zero registered project types and `start_project`
  // offered with nothing it could ever start, a real regression for no
  // gain - PROJECT-PKGTYPE-01's own loader is proven separately, against
  // a real fixture package, in plugins.test.ts.
  registerProjectType({
    id: "bedtime-story",
    title: "a bedtime story",
    description: "Write a short, original bedtime story with a title page - for a topic that needs a real story written, not a quick answer.",
    minRole: "child",
    consequential: true,
    paramsSchema: {
      type: "object",
      required: ["topic"],
      properties: {
        topic: { type: "string", minLength: 1, description: "What the story is about." },
        readerAge: { type: "integer", minimum: 2, maximum: 12, description: "The child's age, if known." },
      },
      additionalProperties: false,
    },
    buildPlan: (params) => {
      const topic = typeof params.topic === "string" && params.topic.trim() ? params.topic.trim() : "a small adventure";
      const readerAge = typeof params.readerAge === "number" ? params.readerAge : 6;
      return {
        steps: [
          {
            id: "story",
            kind: "text",
            needs: [],
            params: {
              role: "chat",
              promptTemplate: `Write a short, gentle bedtime story for a ${readerAge}-year-old about ${topic}. Keep it kind and simple: a title, then a few short paragraphs, a happy or comforting ending.`,
              inputs: [],
            },
          },
          {
            id: "book",
            kind: "assemble",
            needs: ["story"],
            params: { assembler: "markdown-concat", inputs: ["story"] },
          },
        ],
        ceilings: { maxWallSeconds: 120, maxGeneratorJobs: 1 },
      };
    },
  });
}

registerBuiltInProjectTypes();
