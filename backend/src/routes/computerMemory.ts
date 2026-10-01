import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { getHomeOwnedRoles, getStackClient } from "@/lib/stackEngine";
import { describeComputerMemory } from "@/lib/computerMemory";
import { requireAuth } from "@/middleware/auth";

export const computerMemoryRoutes = apiRouter();
const MemorySchema = z.object({
  usableGb: z.number(), usedGb: z.number(), freeGb: z.number(),
  pressure: z.enum(["normal", "warn", "critical"]), pressureText: z.string(),
  loaded: z.array(z.object({ id: z.string(), label: z.string(), gb: z.number() })),
  homeOwnedRoles: z.array(z.enum(["chat", "embeddings", "stt", "tts"])),
});
const route = createRoute({
  method: "get", path: "/", tags: ["Models"], summary: "What model memory this computer is using right now",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.union([z.object({ available: z.literal(true), memory: MemorySchema }), z.object({ available: z.literal(false) })]) } }, description: "Current model memory, when the Stack answers." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
computerMemoryRoutes.openapi(route, async (c) => {
  try {
    const budget = await getStackClient().budget();
    return c.json({ available: true as const, memory: describeComputerMemory(budget, getHomeOwnedRoles()) }, 200);
  } catch {
    return c.json({ available: false as const }, 200);
  }
});
