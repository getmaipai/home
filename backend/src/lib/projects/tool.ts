// PROJECT-START-01: `start_project` itself, the model's own tool for
// starting a project (docs/plans/harness-turns-and-projects-2026-09-26.md,
// "How a project starts"). A virtual tool, the same shape nodes/model.ts's
// own (now retired) `answer_from_this_conversation` was: no
// backend/packages/start_project directory, no manifest.json, no recipe.json - `runPlugin()`'s generic op vocabulary
// (integration.call, pick, format, artifact...) has no op for "start a
// background job and return immediately while it keeps running," so this
// tool is special-cased at its own three touch points (nodes/model.ts's
// toolSpecFor(), nodes/policy.ts's policyNode, nodes/tool.ts's toolNode),
// never routed through plugins.ts's loadManifestOnly()/runPlugin() at all.
//
// Its own classification is deliberately NOT hardcoded here (the design
// record: "the package/recipe declares this, the tool doesn't hardcode
// it") - every real decision (min_role, consequential, the plan itself)
// comes from projectTypes.ts's registry, keyed by the model's own `type`
// argument, the same way an ordinary package tool's manifest.json
// carries its own for policy.ts to read.
import Ajv2020 from "ajv/dist/2020.js";
import { outcomeOf, type ToolExecutionOutcome } from "@/lib/turnContext";
import type { ToolSpec } from "@/lib/llm";
import type { PersonRow } from "@/types";
import { getProjectType, listProjectTypes, type ProjectType, type ProjectTypeParamsSchema } from "./projectTypes";
import { start as startProject } from "./runner";

export const START_PROJECT_TOOL_ID = "start_project";

const ajv = new Ajv2020({ strict: false });

const START_PROJECT_BASE_DESCRIPTION =
  "Start a background project for a deliverable that genuinely needs several generation steps or minutes of work - a written story, a multi-part document, something one reply can't finish. Only call this when a normal reply cannot do the job; most requests should just be answered directly.";

/** PROJECT-PKGTYPE-03 (docs/dev.md, 2026-09-27 - the live incident's
 * second failure): the tool's own `params` argument is one opaque,
 * propertyless object shared across every registered type (a real
 * per-type JSON-Schema conditional keyed on `type` is a bigger, riskier
 * change than tonight's fix, and out of scope - see the dated section),
 * so nothing before this told the model what fields a given type's
 * `params` actually takes; it only saw the type's plain-language
 * `description`, which says nothing about the call shape, and it
 * guessed a plausible-sounding one wrong. This renders a type's own
 * `paramsSchema` as plain, structured text - generated fresh from
 * whatever `properties`/`required` any registered type's schema
 * actually carries, never hand-typed per type, so a future package's
 * own project type needs nothing added here to be described correctly.
 * Returns "" for a schema with no properties (the empty-args case),
 * never a bare "Params: " with nothing after it. */
export function paramsSummary(schema: ProjectTypeParamsSchema): string {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const names = Object.keys(properties);
  if (names.length === 0) return "";
  const parts = names.map((name) => {
    const propSchema = (properties[name] ?? {}) as { type?: unknown; default?: unknown };
    const type = typeof propSchema.type === "string" ? propSchema.type : "any";
    const hasDefault = Object.prototype.hasOwnProperty.call(propSchema, "default");
    const requirement = required.has(name) ? "required" : hasDefault ? `optional, default ${JSON.stringify(propSchema.default)}` : "optional";
    return `${name} (${type}, ${requirement})`;
  });
  return `Params: ${parts.join(", ")}.`;
}

/** PROJECT-PKGTYPE-01: built fresh from the registry on every call
 * (never a static const - registerAllPackageProjectTypes() runs at
 * boot, so which types exist can change between boots, and nothing
 * before this told the model which ones do). `type`'s own enum is the
 * real list of registered ids, and the tool's own description names
 * each one with its own one-line description, the same way an ordinary
 * package tool's manifest.description already reaches the model - a
 * registry with nothing in it still returns a real ToolSpec (an empty
 * enum), never throws; toolSpecFor() callers treat that the same as
 * any other tool with nothing to offer. PROJECT-PKGTYPE-03 also folds
 * each type's own `paramsSummary()` in, right after its description, so
 * the model is told the real call shape, not just the marketing-style
 * pitch. */
export function startProjectToolSpec(): ToolSpec {
  const types = listProjectTypes();
  const typeLines = types
    .map((t) => {
      const summary = paramsSummary(t.paramsSchema);
      return summary ? `"${t.id}": ${t.description} ${summary}` : `"${t.id}": ${t.description}`;
    })
    .join(" ");
  return {
    id: START_PROJECT_TOOL_ID,
    description: types.length > 0 ? `${START_PROJECT_BASE_DESCRIPTION} Registered project types: ${typeLines}` : START_PROJECT_BASE_DESCRIPTION,
    args: {
      type: "object",
      required: ["type"],
      properties: {
        type: { type: "string", minLength: 1, enum: types.map((t) => t.id), description: "Which kind of project to start." },
        params: { type: "object", description: "The project's own parameters - which fields it takes depends on the type." },
      },
      additionalProperties: false,
    },
  };
}

export interface StartProjectArgs {
  type?: unknown;
  params?: unknown;
}

