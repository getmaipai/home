import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listTemplates } from "@/lib/media/templates";
import { deleteSavedTemplate, renameSavedTemplate, saveTemplate, shareSavedTemplate } from "@/lib/media/savedTemplateActions";

export const mediaTemplatesRoutes = apiRouter();
const Template = z.object({ id:z.string(), kind:z.enum(["picture","video"]), title:z.string(), summary:z.string(), category:z.string(), audience:z.enum(["all-ages","adult-only"]), prompt:z.string(), references:z.array(z.string()), styles:z.array(z.string()), aspect:z.string().nullable().optional(), transparent:z.boolean().optional(), owner_person_id:z.string().optional(), shared_with:z.literal("household").optional(), content_rating:z.record(z.string(), z.unknown()).optional(), provenance:z.string(), created_at:z.string(), updated_at:z.string(), hlc:z.string() });
const route = createRoute({ method:"get", path:"/", tags:["Media"], summary:"List picture templates available to this profile", middleware:[requireAuth] as const, request:{ query:z.object({ kind:z.enum(["picture","video"]).optional() }) }, responses:{ 200:{ description:"Audience-filtered templates", content:{"application/json":{schema:z.object({templates:z.array(Template)})}} }, ...errorResponses({401:"Not signed in"}) } });
mediaTemplatesRoutes.openapi(route, (c) => c.json({ templates:listTemplates({ actor:c.get("person"), kind:c.req.query("kind") as "picture" | "video" | undefined }) },200));

// TEMPLATE-02: save, rename, share and delete the templates a person saved. All of it is the actor's own; a hidden or someone else's template answers as a missing one.
const refusal = errorResponses({ 400: "Bad request", 401: "Not signed in", 403: "Not allowed", 404: "No such template", 422: "That template could not be saved" });
const saveBody = z.object({ source: z.object({ kind: z.enum(["clip", "picture"]), id: z.string().min(1) }), title: z.string().min(1).max(120), words: z.string().max(10000).optional(), category: z.string().max(60).optional() });
const saveRoute = createRoute({ method: "post", path: "/", tags: ["Media"], summary: "Save a finished clip or picture as a template of your own", middleware: [requireAuth] as const, request: { body: { content: { "application/json": { schema: saveBody } } } }, responses: { 201: { description: "The saved template", content: { "application/json": { schema: Template } } }, ...refusal } });
mediaTemplatesRoutes.openapi(saveRoute, async (c) => {
  const body = c.req.valid("json");
  const saved = await saveTemplate(c.get("person"), { source: body.source, title: body.title, ...(body.words !== undefined ? { words: body.words } : {}), ...(body.category !== undefined ? { category: body.category } : {}) });
  return saved.ok ? c.json(saved.template as never, 201) : c.json({ error: saved.line, code: saved.code }, saved.status as never);
});
const patchBody = z.object({ title: z.string().min(1).max(120).optional(), shared_with: z.union([z.literal("household"), z.null()]).optional() });
const patchRoute = createRoute({ method: "patch", path: "/{id}", tags: ["Media"], summary: "Rename a template you saved, or Share with home and Stop sharing", middleware: [requireAuth] as const, request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: patchBody } } } }, responses: { 200: { description: "The template", content: { "application/json": { schema: Template } } }, ...refusal } });
mediaTemplatesRoutes.openapi(patchRoute, (c) => {
  const actor = c.get("person"), id = c.req.valid("param").id, body = c.req.valid("json");
  let last = null as ReturnType<typeof renameSavedTemplate> | null;
  if (body.title !== undefined) { last = renameSavedTemplate(actor, id, body.title); if (!last.ok) return c.json({ error: last.line, code: last.code }, last.status as never); }
  if (body.shared_with !== undefined) { last = shareSavedTemplate(actor, id, body.shared_with === "household"); if (!last.ok) return c.json({ error: last.line, code: last.code }, last.status as never); }
  return last && last.ok ? c.json(last.template as never, 200) : c.json({ error: "Nothing to change.", code: "nothing" }, 400);
});
const deleteRoute = createRoute({ method: "delete", path: "/{id}", tags: ["Media"], summary: "Delete a template you saved", middleware: [requireAuth] as const, request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: "Deleted" }, ...errorResponses({ 401: "Not signed in", 404: "No such template" }) } });
mediaTemplatesRoutes.openapi(deleteRoute, (c) => deleteSavedTemplate(c.get("person"), c.req.valid("param").id) ? c.body(null, 204) : c.json({ error: "That template isn't available any more.", code: "gone" }, 404));
