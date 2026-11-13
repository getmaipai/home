import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listCast } from "@/lib/cast";
import { captureLook } from "@/lib/castLook";

export const castRoutes = apiRouter();
const entry = z.object({
  id: z.string(), kind: z.enum(["synth", "member", "subject"]), subject_kind: z.enum(["character", "prop", "place"]), name: z.string(),
  subject_id: z.string().nullable(), synth_id: z.string().nullable(), person_id: z.string().nullable(),
  look: z.object({ description: z.string(), sheet_file_id: z.string().nullable(), sheet_stale: z.boolean(), medium: z.enum(["photo", "stylised"]).nullable() }),
  locked_description: z.string().nullable(), voice: z.string().nullable(), avatar: z.object({ url: z.string().nullable(), seed: z.string().nullable() }),
  real: z.boolean(), minor: z.boolean(), audience: z.enum(["all-ages", "adult-only"]),
});
const listRoute = createRoute({ method: "get", path: "/", tags: ["Media"], summary: "List what this person may cast in a picture, video or film", middleware: [requireAuth] as const, responses: { 200: { description: "Synths, saved subjects and household members this person may cast", content: { "application/json": { schema: z.object({ cast: z.array(entry) }) } } }, ...errorResponses({ 401: "Not signed in" }) } });
castRoutes.openapi(listRoute, (c) => c.json({ cast: listCast(c.get("person")) }, 200));
const lookRoute = createRoute({
  method: "post", path: "/{id}/look", tags: ["Media"], summary: "Capture the look of a cast member (one reference sheet, reused until its pictures change)", middleware: [requireAuth] as const,
  request: { params: z.object({ id: z.string().min(1) }), body: { required: false, content: { "application/json": { schema: z.object({ photo_file_ids: z.array(z.string()).max(7).optional(), force: z.boolean().optional() }) } } } },
  responses: { 200: { description: "The stored sheet", content: { "application/json": { schema: z.object({ sheet_file_id: z.string(), reused: z.boolean(), description: z.string(), locked_description: z.string().nullable(), notes: z.array(z.string()), cast: entry }) } } }, ...errorResponses({ 400: "The look could not be captured", 401: "Not signed in" }) },
});
castRoutes.openapi(lookRoute, async (c) => {
  const body = c.req.valid("json") ?? {};
  const result = await captureLook(c.get("person"), c.req.valid("param").id, { photoFileIds: body.photo_file_ids, force: body.force });
  if (!result.ok) return c.json({ error: result.line }, 400);
  const { member, ...rest } = result;
  const { subject: _subject, synth: _synth, ...cast } = member;
  return c.json({ sheet_file_id: rest.sheet_file_id, reused: rest.reused, description: rest.description, locked_description: rest.locked_description, notes: rest.notes, cast }, 200);
});
