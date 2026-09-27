// PROJECT-START-01 (docs/BACKLOG.md: "progress on the tool-event surface
// ... cancel from the thread"). The design record's own progress line
// ("Progress appears in the thread as the existing tool-event/status
// surface") describes how progress LOOKS, not a transport - the only
// existing tool-event/status channel (statusChannel.ts) is scoped to one
// turn's own live SSE response and closes the moment that response ends,
// and there is no precedent anywhere in this codebase for a background
// process pushing into a channel that outlives its own triggering turn
// (a design-resolver pass, 2026-09-26, confirmed this reading against
// scheduler.ts's own timer.done, the only prior art for "something
// finishes in the background": it fires a notification only, nothing
// live). So this item's own wiring is an ordinary REST read of the
// stored Project row (the exact StepState/artifact trace PROJECT-RUN-01
// already persists) - a client polls or reads it on reconnect, the same
// posture NotificationBell.tsx's own refetchInterval already has for
// notifications. A live per-conversation push transport is real,
// separate platform machinery the design never names; it's a later item,
// not this one's scope.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { canAccessPerson } from "@/lib/access";
import { loadProject } from "@/lib/projects/store";
import { cancel as cancelProject, liveProject } from "@/lib/projects/runner";
import { postedProjectArtifact } from "@/lib/projects/post";
import { Project } from "@maipai/spec/gen/ts/project.js";
import type { AppEnv, PersonRow } from "@/types";

export const projectsRoutes = apiRouter();

// PROJECT-PROGRESS-01: an additive sibling field on the GET response,
// the same `.extend()` shape routes/updates.ts's own UpdatesResponseSchema
// already uses to carry a derived value beside a spec-generated schema -
// never a second field folded into the Project spec record itself
// (post.ts's own artifact is a real, separate row, not this record's
// own state). Null while the project hasn't posted one yet: still
// running, `cancelled` (post.ts's own header - the one terminal state
// that never posts one), or the brief FK-race window post.ts's own
// header also names for a `done`/`failed` project that finished before
// its own turn row existed. `.describe()` re-added below: a code review
// caught `.extend()` silently dropping the base Project schema's own
// description from the generated OpenAPI doc otherwise, since `.extend()`
// returns a new object schema without carrying the source's metadata.
const ProjectWithPostedArtifact = Project.extend({
  posted_artifact: z.union([z.object({ id: z.string(), version: z.number() }), z.null()]),
}).describe(
  "A durable unit of background work a turn started: a plan of typed steps, their runtime state, and the artifacts they produced. The turn replies immediately; the project runs after it, survives restarts, and posts its artifacts back to the thread.",
);

/** The same access shape `visibleArtifactRow()` (routes/artifacts.ts)
 * already applies to a turn's own artifact: the project's own person, or
 * an owner/admin for a child's project - never another adult's. */
function canSeeProject(actor: PersonRow, project: ReturnType<typeof loadProject>): boolean {
  return project !== null && canAccessPerson(actor, project.provenance.person);
}

const getRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Projects"],
  summary: "Read one project's current state",
  description: "The stored plan, each step's own state, and any artifacts so far - a client polls this for progress. Visible to the project's own person, or an owner/admin for a child's project.",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "proj-example123") },
  responses: {
    200: { content: { "application/json": { schema: ProjectWithPostedArtifact } }, description: "The project's current state." },
    ...errorResponses({ 401: "Sign in first", 404: "Project not found" }),
  },
});

projectsRoutes.openapi(getRoute, (c) => {
  const actor = c.get("person");
  const id = c.req.valid("param").id;
  // PROJECT-PROGRESS-01: liveProject() first, whenever this process has
  // a live actor for the id - runner.ts's own header explains why the
  // persisted row alone (loadProject()) only updates once per finished
  // batch, never per step. Falls back to the persisted row once the
  // project is terminal or this process never launched it (a restart).
  const project = liveProject(id) ?? loadProject(id);
  if (!project || !canSeeProject(actor, project)) return c.json({ error: "project not found" }, 404);
  return c.json({ ...project, posted_artifact: postedProjectArtifact(id) }, 200);
});

const cancelRoute = createRoute({
  method: "post",
  path: "/{id}/cancel",
  tags: ["Projects"],
  summary: "Cancel a running project",
  description: "Stops a running or planned project (design record: 'Cancel is a first-class action from the thread'). No notification and nothing posted to the thread - the person asking already knows.",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "proj-example123") },
  responses: {
    202: { content: { "application/json": { schema: Project } }, description: "Cancellation sent; the project's own state as of right now." },
    ...errorResponses({ 401: "Sign in first", 404: "Project not found", 409: "Already finished - nothing to cancel" }),
  },
});

projectsRoutes.openapi(cancelRoute, (c) => {
  const actor = c.get("person");
  const id = c.req.valid("param").id;
  const project = loadProject(id);
  if (!project || !canSeeProject(actor, project)) return c.json({ error: "project not found" }, 404);
  const sent = cancelProject(id);
  if (!sent) return c.json({ error: `project ${id} already finished - there's no live run to cancel` }, 409);
  return c.json(loadProject(id) ?? project, 202);
});