/** policy.ts's own classification read: unlike an ordinary package tool
 * (loadManifestOnly(call.tool)), a `start_project` call is classified by
 * its OWN `type` argument, never by a fixed manifest on the tool itself -
 * this is that lookup, shared so policy.ts and tool.ts (the node) agree
 * on exactly one reading of `args.type`. */
export function projectTypeForArgs(args: unknown): ProjectType | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const type = (args as StartProjectArgs).type;
  return typeof type === "string" ? getProjectType(type) : undefined;
}

// A project type's paramsSchema never changes after registration, so its
// compiled validator is cached by type id rather than re-compiled on
// every single start_project call (a review's own finding) - the same
// "compile once, reuse" shape ajv itself recommends, keyed here rather
// than on ProjectType itself since the registry (projectTypes.ts) has no
// reason to know ajv exists.
const compiledParamsValidators = new Map<string, ReturnType<typeof ajv.compile>>();

function validateParams(projectType: ProjectType, params: Record<string, unknown>): string | null {
  let validate = compiledParamsValidators.get(projectType.id);
  if (!validate) {
    validate = ajv.compile(projectType.paramsSchema as object);
    compiledParamsValidators.set(projectType.id, validate);
  }
  if (validate(params)) return null;
  return ajv.errorsText(validate.errors, { separator: "; " });
}

/** "About N minutes/seconds" - the only number the starting turn's own
 * reply ever names (nodes/answer.ts's phrasing round relays this outcome's
 * own `reply.text` verbatim or near-verbatim), always derived from the
 * plan's real `ceilings.maxWallSeconds`, never a guess independent of the
 * ceiling that could actually stop the run. */
export function durationLabel(seconds: number): string {
  if (seconds < 90) {
    const rounded = Math.max(10, Math.round(seconds / 10) * 10);
    return `about ${rounded} seconds`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export interface RunStartProjectInput {
  actor: PersonRow;
  args: StartProjectArgs;
  callId: string;
  conversationId: string;
  turnId: string;
  /** Mirrors the design record's own incognito/temporary retention rule
   * ("its provenance then records the person and no thread") - set from
   * TurnState.temporary, the same flag policy.ts's own temporary_mode
   * check already reads. */
  temporary: boolean;
}

/** nodes/tool.ts's own special case for this one tool id: builds the plan
 * from the named project type, starts the runner (PROJECT-RUN-01's own
 * start() - synchronous: the row is created and the background actor
 * launched before this returns; the project itself keeps running after
 * this turn's own reply goes out), and returns an outcome whose `reply.
 * text` already names the plan and its duration in plain words - the
 * phrasing round every other tool's outcome already goes through
 * (nodes/model.ts) relays it, never invents its own number. */
export function runStartProjectTool(input: RunStartProjectInput): ToolExecutionOutcome {
  const projectType = projectTypeForArgs(input.args);
  if (!projectType) {
    const type = typeof input.args.type === "string" ? input.args.type : "(missing)";
    return outcomeOf({
      callId: input.callId,
      packageId: START_PROJECT_TOOL_ID,
      status: "failed",
      via: "tool_call",
      args: input.args as Record<string, unknown>,
      errorCode: "unknown_project_type",
      userMessage: `there's no project type "${type}"`,
    });
  }
  const params = input.args.params && typeof input.args.params === "object" ? (input.args.params as Record<string, unknown>) : {};
  const paramsError = validateParams(projectType, params);
  if (paramsError) {
    return outcomeOf({
      callId: input.callId,
      packageId: START_PROJECT_TOOL_ID,
      status: "failed",
      via: "tool_call",
      args: input.args as Record<string, unknown>,
      errorCode: "invalid_params",
      userMessage: `${projectType.title}'s own inputs failed validation: ${paramsError}`,
    });
  }
  const plan = projectType.buildPlan(params);
  const provenance = input.temporary
    ? { person: input.actor.id, conversationId: null, turnId: null, planSource: "package" as const }
    : { person: input.actor.id, conversationId: input.conversationId, turnId: input.turnId, planSource: "package" as const };
  const project = startProject({ type: projectType.id, title: projectType.title, plan, provenance });
  if (project.state === "failed") {
    return outcomeOf({
      callId: input.callId,
      packageId: START_PROJECT_TOOL_ID,
      status: "failed",
      via: "tool_call",
      args: input.args as Record<string, unknown>,
      errorCode: "project_refused",
      userMessage: project.error ?? "that project couldn't start",
    });
  }
  const stepCount = plan.steps.length;
  // Jesse found live (2026-09-27): "Starting Bedtime storybook now - 5
  // steps, about 8 minutes" reads like a log line, not something a
  // person said - `stepCount` is dropped from the sentence entirely
  // (still returned below in `data` for anything that wants it), and
  // the real, ceiling-backed duration moves in beside a plain verb
  // instead of trailing after a dash-separated list of facts.
  const text = `Creating ${project.title} - ${durationLabel(plan.ceilings.maxWallSeconds)}.`;
  return outcomeOf({
    callId: input.callId,
    packageId: START_PROJECT_TOOL_ID,
    status: "succeeded",
    via: "tool_call",
    args: input.args as Record<string, unknown>,
    result: {
      reply: { text },
      data: { projectId: project.id, title: project.title, stepCount, estimatedSeconds: plan.ceilings.maxWallSeconds },
      actions: [{ kind: "project_started", payload: { projectId: project.id } }],
    },
  });
}
