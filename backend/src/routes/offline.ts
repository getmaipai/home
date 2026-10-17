import { createRoute, z } from "@hono/zod-openapi";
import { OfflineManifest } from "@maipai/spec/gen/ts/offline-manifest.js";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireDeviceScope } from "@/middleware/auth";
import { offlineProvider } from "@/lib/offline/registry";
import "@/lib/offline/providers";

export const offlineRoutes = apiRouter();
// A device a guardian granted media.offline before KEEP-OFFLINE-01 keeps media through these routes too. Its grant is not widened to
// other kinds (no migration adds offline.records): every other kind needs offline.records.
const gate = requireDeviceScope((c) => (c.req.query("kind") ?? c.req.param("kind")) === "media" ? ["offline.records", "media.offline"] : ["offline.records"]);
const missing = "This copy is not available to you on Home. Open the item in its app, then try again.";
const errors = errorResponses({ 401: "Sign in to Home and try again", 403: "Check this device's offline permission, or screen time is done (media_time_up, budget_keep_refused)", 404: "Open the item in its app and try again" });
const manifest = createRoute({
  method: "get", path: "/manifest", tags: ["Offline"], summary: "Keep one readable record using its registered provider",
  middleware: [gate] as const,
  request: { query: z.object({ kind: z.string().min(1), id: z.string().min(1) }) },
  responses: { 200: { content: { "application/json": { schema: OfflineManifest } }, description: "The record's hub-only files." }, ...errors },
});
offlineRoutes.openapi(manifest, async (c) => {
  const { kind, id } = c.req.valid("query");
  const provider = offlineProvider(kind);
  const refused = provider?.refuse(c.get("person"));
  if (refused) return c.json(refused, 403);
  const result = await provider?.manifest(c.get("person"), id);
  if (!result) return c.json({ error: missing }, 404);
  return c.json(OfflineManifest.parse(result), 200);
});
const file = createRoute({
  method: "get", path: "/file/{kind}/{entry}", tags: ["Offline"], summary: "Read one kept record's file from Home",
  middleware: [gate] as const,
  request: { params: z.object({ kind: z.string().min(1), entry: z.string().min(1) }) },
  responses: { 200: { description: "Complete private bytes." }, 206: { description: "Requested range." }, ...errors,
    ...errorResponses({ 409: "Choose a playable item", 416: "Request a range inside the file", 422: "Open the parts of this item", 503: "Try this copy again later" }) },
});
offlineRoutes.openapi(file, (c) => {
  const { kind, entry } = c.req.valid("param");
  const provider = offlineProvider(kind);
  if (!provider) return c.json({ error: missing }, 404);
  const refused = provider.refuse(c.get("person"));
  if (refused) return c.json(refused, 403);
  return provider.file(c.get("person"), entry, c.req.raw);
});
