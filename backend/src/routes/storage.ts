import { clearPreviews, previewStats } from "@/lib/fileThumbnails";
// Step 9: storage, quotas, uninstall, factory reset, diagnostics (plan
// 4.15). "A Storage page (E)" reads most of what's here; none of it has
// a UI yet.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRoleOrGrant, requireRole, requireAuth } from "@/middleware/auth";
import { storageSummary, storageImpact } from "@/lib/storage";
import { storageUsageOverview } from "@/lib/storage/usage";
import { listNasMounts, createNasMount, deleteNasMount } from "@/lib/nasMounts";
import { stageFactoryReset, pendingFactoryReset, cancelPendingFactoryReset, FACTORY_RESET_CONFIRMATION_PHRASE } from "@/lib/factoryReset";
import { generateDiagnostics } from "@/lib/diagnostics";
import { clearPackageCache, getCacheSourceStats, getCacheStats, OTHER_CACHE_SOURCE } from "@/lib/packageCache";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { loadManifestOnly } from "@/lib/plugins";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "@/lib/paths";
// Renamed from the bare `File` export, same reason attachments.ts's own
// toRecord() does: `File` is a Bun/Fetch global, so importing the spec's
// zod object under that name would shadow it.
import { FileObject as FileRecordSchema } from "@/lib/fileRecordObject";

export const storageRoutes = apiRouter();

const CleanupItemSchema = z.object({ id: z.string(), kind: z.enum(["superseded", "orphan_folder", "partial_download", "package_cache", "previews", "rollback_copies"]), label: z.string(), bytes: z.number().nonnegative(), reversible: z.boolean(), how: z.string(), blocked: z.string().nullable() });
const rollbackHelper = () => process.env.MAIPAI_ROLLBACK_HELPER ?? "/usr/local/libexec/maipai-prune-rollbacks";
function runRollbackHelper(args: string[], timeout: number) {
  const helper = rollbackHelper();
  const installRoot = resolve(process.env.MAIPAI_INSTALL_ROOT ?? repoRoot);
  return process.env.MAIPAI_ROLLBACK_HELPER
    ? spawnSync(helper, args, { encoding: "utf8", timeout, env: { ...process.env, MAIPAI_INSTALL_ROOT: installRoot } })
    : spawnSync("sudo", ["-n", helper, ...args], { encoding: "utf8", timeout, env: { ...process.env, MAIPAI_INSTALL_ROOT: installRoot } });
}
function rollbackCopies(): Array<{ name: string; bytes: number }> {
  if (!existsSync(rollbackHelper())) return [];
  const result = runRollbackHelper(["list"], 8_000);
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [name, bytesText, extra] = line.split("\t");
    const bytes = Number(bytesText);
    return name && /^data\.rolled-back-[0-9-]+$/.test(name) && extra === undefined && Number.isSafeInteger(bytes) && bytes >= 0 ? [{ name, bytes }] : [];
  });
}
async function cleanupItems() {
  const rows: Array<z.infer<typeof CleanupItemSchema>> = [];
  if (isStackConfigured()) try {
    const plan = await getStackClient().tidyPlan?.();
    for (const item of plan?.items ?? []) rows.push({ id: `tidy:${item.id}`, kind: item.kind, label: item.kind === "superseded" ? `Superseded model: ${item.id}` : item.kind === "orphan_folder" ? `Orphan model folder: ${item.id.split("/").pop()}` : `Partial download: ${item.id.split("/").pop()}`, bytes: item.bytes, reversible: true, how: item.reason, blocked: item.blocked ?? (item.reason.includes("removable after") ? item.reason : null) });
  } catch { /* Stack cleanup is unavailable until it answers. */ }
  const cacheBytes = getCacheStats().reduce((sum, item) => sum + item.sizeBytes, 0);
  if (cacheBytes) rows.push({ id: "package_cache", kind: "package_cache", label: "Package cache", bytes: cacheBytes, reversible: true, how: "Saved copies fetched by packages; they can be fetched again.", blocked: null });
  const previews = previewStats();
  if (previews.bytes) rows.push({ id: "previews", kind: "previews", label: "Previews", bytes: previews.bytes, reversible: true, how: "Previews rebuild when viewed again.", blocked: null });
  const rollbacks = rollbackCopies();
  if (rollbacks.length > 2) rows.push({ id: "rollback-copies", kind: "rollback_copies", label: "Old update backups", bytes: rollbacks.slice(0, -2).reduce((sum, item) => sum + item.bytes, 0), reversible: true, how: `${rollbacks.length - 2} old update backups can be removed.`, blocked: null });
  return rows;
}
const cleanupListRoute = createRoute({ method: "get", path: "/cleanup", tags: ["Storage"], summary: "List safely clearable product files", middleware: [requireRole("owner", "admin")] as const, responses: { 200: { content: { "application/json": { schema: z.array(CleanupItemSchema) } }, description: "Product-owned cleanup candidates; blocked candidates remain listed." }, ...errorResponses({ 403: "Not owner/admin" }) } });
storageRoutes.openapi(cleanupListRoute, async (c) => c.json(await cleanupItems(), 200));
const cleanupRunRoute = createRoute({
  method: "post", path: "/cleanup", tags: ["Storage"], summary: "Clear selected safe product files", middleware: [requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: z.object({ ids: z.array(z.string()).min(1).max(100) }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ bytes_freed: z.number().nonnegative() }) } }, description: "Bytes freed." }, ...errorResponses({ 400: "Unknown or blocked item", 500: "Cleanup helper failed" }) },
});
storageRoutes.openapi(cleanupRunRoute, async (c) => {
  const { ids } = c.req.valid("json");
  const available = await cleanupItems();
  if (new Set(ids).size !== ids.length || ids.some((id) => !available.some((item) => item.id === id))) return c.json({ error: "Unknown or blocked cleanup item." }, 400);
  const chosen = ids.map((id) => available.find((item) => item.id === id)!);
  if (chosen.some((item) => item.blocked)) return c.json({ error: "Unknown or blocked cleanup item." }, 400);
  let freed = 0;
  const tidyIds = chosen.filter((item) => item.id.startsWith("tidy:")).map((item) => item.id.slice(5));
  if (tidyIds.length) {
    const full = available.filter((item) => item.id.startsWith("tidy:") && !item.blocked).map((item) => item.id.slice(5));
    if (full.some((id) => !tidyIds.includes(id))) return c.json({ error: "Select every available model cleanup item together." }, 400);
    const result = await getStackClient().tidyRun?.(false);
    freed += result?.removed.reduce((sum, item) => sum + item.bytes, 0) ?? 0;
  }
  if (chosen.some((item) => item.id === "package_cache")) freed += clearPackageCache().bytes;
  if (chosen.some((item) => item.id === "previews")) freed += clearPreviews().bytes;
  if (chosen.some((item) => item.id === "rollback-copies")) {
    const copies = rollbackCopies();
    const clearable = copies.slice(0, -2);
    if (clearable.length) {
      const result = runRollbackHelper(["prune", ...clearable.map((item) => item.name)], 30_000);
      if (result.status !== 0) return c.json({ error: "Could not clear old update backups." }, 500);
      freed += clearable.reduce((sum, item) => sum + item.bytes, 0);
    }
  }
  return c.json({ bytes_freed: freed }, 200);
});

