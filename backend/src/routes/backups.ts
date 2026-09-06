import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireRoleOrGrant } from "@/middleware/auth";
import { listBackups, runBackup, pruneBackups, stageRestore, pendingRestore, cancelPendingRestore } from "@/lib/backup";
import { RestoreRefused } from "@/lib/restoreStaging";

export const backupsRoutes = apiRouter();

const BackupInfoSchema = z.object({ filename: z.string(), createdAt: z.string(), bytes: z.number() });
const PendingRestoreSchema = z.object({ filename: z.string(), stagedAt: z.string(), stagedByPersonId: z.string() });

// Owner/admin only: unlike memory/conversation history, a backup isn't
// scoped to any one person, it's the whole household's data.
const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Backups"],
  summary: "List available backup files",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(BackupInfoSchema) } }, description: "Every backup on disk." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
backupsRoutes.openapi(listRoute, (c) => c.json(listBackups(), 200));

const runRoute = createRoute({
  method: "post",
  path: "/run",
  tags: ["Backups"],
  summary: "Run a backup now",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  responses: {
    200: { content: { "application/json": { schema: BackupInfoSchema } }, description: "The new backup." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
backupsRoutes.openapi(runRoute, (c) => {
  const info = runBackup();
  pruneBackups();
  return c.json(info, 200);
});

// Restore is owner-only, a deliberate step up from the owner/admin gate
// on the two routes above. Running a backup is additive and reversible;
// restoring replaces every person, memory and conversation in the house
// with an older set, including the roster that decides who is an admin
// in the first place. That is the household owner's call.
//
// Staging, not applying: see lib/restoreStaging.ts for why a running
// hub cannot safely swap its own live database, and what happens at the
// next restart instead.
const pendingRoute = createRoute({
  method: "get",
  path: "/restore/pending",
  tags: ["Backups"],
  summary: "The restore staged for the next boot, if any",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.restore")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ pending: PendingRestoreSchema.nullable() }) } }, description: "Null if nothing is staged." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
backupsRoutes.openapi(pendingRoute, (c) => c.json({ pending: pendingRestore() }, 200));

const cancelRoute = createRoute({
  method: "post",
  path: "/restore/cancel",
  tags: ["Backups"],
  summary: "Cancel a staged restore",
  middleware: [requireRoleOrGrant(["owner"], "backups.restore")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ cancelled: z.boolean() }) } }, description: "Whether there was anything to cancel." },
    ...errorResponses({ 403: "Owner only" }),
  },
});
backupsRoutes.openapi(cancelRoute, (c) => c.json({ cancelled: cancelPendingRestore() }, 200));

const restoreRoute = createRoute({
  method: "post",
  path: "/{filename}/restore",
  tags: ["Backups"],
  summary: "Stage a backup file to restore at the next boot",
  middleware: [requireRoleOrGrant(["owner"], "backups.restore")] as const,
  request: { params: idParamSchema("filename") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ pending: PendingRestoreSchema }) } }, description: "Staged for the next boot." },
    ...errorResponses({ 400: "The archive is refused (tampered, corrupt, or not a MaiPai Home backup)", 403: "Owner only", 404: "No such backup" }),
  },
});
backupsRoutes.openapi(restoreRoute, (c) => {
  const actor = c.get("person");
  const { filename } = c.req.valid("param");
  // Never a caller-supplied path. listBackups() is the only source of
  // truth for what exists, so a filename that isn't in it (a traversal
  // attempt, a stale name) is refused before anything touches the disk.
  if (!listBackups().some((b) => b.filename === filename)) {
    return c.json({ error: `no such backup: ${filename}` }, 404);
  }
  try {
    return c.json({ pending: stageRestore(filename, actor.id) }, 200);
  } catch (err) {
    // Only RestoreRefused messages are written for the person reading
    // them, so only those are passed through. A code review (2026-09-05)
    // found this returning every error verbatim, which sent a browser
    // Node's "Unsupported state or unable to authenticate data" for a
    // corrupt archive and, worse, an absolute server path out of the
    // data directory for a filesystem failure.
    if (err instanceof RestoreRefused) return c.json({ error: err.message }, 400);
    console.error(`[restore] staging ${filename} failed:`, err);
    return c.json({ error: "that backup could not be read. Try another one." }, 400);
  }
});
