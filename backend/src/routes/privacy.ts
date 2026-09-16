import { createRoute, z } from "@hono/zod-openapi";
import { requireAuth } from "@/middleware/auth";
import { privacyPageData } from "@/lib/privacy";
import type { AppEnv } from "@/types";
import { apiRouter, errorResponses } from "@/lib/openapi";

export const privacyRoutes = apiRouter();

const privacyConnection = z.object({ id: z.string(), source: z.string(), sourceKind: z.enum(["plugin", "platform"]), destination: z.string(), when: z.string(), what: z.string(), who: z.string(), optIn: z.boolean(), retention: z.string(), direction: z.enum(["outbound", "inbound"]) }).strict();
const privacySchema = z.object({ connections: z.array(privacyConnection), offlinePlugins: z.array(z.string()) }).openapi("PrivacyPageData");
const privacyRoute = createRoute({ method: "get", path: "/", tags: ["Privacy"], summary: "Show what leaves the house", middleware: [requireAuth] as const, responses: { 200: { content: { "application/json": { schema: privacySchema } }, description: "Privacy connection table." }, ...errorResponses({ 401: "Not signed in" }) } });

// Any signed-in household member, deliberately not owner/admin only.
// This is the page that tells a family what leaves their house; gating
// it behind an admin role would make the promise checkable only by the
// person who already knows. Nothing here is personal data or a secret:
// it is the same table the manifests already declare in the open.
privacyRoutes.openapi(privacyRoute, (c) => {
  return c.json(privacyPageData(), 200);
});
