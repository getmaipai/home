// MEM-SPACE-12: the setup wizard's Close apps question. Same access rule as the host-tune step (before setup ends: loopback, then the owner).
// GET says whether the helper is running and which apps are open, so the wizard can tell a Mac used as a regular computer; POST runs the permission test.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter } from "@/lib/openapi";
import { accessRefusal } from "@/routes/setupFolders";
import { listHelperApps } from "@/lib/appHelperClient";
import { probeCloseApps } from "@/lib/closeAppsProbe";
import { readCapabilities } from "@/lib/memoryRoom";

export const setupCloseAppsRoutes = apiRouter();
const ErrorBody = z.object({ error: z.string() });
const errs = {
  401: { content: { "application/json": { schema: ErrorBody } }, description: "Owner sign-in required." },
  403: { content: { "application/json": { schema: ErrorBody } }, description: "Not allowed here." },
  409: { content: { "application/json": { schema: ErrorBody } }, description: "Setup is finished. The text says where to change this." },
} as const;

const listRoute = createRoute({
  method: "get", path: "/close-apps", tags: ["Setup"], summary: "Is the Mac app helper running, and which apps are open",
  responses: { 200: { content: { "application/json": { schema: z.object({ installed: z.boolean(), apps: z.array(z.object({ bundleId: z.string(), name: z.string() })) }) } }, description: "Names are returned to the wizard and never stored." }, ...errs },
});
setupCloseAppsRoutes.openapi(listRoute, async (c) => {
  const refusal = accessRefusal(c);
  if (refusal) return refusal as never;
  const listing = await listHelperApps();
  return c.json({ installed: listing.installed, apps: listing.apps.map(({ bundleId, name }) => ({ bundleId, name })) }, 200);
});

const testRoute = createRoute({
  method: "post", path: "/close-apps/test", tags: ["Setup"], summary: "Open and quit one harmless app to prove the helper may close apps",
  responses: { 200: { content: { "application/json": { schema: z.object({ result: z.enum(["ok", "no_helper", "not_allowed"]) }) } }, description: "ok: the helper quit the test app. Anything else leaves Close apps Off." }, ...errs },
});
setupCloseAppsRoutes.openapi(testRoute, async (c) => {
  const refusal = accessRefusal(c);
  if (refusal) return refusal as never;
  return c.json({ result: await probeCloseApps() }, 200);
});

const capRoute = createRoute({
  method: "get", path: "/capabilities", tags: ["Setup"], summary: "What this computer can run, per category and tier, before anything is downloaded",
  responses: { 200: { content: { "application/json": { schema: z.object({ available: z.boolean(), machine_class: z.string(), rows: z.array(z.object({ category: z.enum(["chat", "image", "video", "music", "voice"]), label: z.string(), cells: z.array(z.object({ tier: z.enum(["standard", "boost", "max"]), fits: z.boolean(), needs_bytes: z.number().nullable() })) })) }) } }, description: "From the Stack's fits_ever. available is false when the Stack is not running yet or is older." }, ...errs },
});
setupCloseAppsRoutes.openapi(capRoute, async (c) => {
  const refusal = accessRefusal(c);
  if (refusal) return refusal as never;
  return c.json(await readCapabilities(), 200);
});