const PackageCacheSourceSchema = z.object({ source: z.string(), packageId: z.string(), label: z.string(), entryCount: z.number(), sizeBytes: z.number() });
const packageCacheRoute = createRoute({
  method: "get",
  path: "/package-cache",
  tags: ["Storage"],
  summary: "Saved copies fetched by packages, grouped by source",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(PackageCacheSourceSchema) } }, description: "Cached entries grouped by their declared source." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
storageRoutes.openapi(packageCacheRoute, (c) => {
  const rows = new Map<string, { source: string; packageId: string; label: string; entryCount: number; sizeBytes: number }>();
  for (const row of getCacheSourceStats()) {
    if (row.source === OTHER_CACHE_SOURCE) {
      const other = rows.get(OTHER_CACHE_SOURCE) ?? { source: OTHER_CACHE_SOURCE, packageId: "other", label: "Other", entryCount: 0, sizeBytes: 0 };
      other.entryCount += row.entryCount;
      other.sizeBytes += row.sizeBytes;
      rows.set(OTHER_CACHE_SOURCE, other);
      continue;
    }
    const loaded = loadManifestOnly(row.packageId);
    const manifest = loaded.ok ? loaded.value : null;
    const sourceId = row.source.startsWith(`${row.packageId}:`) ? row.source.slice(row.packageId.length + 1) : row.source;
    const declared = manifest?.data_sources?.find((item) => item.id === sourceId);
    const sourceLabel = declared?.who || declared?.id || row.source;
    rows.set(row.source, { ...row, label: `${manifest?.display || row.packageId} · ${sourceLabel}` });
  }
  return c.json([...rows.values()], 200);
});

