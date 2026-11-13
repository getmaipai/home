import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { composerModesFor } from "@/lib/composer/modes";

// ONE-COMPOSER-2026-11-13 (COMPOSER-03): the modes of the one composer as data, for this person. Read once when a composer mounts; it is
// never polled for status (readiness is the live health query's), and nothing here is logged beyond the request line.
export const composerRoutes = apiRouter();
const option = z.object({ value: z.union([z.string(), z.number()]), label: z.string(), detail: z.string().optional() });
const mode = z.object({
  id: z.string(), label: z.string(), icon: z.string(), route: z.string().nullable(), engine: z.enum(["image", "video", "music", "voices"]).nullable(), placeholder: z.string(),
  references: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(["picture", "character", "place", "audio", "video"]), max: z.number().optional() })),
  chips: z.array(z.object({ id: z.string(), label: z.string(), group: z.string().optional(), options: z.array(option), default: z.union([z.string(), z.number()]) })),
  presets: z.object({ label: z.string(), chips: z.array(z.object({ id: z.string(), label: z.string(), default: z.string(), options: z.array(z.object({ value: z.string(), label: z.string(), text: z.string() })) })) }).nullable(),
  tools: z.array(z.enum(["clear", "improve", "lyrics"])),
  primary: z.object({ label: z.string() }),
  quality: z.object({ default: z.string(), options: z.array(option) }).nullable(),
  availability: z.enum(["ready", "starting", "unavailable"]).nullable(),
  disabledReason: z.string().nullable(),
});
const listRoute = createRoute({
  method: "get", path: "/modes", tags: ["Media"], summary: "The composer's modes this person may use, with each mode's slots, chips and presets", middleware: [requireAuth] as const,
  responses: { 200: { description: "Ask first, then Picture, Video and Song where the person's band, the household and the app allow them. Additive.", content: { "application/json": { schema: z.object({ band: z.enum(["child", "teen", "adult"]), modes: z.array(mode) }) } } }, ...errorResponses({ 401: "Not signed in" }) },
});
composerRoutes.openapi(listRoute, async (c) => c.json(await composerModesFor(c.get("person")), 200));
