import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { previewLibraryRetention } from "@/lib/libraryRetention";
export const libraryRetentionRoutes = apiRouter();
libraryRetentionRoutes.use("*", requireAuth);
const preview = createRoute({
  method: "get", path: "/preview", tags: ["Storage"],
  summary: "Preview Library storage cleanup without changing files",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({}).passthrough() } }, description: "Storage budget, candidate counts and bytes, and warning grace status." }, ...errorResponses({ 401: "Sign in to view cleanup.", 403: "Ask an owner or admin to view cleanup." }) },
});
libraryRetentionRoutes.openapi(preview, (c) => c.json(previewLibraryRetention(), 200));
