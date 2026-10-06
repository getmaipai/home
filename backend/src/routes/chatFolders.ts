import { createRoute, z } from "@hono/zod-openapi";
import { ChatFolder } from "@maipai/spec/gen/ts/chat-folder.js";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { createChatFolder, deleteChatFolder, listChatFolders, updateChatFolder } from "@/lib/chatFolders";

// PROJECTS-01a (CHAT-PROJECT-01): a person's projects in the chat column,
// stored as chat folders (spec/schemas/chat-folder.schema.json). The rules
// for who may see and change them live in lib/chatFolders.ts.
export const chatFoldersRoutes = apiRouter();

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Chat projects"],
  summary: "List a person's chat projects",
  middleware: [requireAuth] as const,
  request: {
    query: z.object({
      person: z.string().optional().describe("Whose projects; defaults to you. An owner or admin may name a child."),
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: z.array(ChatFolder) } }, description: "The person's live projects, in their order. Empty for a person you cannot see." },
    ...errorResponses({ 401: "Sign in first" }),
  },
});

const CreateBodySchema = z.object({
  name: z.string().describe("What to call the project (1 to 80 characters)."),
  person: z.string().nullable().optional().describe("Whose project; defaults to you. An owner or admin may make one for a child."),
});

const createRouteDef = createRoute({
  method: "post",
  path: "/",
  tags: ["Chat projects"],
  summary: "Make a chat project",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: CreateBodySchema } } } },
  responses: {
    201: { content: { "application/json": { schema: ChatFolder } }, description: "The new project." },
    ...errorResponses({ 400: "Missing or too long name", 401: "Sign in first", 403: "A child's projects are made by a parent", 404: "Person not found" }),
  },
});

const PatchBodySchema = z.object({
  name: z.string().optional().describe("A new name (1 to 80 characters)."),
  sort_order: z.number().int().min(0).optional().describe("A new position, lowest first."),
});

const patchRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Chat projects"],
  summary: "Rename or reorder a chat project",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "folder-example123"), body: { content: { "application/json": { schema: PatchBodySchema } } } },
  responses: {
    200: { content: { "application/json": { schema: ChatFolder } }, description: "The changed project." },
    ...errorResponses({ 400: "Nothing to change, or a bad value", 401: "Sign in first", 403: "A child's projects are changed by a parent", 404: "Project not found" }),
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
    200: { content: { "application/json": { schema: z.object({ ok: z.literal(true), chats_kept: z.number().int() }) } }, description: "Deleted. Its chats are kept and are no longer in a project." },
    ...errorResponses({ 401: "Sign in first", 403: "A child's projects are changed by a parent", 404: "Project not found" }),
  },
});

chatFoldersRoutes.openapi(listRoute, (c) => {
  return c.json(listChatFolders(c.get("person"), c.req.valid("query").person), 200);
});

chatFoldersRoutes.openapi(createRouteDef, (c) => {
  const body = c.req.valid("json");
  const result = createChatFolder(c.get("person"), { name: body.name, person: body.person });
  if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 403 | 404);
  return c.json(result.value, 201);
});

chatFoldersRoutes.openapi(patchRoute, (c) => {
  const result = updateChatFolder(c.get("person"), c.req.valid("param").id, c.req.valid("json"));
  if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 403 | 404);
  return c.json(result.value, 200);
});

chatFoldersRoutes.openapi(deleteRoute, (c) => {
  const result = deleteChatFolder(c.get("person"), c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, result.status as 403 | 404);
  return c.json({ ok: true as const, chats_kept: result.value.chats_kept }, 200);
});
