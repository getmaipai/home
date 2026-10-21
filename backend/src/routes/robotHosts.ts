import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { createRobotHost, forgetRobotHost, getRobotHostRecord } from "@/lib/robotHost";
import { getDeviceById, deleteDevice } from "@/lib/devices";
import { FirmwareFlashManifest } from "@maipai/spec/gen/ts/firmware-flash-manifest.js";
import { makeEnrollImage, revokeEnrollment, saveEncryptedFlashBackup, verifiedFlashPart, verifiedStackChanManifest } from "@/lib/stackchanInstall";
import { robotsEnabled, ROBOTS_OFF_MESSAGE } from "@/lib/robots";
import { getRobotSoftware } from "@/lib/robotSoftware";
import { botReleaseVersion } from "@/lib/botRelease";
import { setRobotFirmwareInstalled } from "@/lib/settings";

export const robotHostRoutes = apiRouter();
const softwareShape = z.object({
  firmware: z.object({ installed: z.object({ version: z.string(), at: z.string() }).nullable(), available: z.string(), status: z.enum(["up_to_date", "update_available", "unknown"]) }),
  bot: z.object({ running: z.string().nullable(), available: z.string(), status: z.enum(["up_to_date", "restart_needed", "unknown"]) }),
});
const softwareRoute = createRoute({
  method: "get", path: "/hosts/{deviceId}/software", tags: ["Robots"], summary: "Get the software status for a hosted robot",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ deviceId: z.string() }) },
  responses: { 200: { content: { "application/json": { schema: softwareShape } }, description: "Robot software status." }, ...errorResponses({ 403: "Admin access is required", 404: "Hosted robot not found" }) },
});
robotHostRoutes.openapi(softwareRoute, (c) => {
  if (!robotsEnabled()) return c.json({ error: ROBOTS_OFF_MESSAGE }, 403);
  const { deviceId } = c.req.valid("param");
  if (!getRobotHostRecord(deviceId) || getDeviceById(deviceId)?.kind !== "robot") return c.json({ error: "That hosted robot could not be found." }, 404);
  return c.json(getRobotSoftware(deviceId), 200);
});

const firmwareInstalledRoute = createRoute({
  method: "post", path: "/hosts/{deviceId}/firmware-installed", tags: ["Robots"], summary: "Record firmware written by Home",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ deviceId: z.string() }), body: { content: { "application/json": { schema: z.object({ version: z.string().min(1).max(64) }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ recorded: z.literal(true) }) } }, description: "Firmware install recorded." }, ...errorResponses({ 400: "Version is not served by Home", 403: "Admin access is required", 404: "Hosted robot not found" }) },
});
robotHostRoutes.openapi(firmwareInstalledRoute, (c) => {
  if (!robotsEnabled()) return c.json({ error: ROBOTS_OFF_MESSAGE }, 403);
  const { deviceId } = c.req.valid("param");
  if (!getRobotHostRecord(deviceId) || getDeviceById(deviceId)?.kind !== "robot") return c.json({ error: "That hosted robot could not be found." }, 404);
  const { version } = c.req.valid("json");
  if (version !== botReleaseVersion()) return c.json({ error: "Home did not serve that firmware version. Update Home, then try again." }, 400);
  const result = setRobotFirmwareInstalled(deviceId, { version, at: new Date().toISOString() }, c.get("person").id);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ recorded: true as const }, 200);
});

const createRouteDef = createRoute({
  method: "post", path: "/hosts", tags: ["Robots"], summary: "Start a Bot app on Home for a StackChan",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: z.object({ label: z.string().min(1).max(60) }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ device_id: z.string(), ports: z.object({ voice: z.number(), avatar: z.number(), vision: z.number() }) }) } }, description: "Hosted robot created." }, ...errorResponses({ 403: "Robots are turned off or admin access is required", 500: "Robot host could not start" }) },
});
robotHostRoutes.openapi(createRouteDef, async (c) => {
  if (!robotsEnabled()) return c.json({ error: ROBOTS_OFF_MESSAGE }, 403);
  try { const result = await createRobotHost({ label: c.req.valid("json").label, personId: c.get("person").id }); return c.json({ device_id: result.deviceId, ports: result.ports }, 200); }
  catch (error) { return c.json({ error: `Could not start this robot host: ${(error as Error).message}. Check Repairs and try again.` }, 500); }
});

const manifestRoute = createRoute({
  method: "get", path: "/stackchan/flash-manifest", tags: ["Robots"], summary: "Get the verified StackChan flash manifest",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: FirmwareFlashManifest } }, description: "Verified flash layout." }, ...errorResponses({ 403: "Robots are turned off or admin access is required", 502: "Flash manifest could not be verified" }) },
});
robotHostRoutes.openapi(manifestRoute, async (c) => {
  if (!robotsEnabled()) return c.json({ error: ROBOTS_OFF_MESSAGE }, 403);
  try { const { manifest } = await verifiedStackChanManifest(); return c.json(manifest, 200); }
  catch { return c.json({ error: "Home could not verify the StackChan flash manifest. Check the connection or update Home, then try again." }, 502); }
});

