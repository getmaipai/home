import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listTemplates } from "@/lib/media/templates";

export const mediaTemplatesRoutes = apiRouter();
const Template = z.object({ id:z.string(), kind:z.enum(["picture","video"]), title:z.string(), summary:z.string(), category:z.string(), audience:z.enum(["all-ages","adult-only"]), prompt:z.string(), references:z.array(z.string()), styles:z.array(z.string()), aspect:z.string().nullable(), transparent:z.boolean(), provenance:z.string(), created_at:z.string(), updated_at:z.string(), hlc:z.string() });
const route = createRoute({ method:"get", path:"/", tags:["Media"], summary:"List picture templates available to this profile", middleware:[requireAuth] as const, request:{ query:z.object({ kind:z.enum(["picture","video"]).optional() }) }, responses:{ 200:{ description:"Audience-filtered templates", content:{"application/json":{schema:z.object({templates:z.array(Template)})}} }, ...errorResponses({401:"Not signed in"}) } });
mediaTemplatesRoutes.openapi(route, (c) => c.json({ templates:listTemplates({ actor:c.get("person"), kind:c.req.query("kind") as "picture" | "video" | undefined }) },200));
