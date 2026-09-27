// PROJECT-RUN-01: the projects table's own CRUD, mirroring
// lib/relationships.ts's toRow()/toRecord() shape - every read and write
// crosses @maipai/spec's generated Project validator so a row is always
// the spec shape, never a second, drifting definition here. Unlike
// relationship.schema.json (snake_case), project.schema.json's own
// properties are already camelCase, so there's no field-name mapping
// beyond JSON-encoding the four nested shapes into their own text
// columns.
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { newProjectId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { Project } from "@maipai/spec/gen/ts/project.js";
import type { Project as ProjectT, ProjectPlan, ProjectProvenance } from "./types";

export type ProjectRow = typeof projects.$inferSelect;

function toProject(row: ProjectRow): ProjectT {
  return Project.parse({
    id: row.id,
    type: row.type,
    title: row.title,
    state: row.state,
    plan: JSON.parse(row.plan),
    steps: JSON.parse(row.steps),
    artifacts: JSON.parse(row.artifacts),
    provenance: JSON.parse(row.provenance),
    error: row.error,
    hlc: row.hlc,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toRow(project: ProjectT): typeof projects.$inferInsert {
  return {
    id: project.id,
    person: project.provenance.person,
    type: project.type,
    title: project.title,
    state: project.state,
    plan: JSON.stringify(project.plan),
    steps: JSON.stringify(project.steps),
    artifacts: JSON.stringify(project.artifacts),
    provenance: JSON.stringify(project.provenance),
    error: project.error,
    hlc: project.hlc,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export interface CreateProjectInput {
  type: string;
  title: string;
  plan: ProjectPlan;
  provenance: ProjectProvenance;
}

/** Always creates the row in `planned` state with every step `pending` -
 * the runner (runner.ts's start()) decides afterward whether the plan is
 * even runnable, and either launches it or flips this same row straight
 * to `failed` (never a half-run project, never one that never existed). */
export function createProject(input: CreateProjectInput): ProjectT {
  const now = new Date().toISOString();
  const candidate = Project.parse({
    id: newProjectId(),
    type: input.type,
    title: input.title,
    state: "planned",
    plan: input.plan,
    steps: input.plan.steps.map((step) => ({
      stepId: step.id,
      state: "pending" as const,
      startedAt: null,
      endedAt: null,
      error: null,
      artifactIds: [] as string[],
    })),
    artifacts: [],
    provenance: input.provenance,
    error: null,
    hlc: nextHlc(),
    createdAt: now,
    updatedAt: now,
  });
  db.insert(projects).values(toRow(candidate)).run();
  return candidate;
}

export function loadProject(id: string): ProjectT | null {
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  return row ? toProject(row) : null;
}

/** Re-stamps hlc/updatedAt and persists - the one place a project row is
 * ever written after createProject(), so every writer (the runner, a
 * plan-validation refusal) gets the same real clock stamp. */
export function saveProject(project: ProjectT): ProjectT {
  const saved = Project.parse({ ...project, updatedAt: new Date().toISOString(), hlc: nextHlc() });
  db.update(projects).set(toRow(saved)).where(eq(projects.id, saved.id)).run();
  return saved;
}

/** Boot-time resume candidates: anything not yet in a terminal state. */
export function listResumableProjects(): ProjectT[] {
  return db
    .select()
    .from(projects)
    .where(inArray(projects.state, ["planned", "running"]))
    .all()
    .map(toProject);
}

/** PROJECT-PROGRESS-01's own reload-path lookup, the identical shape
 * artifacts.ts's own artifactsByTurn() already is (batched by turn id,
 * one query, no N+1): conversationHistory.ts's listConversationTurns()
 * calls this so a reloaded turn that started a project still carries its
 * project id, the same way `row.artifact` already survives reload.
 * "No new column" (the design record's own words): `provenance.turnId`
 * lives inside the `provenance` JSON text column, never its own indexed
 * column, so this reads it with `json_extract` rather than adding one -
 * this table is small (a household's own projects, not a high-volume
 * log), so a per-row JSON read costs nothing worth indexing against
 * yet. A turn keyed twice (two projects sharing one turnId) can't
 * happen today - `start_project` is one tool call, one project - but if
 * it ever could, the last row this query returns wins, the same
 * "whichever the Map's insertion order leaves last" behavior
 * artifactsByTurn() already has for a turn with more than one version. */
export function projectsByTurn(turnIds: readonly string[]): Map<string, { id: string }> {
  if (turnIds.length === 0) return new Map();
  const turnIdExpr = sql<string>`json_extract(${projects.provenance}, '$.turnId')`;
  const rows = db
    .select({ id: projects.id, turnId: turnIdExpr })
    .from(projects)
    .where(inArray(turnIdExpr, turnIds))
    .all();
  return new Map(rows.map((row) => [row.turnId, { id: row.id }]));
}
