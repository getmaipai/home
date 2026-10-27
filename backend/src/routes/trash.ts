import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listTrash, trashProvider } from "@/lib/trash/registry";
import "@/lib/trash/providers";
import { trashedFileThumbnail } from "@/lib/fileThumbnails";

export const trashRoutes = apiRouter();
const Row = z.object({ kind: z.string(), id: z.string(), title: z.string(), deleted_at: z.string(), trash_until: z.string().nullable(), can_restore: z.boolean(), can_purge: z.boolean(), thumb_url: z.string().nullable().optional() });
trashRoutes.openapi(createRoute({
  method: "get", path: "/", tags: ["Trash"], summary: "Deleted records I may manage",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ rows: z.array(Row) }) } }, description: "Visible trash only; children see their own rows only." }, ...errorResponses({ 401: "Sign in to see your trash." }) },
}), (c) => c.json({ rows: listTrash(c.get("person")) }, 200));
trashRoutes.openapi(createRoute({
  method: "get", path: "/file/{id}/thumb", tags: ["Trash"], summary: "A small preview of one of my own trashed files",
  middleware: [requireAuth] as const, request: { params: z.object({ id: z.string() }) },
  responses: { 200: { content: { "image/webp": { schema: z.string() } }, description: "A preview up to 320 pixels." }, 404: { content: { "text/plain": { schema: z.string() } }, description: "Not in your Trash, or no preview." }, ...errorResponses({ 401: "Sign in to see your trash." }) },
}), (c) => trashedFileThumbnail(c.get("person"), c.req.valid("param").id) as never);
const params = z.object({ kind: z.string(), id: z.string() });
const responses = { 200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Done." }, ...errorResponses({ 401: "Sign in and try again.", 404: "This item is not available in your trash. Refresh Trash and try again." }) };
trashRoutes.openapi(createRoute({ method: "post", path: "/{kind}/{id}/restore", tags: ["Trash"], summary: "Restore a deleted record within its keep window", middleware: [requireAuth] as const, request: { params }, responses }), (c) => {
  const { kind, id } = c.req.valid("param");
  if (!trashProvider(kind)?.restore(c.get("person"), id)) return c.json({ error: "This item cannot be restored from your trash. Refresh Trash and try again." }, 404);
  return c.json({ success: true as const }, 200);
});
trashRoutes.openapi(createRoute({ method: "delete", path: "/{kind}/{id}", tags: ["Trash"], summary: "Delete a trashed record forever", middleware: [requireAuth] as const, request: { params }, responses }), (c) => {
  const { kind, id } = c.req.valid("param");
  if (!trashProvider(kind)?.purge(c.get("person"), id)) return c.json({ error: "This item is not available in your trash. Refresh Trash and try again." }, 404);
  return c.json({ success: true as const }, 200);
});
