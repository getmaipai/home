import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listCast } from "@/lib/cast";

export const castRoutes = apiRouter();
const entry = z.object({
  id: z.string(), kind: z.enum(["synth", "member", "subject"]), subject_kind: z.enum(["character", "prop", "place"]), name: z.string(),
  subject_id: z.string().nullable(), synth_id: z.string().nullable(), person_id: z.string().nullable(),
  look: z.object({ description: z.string(), sheet_file_id: z.string().nullable(), medium: z.enum(["photo", "stylised"]).nullable() }),
  locked_description: z.string().nullable(), voice: z.string().nullable(), avatar: z.object({ url: z.string().nullable(), seed: z.string().nullable() }),
  real: z.boolean(), minor: z.boolean(), audience: z.enum(["all-ages", "adult-only"]),
});
const listRoute = createRoute({ method: "get", path: "/", tags: ["Media"], summary: "List what this person may cast in a picture, video or film", middleware: [requireAuth] as const, responses: { 200: { description: "Synths, saved subjects and household members this person may cast", content: { "application/json": { schema: z.object({ cast: z.array(entry) }) } } }, ...errorResponses({ 401: "Not signed in" }) } });
castRoutes.openapi(listRoute, (c) => c.json({ cast: listCast(c.get("person")) }, 200));
