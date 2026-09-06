// Step 9: storage, quotas, uninstall, factory reset, diagnostics (plan
// 4.15). "A Storage page (E)" reads most of what's here; none of it has
// a UI yet.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRoleOrGrant, requireRole } from "@/middleware/auth";
import { storageSummary } from "@/lib/storage";
import { listNasMounts, createNasMount, deleteNasMount } from "@/lib/nasMounts";
import { stageFactoryReset, pendingFactoryReset, cancelPendingFactoryReset, FACTORY_RESET_CONFIRMATION_PHRASE } from "@/lib/factoryReset";
import { generateDiagnostics } from "@/lib/diagnostics";

export const storageRoutes = apiRouter();

const AreaUsageSchema = z.object({ area: z.string(), bytes: z.number() });
const StorageSummarySchema = z.object({
  areas: z.array(AreaUsageSchema),
  packages: z.array(z.object({ packageId: z.string(), sizeBytes: z.number() })),
  disk: z.object({ totalBytes: z.number(), freeBytes: z.number() }),
});

const summaryRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Storage"],
  summary: "Disk usage per area and per package, plus free disk space",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  responses: {
    200: { content: { "application/json": { schema: StorageSummarySchema } }, description: "Bytes, not blocks - see storageSummary()'s own comment for how that differs from `du`." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
storageRoutes.openapi(summaryRoute, (c) => c.json(storageSummary(), 200));

const NasMountSchema = z.object({
  id: z.string(),
  label: z.string(),
  path: z.string(),
  scanPaths: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const listMountsRoute = createRoute({
  method: "get",
  path: "/nas-mounts",
  tags: ["Storage"],
  summary: "Declared NAS mounts (no scanner reads these yet)",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(NasMountSchema) } }, description: "Every declared mount." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
storageRoutes.openapi(listMountsRoute, (c) => c.json(listNasMounts(), 200));

const createMountRoute = createRoute({
  method: "post",
  path: "/nas-mounts",
  tags: ["Storage"],
  summary: "Declare a NAS mount - a share already mounted at the OS level",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  request: {
    body: { content: { "application/json": { schema: z.object({ label: z.string(), path: z.string(), scanPaths: z.array(z.string()).default([]) }) } } },
  },
  responses: {
    201: { content: { "application/json": { schema: NasMountSchema } }, description: "Declared." },
    ...errorResponses({ 400: "Invalid label/path", 403: "Not owner/admin" }),
  },
});
storageRoutes.openapi(createMountRoute, (c) => {
  const { label, path, scanPaths } = c.req.valid("json");
  const result = createNasMount(label, path, scanPaths);
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "invalid mount" }, 400);
  return c.json(result.value, 201);
});

const deleteMountRoute = createRoute({
  method: "delete",
  path: "/nas-mounts/{id}",
  tags: ["Storage"],
  summary: "Remove a declared NAS mount",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Removed." },
    ...errorResponses({ 403: "Not owner/admin", 404: "No such mount" }),
  },
});
storageRoutes.openapi(deleteMountRoute, (c) => {
  if (!deleteNasMount(c.req.valid("param").id)) return c.json({ error: "no such mount" }, 404);
  return c.json({ success: true as const }, 200);
});

// Factory reset: owner-only, no grant widening - the same posture the
// emergency kit route takes, and for the same reason: this is a
// different order of consequence than "who may run a backup."
const PendingFactoryResetSchema = z.object({ stagedAt: z.string(), backupFilename: z.string() });

const pendingResetRoute = createRoute({
  method: "get",
  path: "/factory-reset/pending",
  tags: ["Storage"],
  summary: "The factory reset staged for the next boot, if any",
  middleware: [requireRole("owner")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ pending: PendingFactoryResetSchema.nullable() }) } }, description: "Null if nothing is staged." },
    ...errorResponses({ 403: "Owner only" }),
  },
});
storageRoutes.openapi(pendingResetRoute, (c) => c.json({ pending: pendingFactoryReset() }, 200));

const stageResetRoute = createRoute({
  method: "post",
  path: "/factory-reset",
  tags: ["Storage"],
  summary: `Stage a factory reset at the next boot - takes a fresh backup first, requires typing "${FACTORY_RESET_CONFIRMATION_PHRASE}"`,
  middleware: [requireRole("owner")] as const,
  request: { body: { content: { "application/json": { schema: z.object({ confirmation: z.string() }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ backupFilename: z.string() }) } }, description: "Staged. Restart the hub to apply it." },
    ...errorResponses({ 400: "Wrong confirmation phrase, or the safety backup failed", 403: "Owner only" }),
  },
});
storageRoutes.openapi(stageResetRoute, async (c) => {
  const { confirmation } = c.req.valid("json");
  const result = await stageFactoryReset(confirmation);
  if (!result.ok) return c.json({ error: result.error ?? "could not stage a factory reset" }, 400);
  return c.json({ backupFilename: result.backupFilename! }, 200);
});

const cancelResetRoute = createRoute({
  method: "post",
  path: "/factory-reset/cancel",
  tags: ["Storage"],
  summary: "Cancel a staged factory reset",
  middleware: [requireRole("owner")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ cancelled: z.boolean() }) } }, description: "Whether there was anything to cancel." },
    ...errorResponses({ 403: "Owner only" }),
  },
});
storageRoutes.openapi(cancelResetRoute, (c) => c.json({ cancelled: cancelPendingFactoryReset() }, 200));

// Diagnostics: owner/admin, no grant widening either - a support bundle
// still names every person's role/enabled state and the household's own
// non-secret settings, closer to "admin business" than a routine
// backups.run action a grant should be able to open up.
const DiagnosticsSchema = z.object({
  generatedAt: z.string(),
  schemaVersion: z.number(),
  hub: z.object({ instanceId: z.string() }),
  people: z.array(z.object({ id: z.string(), role: z.string(), enabled: z.boolean(), source: z.string(), createdAt: z.string() })),
  endpointCount: z.number(),
  issues: z.array(z.object({ source: z.string(), key: z.string(), severity: z.string(), createdAt: z.string(), resolvedAt: z.string().nullable() })),
  packages: z.array(z.object({ packageId: z.string(), status: z.string(), smokeOk: z.boolean().nullable() })),
  settings: z.array(z.object({ key: z.string(), value: z.any() })),
  storage: StorageSummarySchema,
});

const diagnosticsRoute = createRoute({
  method: "get",
  path: "/diagnostics",
  tags: ["Storage"],
  summary: "A redacted diagnostics report - no secret, address, or family name (spec/diagnostics/to-redact.json)",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: DiagnosticsSchema } }, description: "Safe to share with support." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
storageRoutes.openapi(diagnosticsRoute, (c) => c.json(generateDiagnostics(), 200));
