import { createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth, requireRole, requireRoleOrGrant } from "@/middleware/auth";
import { listBackups, runBackupAndMirror, stageRestore, pendingRestore, cancelPendingRestore, getBackupHealth } from "@/lib/backup";
import { RestoreRefused } from "@/lib/restoreStaging";
import { getSmbTarget, setSmbTarget, removeSmbTarget } from "@/lib/backupTargets";
import { storeReceivedBackup, listReceivedBackups, deleteReceivedBackup, ReceivedBackupRefused } from "@/lib/receivedBackups";
import { generateEmergencyKit } from "@/lib/emergencyKit";
import { restorePersonFromBackup, PartialRestoreRefused } from "@/lib/partialRestore";
import { db } from "@/db";
import { devices as devicesTable, receivedBackups as receivedBackupsTable } from "@/db/schema";

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
backupsRoutes.openapi(runRoute, async (c) => {
  const info = await runBackupAndMirror();
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
backupsRoutes.openapi(restoreRoute, async (c) => {
  const actor = c.get("person");
  const { filename } = c.req.valid("param");
  // Never a caller-supplied path. listBackups() is the only source of
  // truth for what exists, so a filename that isn't in it (a traversal
  // attempt, a stale name) is refused before anything touches the disk.
  if (!listBackups().some((b) => b.filename === filename)) {
    return c.json({ error: `no such backup: ${filename}` }, 404);
  }
  // Step 8: "retention... before every update and restore" (2.5) - a
  // real, retained, off-site-mirrored snapshot of the CURRENT state,
  // taken right before it's about to be replaced. Deliberately best-
  // effort and never blocking: applyPendingRestore() already renames the
  // live database aside to hub.db.pre-restore before the swap (its own
  // header explains why), which is the real safety net a restore always
  // has regardless of this; this is the belt-and-suspenders half (a
  // proper encrypted archive, mirrored off-machine if configured) for
  // when the whole machine, not just the swap, is what's at risk. A
  // failure here must never block a restore the household explicitly
  // asked for - recordBackupFailure() (inside runBackupAndMirror())
  // already raises its own Repairs item for that.
  try {
    await runBackupAndMirror({ prune: false });
  } catch {
    // Already recorded by runBackupAndMirror() itself; proceeding
    // regardless, per this block's own comment above.
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

// Step 8: "at least one off-machine target or the Storage page warns"
// (2.5) - a Storage page needs to know what's configured and healthy to
// decide whether to warn at all. `local` and `hub` need no configuration
// (local always exists; hub is a receiving endpoint devices push to, see
// POST /api/backups/received below), so only `smb` has real settings
// here.
const TargetHealthSchema = z.object({
  consecutiveFailures: z.number(),
  lastFailureAt: z.string().nullable(),
  lastFailureMessage: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
});
const TargetsSchema = z.object({
  local: TargetHealthSchema.nullable(),
  smb: z.object({ path: z.string(), enabled: z.boolean(), health: TargetHealthSchema.nullable() }).nullable(),
});

const targetsRoute = createRoute({
  method: "get",
  path: "/targets",
  tags: ["Backups"],
  summary: "Configured backup targets and their health",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  responses: {
    200: { content: { "application/json": { schema: TargetsSchema } }, description: "smb is null if never configured." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
backupsRoutes.openapi(targetsRoute, (c) => {
  const smb = getSmbTarget();
  return c.json(
    {
      local: getBackupHealth("local"),
      smb: smb ? { ...smb, health: getBackupHealth("smb") } : null,
    },
    200,
  );
});

const setSmbTargetRoute = createRoute({
  method: "put",
  path: "/targets/smb",
  tags: ["Backups"],
  summary: "Configure the smb (NAS) backup target - a share already mounted at the OS level",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  request: {
    body: { content: { "application/json": { schema: z.object({ path: z.string(), enabled: z.boolean().default(true) }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Saved." },
    ...errorResponses({ 400: "The path is empty, or (if enabled) does not exist / is not a directory", 403: "Not owner/admin" }),
  },
});
backupsRoutes.openapi(setSmbTargetRoute, (c) => {
  const { path, enabled } = c.req.valid("json");
  const result = setSmbTarget(path, enabled);
  if (!result.ok) return c.json({ error: result.error ?? "invalid path" }, 400);
  return c.json({ success: true as const }, 200);
});

const removeSmbTargetRoute = createRoute({
  method: "delete",
  path: "/targets/smb",
  tags: ["Backups"],
  summary: "Remove the smb backup target",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Removed. Existing mirrored files on the share are left alone." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
backupsRoutes.openapi(removeSmbTargetRoute, (c) => {
  removeSmbTarget();
  return c.json({ success: true as const }, 200);
});

// Step 8: "hub as the interface a robot will use" - the receiving half
// of the `hub` target. Plain (non-openapi) route, the same reason
// routes/voice.ts's own multipart upload is: a raw multipart body
// doesn't fit @hono/zod-openapi's JSON-schema-shaped request/response
// validation the rest of this file uses, so it's invisible to the
// generated OpenAPI document like voice.ts's is, not converted for its
// own sake. bodyLimit rejects an oversized upload as its bytes arrive,
// the same reasoning voice.ts's own cloned-voice upload gives for doing
// this before buffering the whole thing into memory.
//
// A code review (2026-09-06) flagged that `file.arrayBuffer()` still
// buffers the WHOLE upload in memory before it ever reaches disk, the
// same real memory-pressure risk voice.ts's own upload already accepts
// at a much smaller cap - true streaming would mean bypassing Hono's
// parseBody() multipart parsing entirely for a raw request-stream
// reader, a bigger rearchitecture than this route justifies on its own.
// 2 GB is a real ceiling instead, not the original 10 GB: a household's
// own backup is memory/conversation/settings text with no media, so a
// send-a-real-database-worth-of-history archive stays well under this
// for the foreseeable future, and peak memory use is bounded
// accordingly rather than left open to whatever a device claims to be
// sending.
const MAX_RECEIVED_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;
backupsRoutes.post("/received", requireAuth, bodyLimit({ maxSize: MAX_RECEIVED_BACKUP_BYTES + 64 * 1024 }), async (c) => {
  const actor = c.get("person");
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const file = body.file;
  const deviceId = body.deviceId;
  if (!(file instanceof File)) return c.json({ error: "a file is required" }, 400);
  if (typeof deviceId !== "string" || !deviceId) return c.json({ error: "deviceId is required" }, 400);

  const device = db.select({ personId: devicesTable.personId }).from(devicesTable).where(eq(devicesTable.id, deviceId)).get();
  if (!device || device.personId !== actor.id) return c.json({ error: "no such device (or it isn't yours)" }, 404);

  const contents = Buffer.from(await file.arrayBuffer());
  try {
    const info = storeReceivedBackup(deviceId, file.name, contents);
    return c.json(info, 201);
  } catch (err) {
    if (err instanceof ReceivedBackupRefused) return c.json({ error: err.message }, 400);
    throw err;
  }
});

backupsRoutes.get("/received", requireAuth, (c) => {
  const actor = c.get("person");
  const ownDeviceIds = new Set(db.select({ id: devicesTable.id }).from(devicesTable).where(eq(devicesTable.personId, actor.id)).all().map((d) => d.id));
  const all = listReceivedBackups();
  return c.json(all.filter((b) => ownDeviceIds.has(b.deviceId)));
});

backupsRoutes.delete("/received/:id", requireAuth, (c) => {
  const actor = c.get("person");
  const id = c.req.param("id");
  const row = db.select({ deviceId: receivedBackupsTable.deviceId }).from(receivedBackupsTable).where(eq(receivedBackupsTable.id, id)).get();
  if (!row) return c.json({ error: "no such received backup" }, 404);
  const device = db.select({ personId: devicesTable.personId }).from(devicesTable).where(eq(devicesTable.id, row.deviceId)).get();
  if (!device || device.personId !== actor.id) return c.json({ error: "no such received backup" }, 404);
  const deleted = deleteReceivedBackup(row.deviceId, id);
  return c.json({ success: deleted }, 200);
});

// Step 8: the emergency kit - owner-only, no grant widening (unlike
// every other backups.run/backups.restore route above): this hands back
// the household's actual backup encryption key in plaintext, which is a
// different order of sensitivity than "who may click run a backup now".
const EmergencyKitSchema = z.object({
  hubName: z.string(),
  hubInstanceId: z.string(),
  backupKeyHex: z.string(),
  generatedAt: z.string(),
});
const emergencyKitRoute = createRoute({
  method: "get",
  path: "/emergency-kit",
  tags: ["Backups"],
  summary: "The backup encryption key and hub identity, for the printable emergency kit",
  middleware: [requireRole("owner")] as const,
  responses: {
    200: { content: { "application/json": { schema: EmergencyKitSchema } }, description: "Safe to call again later - re-viewing an unchanged key is not the risky action here." },
    ...errorResponses({ 403: "Owner only" }),
  },
});
backupsRoutes.openapi(emergencyKitRoute, (c) => c.json(generateEmergencyKit(), 200));

// Step 8: "partial restore of one person's data" - unlike full restore
// (owner-only, staged for the next boot), this is same-request, needs
// no restart, and never touches anyone else's data - so it stays at the
// regular owner/admin backups.restore gate, not owner-only.
const PartialRestoreResultSchema = z.object({
  memories: z.number(),
  conversations: z.number(),
  conversationThreads: z.number(),
  settings: z.number(),
});
const partialRestoreRoute = createRoute({
  method: "post",
  path: "/{filename}/restore-person/{personId}",
  tags: ["Backups"],
  summary: "Restore one person's memories, conversation history and settings from an old backup",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.restore")] as const,
  request: { params: z.object({ filename: z.string(), personId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: PartialRestoreResultSchema } }, description: "What came back." },
    ...errorResponses({ 400: "The archive is refused, or does not contain this person", 403: "Not owner/admin", 404: "No such backup, or no such living person" }),
  },
});
backupsRoutes.openapi(partialRestoreRoute, (c) => {
  const { filename, personId } = c.req.valid("param");
  // Same defense-in-depth the full-restore route above already applies:
  // never let a caller-supplied filename reach the filesystem unchecked.
  // restorePersonFromBackup()'s own existsSync() would already refuse a
  // traversal attempt in practice (join() resolving outside backupDir
  // almost never finds a real MaiPai backup there), but checking against
  // the real list first, before anything touches disk, is the same
  // belt-and-suspenders restoreRoute's own comment already argues for.
  if (!listBackups().some((b) => b.filename === filename)) {
    return c.json({ error: `no such backup: ${filename}` }, 404);
  }
  try {
    return c.json(restorePersonFromBackup(filename, personId), 200);
  } catch (err) {
    if (err instanceof PartialRestoreRefused) {
      const notFound = err.message.includes("no such person") || err.message.includes("no such backup");
      return c.json({ error: err.message }, notFound ? 404 : 400);
    }
    console.error(`[restore] partial restore of ${personId} from ${filename} failed:`, err);
    return c.json({ error: "that backup could not be read. Try another one." }, 400);
  }
});
