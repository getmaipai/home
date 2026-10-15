// The install after (and during) setup: what is downloading, what has
// landed, and a retry. The wizard reads the same summary through
// `GET /api/setup/install` before an owner exists.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { isOwnerOrAdmin } from "@/lib/access";
import { getInstallStatus, resetInstallStatusCache } from "@/lib/installStatus";
import { startSetupDownloads } from "@/setup/checks/setupDownloads";

export const InstallStatusSchema = z.object({
  state: z.enum(["none", "downloading", "starter_ready", "stalled", "out_of_space", "failed", "ready"]),
  chatReady: z.boolean(),
  complete: z.boolean(),
  percent: z.number().int().min(0).max(100),
  completedBytes: z.number(),
  totalBytes: z.number(),
  bytesPerSecond: z.number().nullable(),
  etaSeconds: z.number().nullable(),
  problem: z.string().nullable(),
  items: z.array(z.object({
    id: z.string(), model: z.string(), role: z.string().nullable(), label: z.string(),
    state: z.string(), completedBytes: z.number(), totalBytes: z.number(), reason: z.string().nullable(),
  })),
});

export const installRoutes = apiRouter();

const statusRoute = createRoute({
  method: "get", path: "/", tags: ["Install"], summary: "What the AI install is doing now",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: InstallStatusSchema } }, description: "The install summary, from the Stack's download jobs." } },
});
installRoutes.openapi(statusRoute, async (c) => c.json(await getInstallStatus(), 200));

const retryRoute = createRoute({
  method: "post", path: "/retry", tags: ["Install"], summary: "Start the missing downloads again",
  middleware: [requireAuth] as const,
  responses: {
    202: { content: { "application/json": { schema: z.object({ started: z.literal(true) }) } }, description: "The downloads were started again." },
    ...errorResponses({ 403: "Only an owner or admin may do this" }),
  },
});
installRoutes.openapi(retryRoute, (c) => {
  if (!isOwnerOrAdmin(c.get("person"))) return c.json({ error: "Only an owner or admin can restart the install." }, 403);
  resetInstallStatusCache();
  void startSetupDownloads().catch(() => {});
  return c.json({ started: true as const }, 202);
});
