import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { ChatFolderView, createChatFolder, deleteChatFolder, getChatFolder, listChatFolders, removeFolderShare, setFolderShare, updateChatFolder } from "@/lib/chatFolders";

// PROJECTS-01a (CHAT-PROJECT-01), PROJECTS-P1: a person's projects in the chat
// column and on the projects pages, stored as chat folders
// (spec/schemas/chat-folder.schema.json). Every response is the spec record
// plus access, counts and last_activity_at (ChatFolderView). The rules for who
// may see and change them live in lib/chatFolders.ts.
export const chatFoldersRoutes = apiRouter();

const ListQuery = z.object({
  person: z.string().optional().describe("Whose projects; defaults to you. An owner or admin may name a child."),
  q: z.string().optional().describe("Search the name and description, case-insensitively."),
  archived: z.enum(["true", "false"]).optional().describe("true lists only archived projects; the default lists the rest."),
  scope: z.enum(["mine", "shared", "all"]).optional().describe("mine (default): the person's own. shared: projects others shared with you. all: both."),
  sort: z.enum(["order", "updated"]).optional().describe("order (default): sort_order then newest. updated: last activity first. Pinned projects always lead."),
});

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Chat projects"],
  summary: "List chat projects",
  middleware: [requireAuth] as const,
  request: { query: ListQuery },
  responses: {
    200: { content: { "application/json": { schema: z.array(ChatFolderView) } }, description: "The matching live projects. Empty for a person you cannot see." },
    ...errorResponses({ 401: "Sign in first" }),
  },
});

const LookFields = {
  color: z.unknown().optional().describe("One of neutral, blue, violet, teal, orange, pink, red, green, yellow."),
  icon: z.unknown().optional().describe("A name from the project icon list (spec vocab/project-icons.json)."),
  description: z.unknown().optional().describe("Up to 500 characters, shown to people, never sent to the model."),
  instructions: z.unknown().optional().describe("Up to 1500 characters the model follows in this project's chats."),
  memory_mode: z.unknown().optional().describe("shared or project_only. A new project defaults to project_only."),
};

const CreateBodySchema = z.object({
  name: z.string().describe("What to call the project (1 to 80 characters)."),
  person: z.string().nullable().optional().describe("Whose project; defaults to you. An owner or admin may make one for a child."),
  ...LookFields,
});

const createRouteDef = createRoute({
  method: "post",
  path: "/",
  tags: ["Chat projects"],
  summary: "Make a chat project",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: CreateBodySchema } } } },
  responses: {
    201: { content: { "application/json": { schema: ChatFolderView } }, description: "The new project." },
    ...errorResponses({ 400: "Missing or too long name, or a bad field", 401: "Sign in first", 403: "A child's projects are made by a parent", 404: "Person not found" }),
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Chat projects"],
  summary: "One chat project with its counts",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "folder-example123") },
  responses: {
    200: { content: { "application/json": { schema: ChatFolderView } }, description: "The project, with counts of its chats, files and artifacts." },
    ...errorResponses({ 401: "Sign in first", 404: "Project not found" }),
  },
});

const PatchBodySchema = z.object({
  name: z.string().optional().describe("A new name (1 to 80 characters)."),
  sort_order: z.number().int().min(0).optional().describe("A new position, lowest first (owner only)."),
  pinned: z.boolean().optional().describe("Pin or unpin (owner only)."),
  archived: z.boolean().optional().describe("Archive or unarchive (owner only)."),
  ...LookFields,
});

const patchRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Chat projects"],
  summary: "Edit a chat project: rename, look, notes, pin, archive, memory",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "folder-example123"), body: { content: { "application/json": { schema: PatchBodySchema } } } },
  responses: {
    200: { content: { "application/json": { schema: ChatFolderView } }, description: "The changed project." },
    ...errorResponses({ 400: "Nothing to change, or a bad value", 401: "Sign in first", 403: "You may not change that", 404: "Project not found" }),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Chat projects"],
  summary: "Delete a chat project and keep its chats",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "folder-example123") },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ok: z.literal(true), chats_kept: z.number().int(), files_removed: z.number().int().describe("0 until projects hold files.") }) } },
      description: "Deleted. Its chats are kept and are no longer in a project.",
    },
    ...errorResponses({ 401: "Sign in first", 403: "Only the owner (or a parent for a child) deletes", 404: "Project not found" }),
  },
});

const ShareParams = z.object({ id: z.string().describe("The project id."), person: z.string().describe("The household member's person id.") });

const putShareRoute = createRoute({
  method: "put",
  path: "/{id}/shares/{person}",
  tags: ["Chat projects"],
  summary: "Share a project with a household member, or change their role",
  middleware: [requireAuth] as const,
  request: { params: ShareParams, body: { content: { "application/json": { schema: z.object({ role: z.string().describe("can_use or can_edit.") }) } } } },
  responses: {
    200: { content: { "application/json": { schema: ChatFolderView } }, description: "The project with its updated share list. Sharing makes the project project_only for memory." },
    ...errorResponses({ 400: "Bad role or target", 401: "Sign in first", 403: "Only the owner shares; only a parent adds a child", 404: "Project or person not found" }),
  },
});

const deleteShareRoute = createRoute({
  method: "delete",
  path: "/{id}/shares/{person}",
  tags: ["Chat projects"],
  summary: "Remove a member from a project, or leave it yourself",
  middleware: [requireAuth] as const,
  request: { params: ShareParams },
  responses: {
    200: { content: { "application/json": { schema: z.union([ChatFolderView, z.object({ left: z.literal(true) })]) } }, description: "The project with its updated share list, or { left: true } when you left." },
    ...errorResponses({ 401: "Sign in first", 403: "Only the owner removes others", 404: "Project or member not found" }),
  },
});

chatFoldersRoutes.openapi(listRoute, (c) => {
  const q = c.req.valid("query");
  return c.json(listChatFolders(c.get("person"), { person: q.person, q: q.q, archived: q.archived === "true", scope: q.scope, sort: q.sort }), 200);
});

chatFoldersRoutes.openapi(createRouteDef, (c) => {
  const result = createChatFolder(c.get("person"), c.req.valid("json"));
  if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 403 | 404);
  return c.json(result.value, 201);
});

chatFoldersRoutes.openapi(getRoute, (c) => {
  const result = getChatFolder(c.get("person"), c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result.value, 200);
});

chatFoldersRoutes.openapi(patchRoute, (c) => {
  const result = updateChatFolder(c.get("person"), c.req.valid("param").id, c.req.valid("json"));
  if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 403 | 404);
  return c.json(result.value, 200);
});

chatFoldersRoutes.openapi(deleteRoute, (c) => {
  const result = deleteChatFolder(c.get("person"), c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, result.status as 403 | 404);
  return c.json({ ok: true as const, ...result.value }, 200);
});

chatFoldersRoutes.openapi(putShareRoute, (c) => {
  const { id, person } = c.req.valid("param");
  const result = setFolderShare(c.get("person"), id, person, c.req.valid("json").role);
  if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 403 | 404);
  return c.json(result.value, 200);
});

chatFoldersRoutes.openapi(deleteShareRoute, (c) => {
  const { id, person } = c.req.valid("param");
  const result = removeFolderShare(c.get("person"), id, person);
  if (!result.ok) return c.json({ error: result.error }, result.status as 403 | 404);
  return c.json(result.value, 200);
});
