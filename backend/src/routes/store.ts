// The store host's own thin HTTP surface (session-d-packages-and-
// store.md step 6): install/rollback/uninstall/channel over
// lib/store.ts, the two-call permission-prompt flow's UI-facing half
// (E's store page consumes `requiresConfirmation` to render the
// diff and re-POST with `confirmed: true`). Owner/admin only
// throughout, the same gate routes/repairs.ts uses: installing or
// removing a package is a household-operational action, not any one
// person's own data.
//
// `source`/`trust` are request fields, not a baked-in default, because
// there is no real pinned production catalog URL or maintainer root key
// yet (lib/storeIndex.ts's own TrustConfig doc comment, catalog's
// index-builder.ts buildRoot() carries the identical note) - an admin
// points the hub at an index (a local directory during development, or
// a URL once one is published) and says which root key(s) to trust.
// Once a real pinned default exists (a settings key, most likely), a
// route can fall back to it when the request omits these; nothing here
// forecloses that.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { install, rollback, uninstall, setChannel, type StoreResult } from "@/lib/store";
import { getActiveInstall } from "@/lib/packageResolve";

export const storeRoutes = apiRouter();

// The same small local shape routes/commands.ts, routes/memory.ts,
// routes/conversations.ts, and routes/scheduler.ts already each factor
// their own StoreResult-shaped failure branch into - a real gap found
// by code review: this file used to hand-write `{error: result.error},
// 400` three separate times instead of reusing lib/store.ts's own
// per-failure `status` (404 for "no such install," 400 for a real
// request problem), the exact distinction routes/repairs.ts's own
// fixIssue/dismissIssue already make for "no such issue."
function fail(result: Extract<StoreResult<unknown>, { ok: false }>) {
  return { body: { error: result.error }, status: result.status } as const;
}

const IdParamSchema = idParamSchema("id", "weather");

const IndexSourceSchema = z.union([
  z.object({ kind: z.literal("dir"), dir: z.string() }).openapi({ description: "A local directory holding root.json/targets.json/timestamp.json plus tarballs - dev and testing." }),
  z.object({ kind: z.literal("url"), baseUrl: z.string() }).openapi({ description: "The base URL a published index's files sit under." }),
]);

const TrustConfigSchema = z.object({
  rootPublicKeysPem: z.array(z.string()).min(1),
  rootThreshold: z.number().int().positive().optional(),
});

const InstalledPackageSchema = z.object({
  id: z.string(),
  version: z.string(),
  previousVersion: z.string().nullable(),
  channel: z.enum(["stable", "beta"]),
  sourceCommit: z.string(),
  permissions: z.array(z.string()),
  installedAt: z.string(),
});