const clearPackageCacheRoute = createRoute({
  method: "post",
  path: "/package-cache/clear",
  tags: ["Storage"],
  summary: "Clear saved copies fetched by packages",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: z.object({ source: z.string().optional() }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ removed: z.number(), bytes: z.number() }) } }, description: "Number and size of removed cache entries." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
storageRoutes.openapi(clearPackageCacheRoute, (c) => {
  const { source } = c.req.valid("json");
  const result = clearPackageCache({ source: source === OTHER_CACHE_SOURCE ? null : source });
  const person = c.get("person");
  console.log(`[storage] package cache cleared person=${person.id} source=${source ?? "all"} removed=${result.removed} bytes=${result.bytes}`);
  return c.json(result, 200);
});

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

const StorageImpactSchema = z.object({
  disk: z.object({ totalBytes: z.number(), freeBytes: z.number() }),
  requiredBytes: z.number(),
  freeBytesAfter: z.number(),
  fits: z.boolean(),
});

const impactRoute = createRoute({
  method: "get",
  path: "/impact",
  tags: ["Storage"],
  summary: "Free space at a chosen path, before and after installing something of a given size",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  request: {
    query: z.object({
      path: z.string().openapi({ param: { name: "path", in: "query" }, example: "/Volumes/library-drive" }),
      requiredBytes: z.coerce.number().nonnegative().openapi({ param: { name: "requiredBytes", in: "query" }, example: 14_400_000_000 }),
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: StorageImpactSchema } }, description: "path falls back to the hub's own data folder when it doesn't exist yet (an external drive not currently mounted, say) - diskUsage()'s own fallback." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
storageRoutes.openapi(impactRoute, (c) => {
  const { path, requiredBytes } = c.req.valid("query");
  return c.json(storageImpact(path, requiredBytes), 200);
});

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

// STORE-PAGE-01: the Storage settings page's one read - every signed-in
// person may call this (unlike every other route in this file, all
// owner/admin only), because the row-visibility rule lives inside
// storageUsageOverview() itself (a child sees only their own row, never
// the household total or a sibling's row), the same "self, or an owner/
// admin" shape settings' own person-scope reads already enforce - not a
// second gate re-applied here.
// `kind` reuses the spec's own closed enum (image/video/audio/document/
// story/other) rather than a bare `z.string()` - a code review caught the
// widened type, which would have let the generated OpenAPI docs drift
// from `file.schema.json`'s real shape (STORE-SPEC-01's "one definition").
const KindBreakdownSchema = z.object({ kind: FileRecordSchema.shape.kind, bytes: z.number() });
const PersonStorageRowSchema = z.object({
  personId: z.string(),
  displayName: z.string(),
  role: z.string(),
  usageBytes: z.number(),
  capBytes: z.number(),
  byKind: z.array(KindBreakdownSchema),
});
const StorageUsageOverviewSchema = z.object({
  people: z.array(PersonStorageRowSchema),
  household: z.object({ usageBytes: z.number(), capBytes: z.number(), inherited: z.object({ files: z.number(), bytes: z.number() }) }).nullable(),
});

const usageRoute = createRoute({
  method: "get",
  path: "/usage",
  tags: ["Storage"],
  summary: "Per-person storage usage against cap, largest kinds, and the household total",
  description: "An owner/admin sees every active person's row plus the household total; anyone else sees a single row (themself only) and a null household - the same numbers lib/storage/usage.ts's personUsageBytes()/householdUsageBytes()/personCapBytes()/householdCapBytes() compute for the record API's own cap enforcement (STORE-CAP-01) and for the performance dashboard's disk panel (GET /api/performance).",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: StorageUsageOverviewSchema } }, description: "Real numbers, computed straight from the File records." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
storageRoutes.openapi(usageRoute, (c) => c.json(storageUsageOverview(c.get("person")), 200));

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

const previewsSchema = z.object({ removed: z.number(), bytes: z.number() });
for (const method of ["get", "delete"] as const) {
  const route = createRoute({
    method, path: "/previews", tags: ["Storage"], summary: method === "get" ? "Previews disk usage" : "Clear previews",
    middleware: [requireRole("owner", "admin")] as const,
    responses: { 200: { content: { "application/json": { schema: previewsSchema } }, description: "Preview count and bytes." }, ...errorResponses({ 403: "Not owner/admin" }) },
  });
  storageRoutes.openapi(route, (c) => c.json(method === "get" ? previewStats() : clearPreviews(),200));
}
