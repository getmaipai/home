// Step 10: the updates projection (app only - see lib/updates.ts's own
// header for scope and why packages/models/sidecars aren't here).
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRoleOrGrant } from "@/middleware/auth";
import { cachedUpdateProjection, checkForAppUpdate } from "@/lib/updates";

export const updatesRoutes = apiRouter();

const UpdateAssetSchema = z.object({ name: z.string(), url: z.string(), digest: z.string().nullable() });
const UpdateProjectionSchema = z.object({
  installed: z.string(),
  latest: z.string().nullable(),
  summary: z.string().nullable(),
  url: z.string().nullable(),
  assets: z.array(UpdateAssetSchema),
  channel: z.literal("stable"),
  progress: z.null(),
  needs: z.array(z.string()),
  blockedBy: z.string().nullable(),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
});

// Every signed-in person can see whether an update is available -
// informational, the same reach GET /api/health already has.
const getRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Updates"],
  summary: "The last known update check result (app only)",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: UpdateProjectionSchema } }, description: "Cached - does not itself call GitHub." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
updatesRoutes.openapi(getRoute, (c) => c.json(cachedUpdateProjection(), 200));

// Owner/admin (or a backups.run grant, the closest existing action to
// "routine maintenance click") may force a fresh check rather than
// waiting for the daily job - a real network call, so narrower than the
// read above.
const checkRoute = createRoute({
  method: "post",
  path: "/check",
  tags: ["Updates"],
  summary: "Check GitHub for a new release right now",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  responses: {
    200: { content: { "application/json": { schema: UpdateProjectionSchema } }, description: "The fresh result." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
updatesRoutes.openapi(checkRoute, async (c) => c.json(await checkForAppUpdate(), 200));
