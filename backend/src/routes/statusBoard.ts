import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { clearNote, createMaintenance, getActiveNote, listMaintenance, postNote, cancelMaintenance, StatusBoardError } from "@/lib/statusBoard";
import { requireAuth, requireRole } from "@/middleware/auth";
import { MaintenanceWindow } from "@maipai/spec/gen/ts/maintenance-window.js";
import { StatusNote } from "@maipai/spec/gen/ts/status-note.js";

export const statusBoardRoutes = apiRouter();
const NoteInput = z.object({ body: z.string().min(1).max(500), expires_at: z.string().datetime({ offset: true }).optional() });
const MaintenanceInput = z.object({ title: z.string().min(1).max(120), description: z.string().max(1000).optional(),
  components: z.array(z.enum(["chat", "embed", "background", "voice", "library", "hub"])).min(1),
  starts_at: z.string().datetime({ offset: true }), ends_at: z.string().datetime({ offset: true }) });
const BoardNote = z.object({ id: z.string(), body: z.string(), posted_at: z.string(), posted_by_name: z.string() });
const BoardMaintenance = z.object({ id: z.string(), title: z.string(), description: z.string(), components: z.array(z.string()),
  starts_at: z.string(), ends_at: z.string(), status: z.enum(["cancelled", "scheduled", "in_progress", "completed"]) });
const BoardResponse = z.object({ note: BoardNote.nullable(), maintenance: z.array(BoardMaintenance) });
const IdParam = idParamSchema("id", "maint-a1b2c3");

const boardRoute = createRoute({ method: "get", path: "/board", tags: ["Status"], summary: "Read the household status board",
  middleware: [requireAuth] as const, responses: { 200: { content: { "application/json": { schema: BoardResponse } }, description: "Current status note and scheduled maintenance." },
    ...errorResponses({ 401: "Not signed in" }) } });
statusBoardRoutes.openapi(boardRoute, (c) => {
  const note = getActiveNote();
  const poster = note ? db.select({ displayName: people.displayName }).from(people).where(eq(people.id, note.posted_by)).get() : undefined;
  const maintenance = listMaintenance().map(({ id, title, description, components, starts_at, ends_at, status }) => ({ id, title, description, components, starts_at, ends_at, status }));
  return c.json({ note: note && poster ? { id: note.id, body: note.body, posted_at: note.posted_at, posted_by_name: poster.displayName } : null, maintenance }, 200);
});

function errorResponse(c: { json: (body: { error: string }, status: 400 | 404 | 409) => Response }, error: unknown) {
  if (error instanceof StatusBoardError) return c.json({ error: error.message }, error.status);
  throw error;
}

const postNoteRoute = createRoute({ method: "post", path: "/note", tags: ["Status"], summary: "Post the status note",
  middleware: [requireRole("owner", "admin")] as const, request: { body: { content: { "application/json": { schema: NoteInput } } } },
  responses: { 201: { content: { "application/json": { schema: StatusNote } }, description: "The posted note." }, ...errorResponses({ 400: "The note is invalid", 401: "Not signed in", 403: "Owner/admin only" }) } });
statusBoardRoutes.openapi(postNoteRoute, (c) => {
  const input = c.req.valid("json"); const actor = c.get("person");
  try { return c.json(postNote({ id: actor.id, displayName: actor.displayName }, { body: input.body, expiresAt: input.expires_at }), 201); }
  catch (error) { return errorResponse(c, error) as never; }
});

const clearNoteRoute = createRoute({ method: "delete", path: "/note", tags: ["Status"], summary: "Clear the status note",
  middleware: [requireRole("owner", "admin")] as const, responses: { 204: { description: "The active note was cleared." }, ...errorResponses({ 401: "Not signed in", 403: "Owner/admin only" }) } });
statusBoardRoutes.openapi(clearNoteRoute, (c) => { const actor = c.get("person"); clearNote({ id: actor.id, displayName: actor.displayName }); return c.body(null, 204); });

const createMaintenanceRoute = createRoute({ method: "post", path: "/maintenance", tags: ["Status"], summary: "Schedule maintenance",
  middleware: [requireRole("owner", "admin")] as const, request: { body: { content: { "application/json": { schema: MaintenanceInput } } } },
  responses: { 201: { content: { "application/json": { schema: MaintenanceWindow } }, description: "The scheduled maintenance window." }, ...errorResponses({ 400: "The maintenance window is invalid", 401: "Not signed in", 403: "Owner/admin only" }) } });
statusBoardRoutes.openapi(createMaintenanceRoute, (c) => {
  const input = c.req.valid("json"); const actor = c.get("person");
  try { return c.json(createMaintenance({ id: actor.id, displayName: actor.displayName }, { title: input.title, description: input.description, components: input.components, startsAt: input.starts_at, endsAt: input.ends_at }), 201); }
  catch (error) { return errorResponse(c, error) as never; }
});

const cancelRoute = createRoute({ method: "post", path: "/maintenance/{id}/cancel", tags: ["Status"], summary: "Cancel a maintenance window",
  middleware: [requireRole("owner", "admin")] as const, request: { params: IdParam },
  responses: { 200: { content: { "application/json": { schema: MaintenanceWindow } }, description: "The cancelled maintenance window." }, ...errorResponses({ 401: "Not signed in", 403: "Owner/admin only", 404: "Maintenance window not found", 409: "Window is completed or already cancelled" }) } });
statusBoardRoutes.openapi(cancelRoute, (c) => {
  const actor = c.get("person");
  try { return c.json(cancelMaintenance({ id: actor.id, displayName: actor.displayName }, c.req.valid("param").id), 200); }
  catch (error) { return errorResponse(c, error) as never; }
});
