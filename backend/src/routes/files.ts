// STORE-SHARE-01: the Library's own HTTP boundary - lib/shares.ts and
// lib/attachments.ts hold the rules, this is only the wire, the same
// split routes/lists.ts already takes over lib/lists.ts.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { getAttachment } from "@/lib/attachments";
import { createShare, deleteShare, listSharesForFile, listFilesVisibleToActor } from "@/lib/shares";
import { File as FileSchema } from "@maipai/spec/gen/ts/file.js";
import { Share as ShareSchema } from "@maipai/spec/gen/ts/share.js";

export const filesRoutes = apiRouter();
// A share is its own addressable resource (share.schema.json), so its
// one route (unsharing) is a separate router mounted at /api/shares in
// app.ts - the URL a client PATCH/DELETEs against a share should read
// share-shaped, not nested under /api/files/shares/{id}.
export const sharesRoutes = apiRouter();

const VisibleFileSchema = z.object({ file: FileSchema, owner_person_id: z.string(), shared: z.boolean() });

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Files"],
  summary: "My own Library: files I own, plus files shared with me (by name or by the household)",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(VisibleFileSchema) } }, description: "A shared file is listed under its real owner, once, whether shared directly or via the household." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
filesRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  const rows = listFilesVisibleToActor(actor).map((row) => ({ file: row.file, owner_person_id: row.ownerPersonId, shared: row.shared }));
  return c.json(rows, 200);
});

const getRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Files"],
  summary: "One file - visible to its owner or to anyone a live share names",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "file-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: FileSchema } }, description: "Found." },
    ...errorResponses({ 401: "Not signed in", 404: "No such file, or not shared with you" }),
  },
});
filesRoutes.openapi(getRoute, (c) => {
  const actor = c.get("person");
  const result = getAttachment(actor, c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result.value, 200);
});

const listSharesRoute = createRoute({
  method: "get",
  path: "/{id}/shares",
  tags: ["Files"],
  summary: "Who a file is shared with - visible to anyone who can already see the file",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "file-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.array(ShareSchema) } }, description: "Every live share pointer on this file." },
    ...errorResponses({ 401: "Not signed in", 404: "No such file, or not shared with you" }),
  },
});
filesRoutes.openapi(listSharesRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const found = getAttachment(actor, id);
  if (!found.ok) return c.json({ error: found.error }, 404);
  return c.json(listSharesForFile(id), 200);
});

const createShareRoute = createRoute({
  method: "post",
  path: "/{id}/shares",
  tags: ["Files"],
  summary: "Share a file with a named person or the household",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id", "file-a1b2c3"),
    body: { content: { "application/json": { schema: z.object({ to: z.string().min(1) }) } } },
  },
  responses: {
    201: { content: { "application/json": { schema: ShareSchema } }, description: "Shared - or, for a target already sharing the file, the existing pointer." },
    ...errorResponses({ 400: "Not a real household target", 401: "Not signed in", 403: "You do not have access to this file", 404: "No such file" }),
  },
});
filesRoutes.openapi(createShareRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const { to } = c.req.valid("json");
  const result = createShare(actor, { fileId: id, to });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 201);
});

const deleteShareRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Files"],
  summary: "Unshare - a real delete, takes effect at once",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "share-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ deletedShareIds: z.array(z.string()) }) } }, description: "This pointer, plus any re-share that depended on it." },
    ...errorResponses({ 401: "Not signed in", 403: "You may not remove this share", 404: "No such share" }),
  },
});
sharesRoutes.openapi(deleteShareRoute, (c) => {
  const actor = c.get("person");
  const result = deleteShare(actor, c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 200);
});