const listRoute = createRoute({
  method: "get",
  path: "/installs/{id}",
  tags: ["Store"],
  summary: "The active store install for a package, if any",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: IdParamSchema },
  responses: {
    200: { content: { "application/json": { schema: InstalledPackageSchema.nullable() } }, description: "null if the package has no active store install (bundled-only, or never installed)." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
storeRoutes.openapi(listRoute, (c) => {
  const id = c.req.valid("param").id;
  const active = getActiveInstall(id);
  return c.json(active ? { id, ...active } : null, 200);
});

const InstallBodySchema = z.object({
  targetPath: z.string().openapi({ example: "plugins/utilities/weather/0.1.0" }),
  source: IndexSourceSchema,
  trust: TrustConfigSchema,
  confirmed: z.boolean().optional().openapi({ description: "Required to proceed when the update adds permissions beyond what's already installed." }),
});

const InstallOutcomeSchema = z.object({
  version: z.string(),
  previousVersion: z.string().nullable(),
  smokeOk: z.boolean(),
  smokeMessage: z.string(),
});

const installRoute = createRoute({
  method: "post",
  path: "/installs/{id}",
  tags: ["Store"],
  summary: "Install or update a package from a signed index",
  description: "Verifies the index and the package's own tarball hash, unpacks it, and runs its smoke test. An update that adds permissions beyond what's already installed is refused with requiresConfirmation until re-sent with confirmed: true.",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: IdParamSchema, body: { content: { "application/json": { schema: InstallBodySchema } } } },
  responses: {
    200: { content: { "application/json": { schema: InstallOutcomeSchema } }, description: "Installed (or updated); smokeOk says whether it's actually enabled." },
    409: {
      content: { "application/json": { schema: z.object({ error: z.string(), requiresConfirmation: z.object({ newPermissions: z.array(z.string()) }) }) } },
      description: "This update adds permissions - re-send with confirmed: true to proceed.",
    },
    ...errorResponses({ 400: "Verification failed (bad hash, unknown signer, expired or rolled-back index, manifest identity mismatch)", 403: "Not owner/admin" }),
  },
});
storeRoutes.openapi(installRoute, async (c) => {
  const id = c.req.valid("param").id;
  const body = c.req.valid("json");
  const result = await install({ id, ...body });
  if (!result.ok) {
    if (result.requiresConfirmation) return c.json({ error: result.error, requiresConfirmation: result.requiresConfirmation }, 409);
    return c.json({ error: result.error }, 400);
  }
  return c.json(result.value, 200);
});

const rollbackRoute = createRoute({
  method: "post",
  path: "/installs/{id}/rollback",
  tags: ["Store"],
  summary: "Roll a store-installed package back to its previous version",
  description: "Single-step: rolls back to the immediately previous version, never a full history stack. Never re-downloads - the previous version's files are already on disk.",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: IdParamSchema },
  responses: {
    200: { content: { "application/json": { schema: z.object({ version: z.string() }) } }, description: "Rolled back." },
    ...errorResponses({ 400: "No previous version recorded, or the previous version's files are gone", 404: "No such active install", 403: "Not owner/admin" }),
  },
});
storeRoutes.openapi(rollbackRoute, async (c) => {
  const result = await rollback(c.req.valid("param").id);
  if (!result.ok) {
    const f = fail(result);
    return c.json(f.body, f.status);
  }
  return c.json(result.value, 200);
});

const uninstallRoute = createRoute({
  method: "post",
  path: "/installs/{id}/uninstall",
  tags: ["Store"],
  summary: "Remove a package's store install",
  description: "Falls back to the bundled copy if one exists. Removes only the store's own version files, never a Tier 1 package's separate persistent state.",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: IdParamSchema },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.literal(true) } ) } }, description: "Removed." },
    ...errorResponses({ 404: "No active store install to remove", 403: "Not owner/admin" }),
  },
});
storeRoutes.openapi(uninstallRoute, async (c) => {
  const result = await uninstall(c.req.valid("param").id);
  // lib/store.ts's uninstall() only ever fails with 404 ("no active
  // install") - the cast narrows fail()'s general 400|404 (rollback's
  // own wider case) to what this route actually declares.
  if (!result.ok) return c.json(fail(result).body, 404);
  return c.json({ ok: true as const }, 200);
});

const ChannelBodySchema = z.object({ channel: z.enum(["stable", "beta"]) });

const channelRoute = createRoute({
  method: "post",
  path: "/installs/{id}/channel",
  tags: ["Store"],
  summary: "Set a store-installed package's update channel",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: IdParamSchema, body: { content: { "application/json": { schema: ChannelBodySchema } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.literal(true) } ) } }, description: "Set." },
    ...errorResponses({ 404: "No active store install to set a channel on", 403: "Not owner/admin" }),
  },
});
storeRoutes.openapi(channelRoute, (c) => {
  const { id } = c.req.valid("param");
  const { channel } = c.req.valid("json");
  const result = setChannel(id, channel);
  // lib/store.ts's setChannel() only ever fails with 404, same reason
  // as uninstallRoute above.
  if (!result.ok) return c.json(fail(result).body, 404);
  return c.json({ ok: true as const }, 200);
});
