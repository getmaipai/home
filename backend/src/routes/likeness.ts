import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { householdSubjects } from "@/lib/likeness/eligibility";
import { pictureDenial } from "@/lib/pictures/policy";
import { speakerAgeBand } from "@/lib/ageBand";

export const likenessRoutes = apiRouter();
const adultsRoute = createRoute({
  method: "get", path: "/adults", tags: ["Likeness"], summary: "Household members available to family media subject pickers", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ adults: z.array(z.object({ id: z.string(), name: z.string(), self: z.boolean() })) }) } }, description: "Eligible household members." }, ...errorResponses({ 401: "Not signed in", 403: "Only an adult can use these pickers" }) },
});
likenessRoutes.openapi(adultsRoute, (c) => {
  const actor = c.get("person");
  if (actor.role === "guest" || speakerAgeBand(actor, new Date()) !== "adult" || pictureDenial({ actor, band: speakerAgeBand(actor, new Date()), surface: "chat", surfaceClass: "written", spoken: false }) !== null) {
    return c.json({ error: "Only an adult can choose a person for a picture, a video or a style.", code: "adults_only" }, 403) as never;
  }
  return c.json({ adults: householdSubjects().map((member) => ({ ...member, self: member.id === actor.id })) }, 200);
});
