import { apiRouter, errorResponses } from "@/lib/openapi";
import { householdAdults } from "@/lib/likeness/resolve";
import { requireAuth } from "@/middleware/auth";
import { createRoute, z } from "@hono/zod-openapi";

/** The subject picker may name only living household adults. */
export const likenessRoutes = apiRouter();

const adultsRoute = createRoute({
  method: "get",
  path: "/adults",
  tags: ["Pictures"],
  summary: "Household adults who can be a picture or video subject",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ adults: z.array(z.object({ id: z.string(), name: z.string(), self: z.boolean() })) }) } }, description: "Living household adults eligible to be a subject." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});

likenessRoutes.openapi(adultsRoute, (c) => c.json({ adults: householdAdults().map((adult) => ({ ...adult, self: adult.id === c.get("person").id })) }, 200));