const partRoute = createRoute({
  method: "get", path: "/stackchan/flash-parts/{path}", tags: ["Robots"], summary: "Get a verified StackChan flash part",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ path: z.string() }) },
  responses: { 200: { content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } }, description: "Verified flash bytes." }, ...errorResponses({ 403: "Robots are turned off or admin access is required", 404: "Flash part not found", 502: "Flash part failed verification" }) },
});
robotHostRoutes.openapi(partRoute, async (c) => {
  if (!robotsEnabled()) return c.json({ error: ROBOTS_OFF_MESSAGE }, 403);
  try {
    const { manifest, releaseDir } = await verifiedStackChanManifest();
    const bytes = verifiedFlashPart(manifest, releaseDir, c.req.valid("param").path);
    if (!bytes) return c.json({ error: "That flash part is not in the verified manifest." }, 404);
    c.header("Cache-Control", "no-store");
    const data = new Uint8Array(new ArrayBuffer(bytes.byteLength)); data.set(bytes);
    return c.body(data, 200, { "Content-Type": "application/octet-stream" });
  } catch { return c.json({ error: "Home could not verify that StackChan flash part. Update Home or try again." }, 502); }
});

const backupRoute = createRoute({
  method: "post", path: "/hosts/{deviceId}/flash-backup", tags: ["Robots"], summary: "Save an encrypted StackChan flash backup",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ deviceId: z.string() }), body: { content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ saved: z.literal(true) }) } }, description: "Encrypted backup saved." }, ...errorResponses({ 403: "Robots are turned off or admin access is required", 404: "Hosted robot not found", 413: "Backup is too large", 500: "Backup could not be encrypted" }) },
});
robotHostRoutes.openapi(backupRoute, async (c) => {
  if (!robotsEnabled()) return c.json({ error: ROBOTS_OFF_MESSAGE }, 403);
  const { deviceId } = c.req.valid("param");
  if (!getRobotHostRecord(deviceId) || getDeviceById(deviceId)?.kind !== "robot") return c.json({ error: "That hosted robot could not be found." }, 404);
  try { await saveEncryptedFlashBackup(deviceId, c.req.raw.body); return c.json({ saved: true as const }, 200); }
  catch (error) {
    const message = (error as Error).message;
    if (message.includes("larger than expected")) return c.json({ error: message }, 413);
    return c.json({ error: message }, 500);
  }
});

const enrollImageRoute = createRoute({
  method: "post", path: "/hosts/{deviceId}/enroll-image", tags: ["Robots"], summary: "Create a single-use StackChan enrollment image",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ deviceId: z.string() }) },
  responses: { 200: { content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } }, description: "NVS enrollment image." }, ...errorResponses({ 403: "Robots are turned off or admin access is required", 500: "Enrollment image could not be created" }) },
});
robotHostRoutes.openapi(enrollImageRoute, async (c) => {
  if (!robotsEnabled()) return c.json({ error: ROBOTS_OFF_MESSAGE }, 403);
  const { deviceId } = c.req.valid("param");
  if (!getRobotHostRecord(deviceId) || getDeviceById(deviceId)?.kind !== "robot") return c.json({ error: "That hosted robot could not be found." }, 404);
  try {
    const bytes = await makeEnrollImage(deviceId);
    c.header("Cache-Control", "no-store");
    const data = new Uint8Array(new ArrayBuffer(bytes.byteLength)); data.set(bytes);
    return c.body(data, 200, { "Content-Type": "application/octet-stream" });
  } catch (error) { return c.json({ error: (error as Error).message }, 500); }
});

const cancelInstallRoute = createRoute({
  method: "post", path: "/hosts/{deviceId}/cancel-install", tags: ["Robots"], summary: "Revoke enrollment and remove a not-yet-online robot",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ deviceId: z.string() }) },
  responses: { 200: { content: { "application/json": { schema: z.object({ removed: z.literal(true) }) } }, description: "Robot removed." }, ...errorResponses({ 403: "Robots are turned off or admin access is required", 404: "Robot not found", 409: "This robot has already connected", 500: "Install could not be cancelled" }) },
});

const installStatusRoute = createRoute({
  method: "get", path: "/hosts/{deviceId}/install-status", tags: ["Robots"], summary: "Check whether a hosted robot is still being installed",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ deviceId: z.string() }) },
  responses: { 200: { content: { "application/json": { schema: z.object({ hosted: z.literal(true), enrollment_pending: z.boolean() }) } }, description: "Install state." }, ...errorResponses({ 403: "Robots are turned off or admin access is required", 404: "Hosted robot not found" }) },
});
robotHostRoutes.openapi(installStatusRoute, (c) => {
  if (!robotsEnabled()) return c.json({ error: ROBOTS_OFF_MESSAGE }, 403);
  const host = getRobotHostRecord(c.req.valid("param").deviceId);
  if (!host || getDeviceById(host.deviceId)?.kind !== "robot") return c.json({ error: "That hosted robot could not be found." }, 404);
  return c.json({ hosted: true as const, enrollment_pending: !!host.enrollCodeId }, 200);
});
robotHostRoutes.openapi(cancelInstallRoute, async (c) => {
  if (!robotsEnabled()) return c.json({ error: ROBOTS_OFF_MESSAGE }, 403);
  const { deviceId } = c.req.valid("param");
  const device = getDeviceById(deviceId);
  if (!device || device.kind !== "robot" || !getRobotHostRecord(deviceId)) return c.json({ error: "That hosted robot could not be found." }, 404);
  if (device.lastSeenAt !== null) return c.json({ error: "This robot has already connected. Use Forget this robot in its settings instead." }, 409);
  try {
    await revokeEnrollment(deviceId);
    await forgetRobotHost(deviceId);
    deleteDevice(deviceId, device.personId);
    return c.json({ removed: true as const }, 200);
  } catch (error) { return c.json({ error: (error as Error).message }, 500); }
});
