// Session F, step 6: the household's own device inventory (wave-2's F-
// to-E contract: "GET /api/devices, DELETE /api/devices/:id"). Scoped to
// the signed-in person's own paired devices, same personal-Profile-page
// scope BACKLOG.md's "Sessions per device under Profile with revoke"
// describes - not a household-wide admin view (that's a later, undecided
// feature; nothing in this wave's contract asks for one).
import { getCookie } from "hono/cookie";
import { createRoute, z } from "@hono/zod-openapi";
import { upgradeWebSocket } from "hono/bun";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { acceptFrame, MAX_FRAME_BYTES } from "@/lib/robotVision";
import { LIVE_VIEW_CONTENT_TYPE, getLiveView, liveViewAdmits, liveViewStream, pushLiveFrame, startLiveView, stopLiveView } from "@/lib/liveView";
import { requireAuth, requireRole, requireDeviceSession, resolveHumanSession } from "@/middleware/auth";
import { mediaBandOf } from "@/lib/media/band";
import { mayHoldMediaOffline, listDevicesForPerson, listDevicesByKind, deleteDevice, getDeviceById, setDeviceOfflineScope, updateDevice } from "@/lib/devices";
import { forgetRobotSocketAddress, getDeviceState, getPendingMotorRebootOffer, getRobotSocketAddress, markMotorRebootAnswered, recordRobotSocketAddress, resolveRequestDevice, stateForViewer, upsertDeviceState } from "@/lib/deviceStates";
import { speakerAgeBand } from "@/lib/ageBand";
import { RobotState } from "@maipai/spec/gen/ts/robot-state.js";
import { discoverRobots } from "@/lib/robotDiscovery";
import { rotateRobotPassword, RobotPasswordRotationError } from "@/lib/robotSsh";
import { storeRobotCredential, hasRotatedRobotCredential, getRobotCredential, getMostRecentRobotCredentialForHost } from "@/lib/robotCredentials";
import { ensureRobotAssets, isRobotAssetAvailable, readVerifiedRobotAsset, robotAssetById, ROBOT_ASSETS } from "@/lib/robotAssets";
import { readRobotClipBundle, readVerifiedRobotClipAsset, robotClipAssetForDevice, robotClipBundleExists } from "@/lib/robotClips";
import { closeDeviceCommandChannel, deviceCommandWebSocket, issueDeviceCommand } from "@/lib/deviceCommands";
import { listHubEndpoints } from "@/lib/hubEndpoints";
import { getHubInstanceId } from "@/lib/hubIdentity";
import { getDeviceSettingValue, getHouseholdSettingValue } from "@/lib/settings";
import { companionsForControls, robotCompanionOf, robotControlsOf } from "@/lib/robotCompanion";
import { companionVoiceKey } from "@/settings/companionVoiceKeys";
import { listRobotPeople } from "@/lib/robotPeople";
import { acceptRobotSelfTestResult, startRobotSelfTest } from "@/lib/robotSelfTestRuns";
import { robotSelfTestPartsFor } from "@/wire";
import { RobotSelfTestResult } from "@maipai/spec/gen/ts/robot-self-test-result.js";
import { forgetRobotHost } from "@/lib/robotHost";
import { getRobotCheckin, recordRobotCheckin, type RobotCheckin } from "@/lib/robotCheckin";

export const devicesRoutes = apiRouter();

// The only robot-opened hub command channel. Authentication is the same
// session cookie minted by /api/auth/devices/redeem; no robot credential or
// transport library is added here.
devicesRoutes.get(
  "/me/events",
  requireDeviceSession("robot"),
  upgradeWebSocket((c) => {
    const device = resolveRequestDevice(c);
    return device ? deviceCommandWebSocket(device.id, c.req.header("last-event-id")) : {};
  }),
);

const DeviceSchema = z.object({
  id: z.string(),
  kind: z.enum(["robot", "pod", "tv", "phone", "desktop", "browser"]),
  name: z.string(),
  area: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  /** Robots only: the body reports the unit connected right now (last seen alone also moves when the body calls the hub). */
  online: z.boolean().optional(),
  createdAt: z.string(),
  ipAddress: z.string().optional(),
  // ROBOT-ADMIN-PLACE-01: a robot is a household member like a pet; everyone sees who owns it.
  ownerName: z.string().optional(),
  ownerId: z.string().optional(),
  // A code review (2026-09-28): stored on pairing (createDevice) but never
  // surfaced before now - ROBOT-CARD-01 (not yet built) is what actually
  // renders it; carried here so that page has something to read once it
  // exists.
  capabilities: z.array(z.string()),
  offlineScope: z.array(z.enum(["media.offline", "offline.records"])),
  state: z.object({
    activity: RobotState.shape.activity,
    muted: z.boolean(),
    tracking: z.boolean(),
    on_battery: z.boolean().nullable(),
    battery_level: z.number().nullable(),
    daemon_version: z.string().nullable(),
    app_version: z.string().nullable(),
    motion: RobotState.shape.motion,
    put_down_count: RobotState.shape.put_down_count,
    motors_latched: RobotState.shape.motors_latched,
    motors_stuck: RobotState.shape.motors_stuck,
    motors_reboot_offer: RobotState.shape.motors_reboot_offer,
    thermal: RobotState.shape.thermal,
    reachable: z.boolean(),
    unreachableSince: z.string().nullable(),
  }).nullable(),
});

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Devices"],
  summary: "Devices paired to my own profile",
  middleware: [requireAuth] as const,
  request: { query: z.object({ kind: DeviceSchema.shape.kind.optional() }) },
  responses: {
    200: { content: { "application/json": { schema: z.array(DeviceSchema) } }, description: "Every device with a live or once-live token paired to me." },
  },
});
devicesRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  const { kind } = c.req.valid("query");
  const devices = listDevicesForPerson(actor.id).filter((device) => kind === undefined || device.kind === kind);
  return c.json(
    devices.map((d) => ({ id: d.id, kind: d.kind, name: d.name, area: d.area, lastSeenAt: d.lastSeenAt, ...(d.kind === "robot" ? { online: getRobotCheckin(d.id)?.online ?? false } : {}), createdAt: d.createdAt, ...(d.kind === "robot" && (actor.role === "owner" || actor.role === "admin") && getRobotSocketAddress(d.id) ? { ipAddress: getRobotSocketAddress(d.id)! } : {}), capabilities: d.capabilities, offlineScope: d.offlineScope as Array<"media.offline" | "offline.records">, state: d.kind === "robot" ? stateForViewer(getDeviceState(d.id), actor) : null })),
    200,
  );
});

// ROBOT-DEVICE-01: household-wide, unlike listRoute above - Quick Connect
// mints a robot's device under whichever admin approved the pairing, so a
// different admin still needs to find it here to rotate its password.
const listRobotsRoute = createRoute({
  method: "get",
  path: "/robots",
  tags: ["Devices"],
  summary: "Every paired robot, household-wide, with who owns each (anyone signed in)",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(DeviceSchema) } }, description: "Every device of kind \"robot\", regardless of who paired it." },
  },
});
devicesRoutes.openapi(listRobotsRoute, (c) => {
  const viewer = c.get("person");
  const admin = viewer.role === "owner" || viewer.role === "admin";
  const robots = listDevicesByKind("robot");
  const ownerNames = new Map(db.select({ id: people.id, name: people.displayName }).from(people).all().map((row) => [row.id, row.name] as const));
  return c.json(
    robots.map((d) => ({ id: d.id, kind: d.kind, name: d.name, area: d.area, lastSeenAt: d.lastSeenAt, ...(d.kind === "robot" ? { online: getRobotCheckin(d.id)?.online ?? false } : {}), createdAt: d.createdAt, ...(admin && getRobotSocketAddress(d.id) ? { ipAddress: getRobotSocketAddress(d.id)! } : {}), ...(ownerNames.has(d.personId) ? { ownerName: ownerNames.get(d.personId)!, ownerId: d.personId } : {}), capabilities: d.capabilities, offlineScope: d.offlineScope as Array<"media.offline" | "offline.records">, state: stateForViewer(getDeviceState(d.id), viewer) })),
    200,
  );
});

const updateMyStateRoute = createRoute({
  method: "put",
  path: "/me/state",
  tags: ["Devices"],
  summary: "Report the current state of this paired robot",
  middleware: [requireDeviceSession("robot")] as const,
  request: { body: { content: { "application/json": { schema: RobotState } } } },
  responses: {
    204: { description: "State frame accepted." },
    ...errorResponses({ 400: "Malformed state frame", 401: "Not signed in at all", 403: "Signed in, but not a robot device" }),
  },
});
devicesRoutes.openapi(updateMyStateRoute, (c) => {
  const device = resolveRequestDevice(c);
  if (!device) return c.json({ error: "Not signed in" }, 401);
  recordRobotSocketAddress(c, device.id);
  upsertDeviceState(device.id, c.req.valid("json"));
  return c.body(null, 204);
});

// The body's report is telemetry: a field it cannot fill (or fills with a value this schema does not know) becomes null instead of
// refusing the whole report, so the robot page never loses its status over one odd reading.
const loose = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().catch(null);
const robotCheckinSchema = z.object({
  device_id: z.string().max(128).nullable().catch(null).transform((v) => v ?? ""), board: z.string().max(64).catch("m5stack-stack-chan"), online: z.boolean().catch(false),
  last_seen: z.string().datetime({ offset: true }), connected_since: loose(z.string().datetime({ offset: true })),
  ip: loose(z.string().max(64)), firmware_version: loose(z.string().max(64)), bot_version: loose(z.string().max(64)),
  rssi: loose(z.number().int()), signal: z.enum(["strong", "medium", "weak"]).nullable().catch(null),
  free_heap_internal: loose(z.number().int().nonnegative()), free_heap_min: loose(z.number().int().nonnegative()), psram_free: loose(z.number().int().nonnegative()),
  boot_reason: loose(z.number().int()), crash_resets: loose(z.number().int().nonnegative()),
  battery_level: loose(z.number().int().min(0).max(100)), charging: loose(z.boolean()),
});
const robotCheckinRoute = createRoute({
  method: "put", path: "/me/checkin", tags: ["Devices"], summary: "Report the current StackChan check-in",
  middleware: [requireDeviceSession("robot")] as const,
  request: { body: { content: { "application/json": { schema: z.record(z.string(), z.unknown()).openapi({ description: "The body's check-in report; fields are listed in docs/dev/robot-checkin in the bot repository. Unknown or odd readings become null." }) } } } },
  responses: { 204: { description: "Check-in accepted." }, ...errorResponses({ 400: "Malformed check-in", 401: "Not signed in", 403: "Not a robot device" }) },
});
devicesRoutes.openapi(robotCheckinRoute, (c) => {
  const parsed = robotCheckinSchema.safeParse(c.req.valid("json"));
  if (!parsed.success) return c.json({ error: "The check-in needs a last_seen time. Send an ISO time with it." }, 400);
  const body = parsed.data as RobotCheckin;
  const device = resolveRequestDevice(c);
  if (!device) return c.json({ error: "Not signed in" }, 401);
  // body.device_id is the unit's MAC; the signed-in robot session decides which device this report belongs to.
  recordRobotCheckin(device.id, body, device.personId);
  return c.body(null, 204);
});

const selfTestResultRoute = createRoute({
  method: "post", path: "/me/self-test/{run_id}", tags: ["Devices"],
  summary: "Return one part self-test result to the waiting hub request",
  middleware: [requireDeviceSession("robot")] as const,
  request: { params: z.object({ run_id: z.string().min(1).max(64) }), body: { content: { "application/json": { schema: RobotSelfTestResult } } } },
  responses: { 204: { description: "Result accepted." }, ...errorResponses({ 400: "Invalid result", 401: "Not signed in", 403: "Not a robot device", 404: "Unknown or expired test" }) },
});
devicesRoutes.openapi(selfTestResultRoute, (c) => {
  const result = c.req.valid("json");
  if (result.run_id !== c.req.valid("param").run_id) return c.json({ error: "Unknown or expired test" }, 404);
  const accepted = acceptRobotSelfTestResult(c.get("deviceId"), result);
  if (accepted === "invalid") return c.json({ error: "Invalid result" }, 400);
  if (accepted === "unknown") return c.json({ error: "Unknown or expired test" }, 404);
  return c.body(null, 204);
});

const selfTestRoute = createRoute({
  method: "post", path: "/{id}/self-test", tags: ["Devices"],
  summary: "Test one reported part of a paired robot",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: idParamSchema("id", "device-a1b2c3"), body: { content: { "application/json": { schema: z.object({ part: z.enum(["speaker", "face", "head", "lights", "mic"]) }) } } } },
  responses: {
    200: { content: { "application/json": { schema: RobotSelfTestResult } }, description: "The robot's pass or fail result." },
    ...errorResponses({ 400: "Part was not reported", 403: "Admin only", 404: "No such robot" }),
    409: { content: { "application/json": { schema: z.object({ code: z.literal("robot_offline"), lastSeenAt: z.string().nullable(), error: z.string() }) } }, description: "The robot is not reachable." },
    504: { content: { "application/json": { schema: z.object({ code: z.literal("robot_no_answer"), error: z.string() }) } }, description: "The robot did not answer before the test timed out." },
  },
});
devicesRoutes.openapi(selfTestRoute, async (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const device = getDeviceById(id);
  if (!device || (device.personId !== actor.id && actor.role !== "owner" && actor.role !== "admin")) return c.json({ error: "No such robot" }, 404);
  if (device.kind !== "robot") return c.json({ error: "No such robot" }, 404);
  const { part } = c.req.valid("json");
  if (!robotSelfTestPartsFor(device).includes(part)) return c.json({ error: "This robot did not report that part." }, 400);
  const state = getDeviceState(device.id);
  if (!state?.reachable) {
    const lastSeenAt = state?.unreachableSince ?? device.lastSeenAt;
    // The clock time is left to the page, which knows the viewer's time zone.
    return c.json({ code: "robot_offline" as const, lastSeenAt, error: "This robot is offline. Check that it is on and on your Wi-Fi, then try again." }, 409);
  }
  const run = startRobotSelfTest(device.id, part);
  const result = await run.result;
  if (!result) return c.json({ code: "robot_no_answer" as const, error: "The robot did not answer the test. Restart it, then try again." }, 504);
  return c.json(result, 200);
});

const PatchDeviceSchema = z.object({
  name: z.string().trim().min(1, "A name is 1 to 60 characters.").max(60, "A name is 1 to 60 characters.").optional(),
  area: z.string().trim().min(1, "An area is 1 to 60 characters.").max(60, "An area is 1 to 60 characters.").nullable().optional(),
}).refine((body) => body.name !== undefined || body.area !== undefined, { message: "Provide a name or area." });
const patchDeviceRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Devices"],
  summary: "Update a paired device's name or area",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: idParamSchema("id", "device-a1b2c3"), body: { content: { "application/json": { schema: PatchDeviceSchema } } } },
  responses: {
    200: { content: { "application/json": { schema: DeviceSchema } }, description: "Updated device." },
    ...errorResponses({ 400: "Invalid name or area", 404: "No such device", 409: "Another robot already has this name" }),
  },
});
devicesRoutes.openapi(patchDeviceRoute, (c) => {
  const { id } = c.req.valid("param");
  const raw = c.req.valid("json");
  const existing = getDeviceById(id);
  if (!existing) return c.json({ error: "No such device" }, 404);
  const result = updateDevice(id, raw);
  if (!result.ok && result.reason === "robot_name_taken") return c.json({ error: `Another robot is already called ${result.existingName}. Pick a different name.` }, 409);
  if (!result.ok) return c.json({ error: "No such device" }, 404);
  const updated = result.device;
  return c.json({ id: updated.id, kind: updated.kind, name: updated.name, area: updated.area, lastSeenAt: updated.lastSeenAt, createdAt: updated.createdAt, capabilities: updated.capabilities, offlineScope: updated.offlineScope as Array<"media.offline" | "offline.records">, state: updated.kind === "robot" ? stateForViewer(getDeviceState(id), c.get("person")) : null }, 200);
});

// ROBOT-COMPANION-01: what the robot page needs to draw the Controls and Companion choices. Admin only. The list holds only the
// companions this robot's controls allow, so the page can show nothing else; the hub refuses the rest on write.
const robotCompanionRoute = createRoute({
  method: "get", path: "/{id}/companion", tags: ["Devices"],
  summary: "A robot's controls, its companion and the companions its controls allow",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: idParamSchema("id", "device-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.object({
      controls: z.enum(["child", "teen", "adult"]),
      companion_id: z.string(),
      companions: z.array(z.object({ id: z.string(), name: z.string(), type: z.enum(["child", "teen", "adult"]), audience: z.enum(["all", "teen", "adult"]), tagline: z.string().optional() })),
      home_location_set: z.boolean(),
      speaking: z.object({ voice_id: z.string(), source: z.enum(["robot", "companion", "home"]), companion_name: z.string().optional() }),
    }) } }, description: "The robot's assignment, its allowed companions and the voice it speaks in (a voice id, or \"default\" for the built-in one)." },
    ...errorResponses({ 403: "Admin only", 404: "No such robot" }),
  },
});
devicesRoutes.openapi(robotCompanionRoute, (c) => {
  const device = getDeviceById(c.req.valid("param").id);
  if (!device || device.kind !== "robot") return c.json({ error: "No such robot" }, 404);
  const controls = robotControlsOf(device.id);
  const companion = robotCompanionOf(device.id);
  const named = (value: unknown): string | null => (typeof value === "string" && value && value !== "default" ? value : null);
  const own = named(getDeviceSettingValue(device.id, "robot.voice.id"));
  const theirs = companion ? named(getHouseholdSettingValue(companionVoiceKey(companion.id))) : null;
  const speaking = own ? { voice_id: own, source: "robot" as const }
    : theirs ? { voice_id: theirs, source: "companion" as const, companion_name: companion!.name }
    : { voice_id: named(getHouseholdSettingValue("tts.home_voice")) ?? "default", source: "home" as const };
  return c.json({
    controls,
    speaking,
    companion_id: companion?.id ?? "",
    companions: companionsForControls(controls).map((persona) => ({ id: persona.id, name: persona.name, type: persona.floor, audience: persona.audience })),
    home_location_set: typeof getHouseholdSettingValue("household.home") === "string",
  }, 200);
});

const HubEndpointsSchema = z.array(z.object({
  id: z.string(), name: z.string(), url: z.string(), kind: z.enum(["lan", "overlay", "public"]),
  priority: z.number(), enabled: z.boolean(), source: z.enum(["detected", "managed"]), instanceId: z.string(),
}));
const hubEndpointsRoute = createRoute({
  method: "get",
  path: "/me/hub-endpoints",
  tags: ["Devices"],
  summary: "The reachable hub addresses for this robot",
  middleware: [requireDeviceSession("robot")] as const,
  responses: {
    200: { content: { "application/json": { schema: HubEndpointsSchema } }, description: "Hub addresses the robot may use, each bound to this hub's stable instance id." },
    ...errorResponses({ 401: "Not signed in", 403: "Not a robot device session" }),
  },
});
devicesRoutes.openapi(hubEndpointsRoute, async (c) => {
  const device = resolveRequestDevice(c);
  if (device) recordRobotSocketAddress(c, device.id);
  const includeOverlay = getHouseholdSettingValue("robot.offlan.tailnet") === true;
  const instanceId = getHubInstanceId();
  const endpoints = await listHubEndpoints();
  return c.json(endpoints
    .filter((endpoint) => endpoint.kind !== "overlay" || includeOverlay)
    .map((endpoint) => ({ ...endpoint, instanceId })), 200);
});

const RobotPeopleSchema = z.object({
  as_of: z.string(),
  people: z.array(z.object({ person_id: z.string(), age_band: z.enum(["adult", "teen", "child"]), follow_up: z.boolean() })),
});
const robotPeopleRoute = createRoute({
  method: "get",
  path: "/me/people",
  tags: ["Devices"],
  summary: "The age band and follow-up switch of each person this robot can recognise",
  middleware: [requireDeviceSession("robot")] as const,
  responses: {
    200: { content: { "application/json": { schema: RobotPeopleSchema } }, description: "A wholesale snapshot: a person missing from it is forgotten by the robot. No names; only people with a live, robot-eligible face print." },
    ...errorResponses({ 401: "Not signed in", 403: "Not a robot device session" }),
  },
});
devicesRoutes.openapi(robotPeopleRoute, (c) => c.json({ as_of: new Date().toISOString(), people: listRobotPeople() }, 200));

const RobotAssetsSchema = z.object({
  assets: z.array(z.object({
    id: z.string(), file: z.string(), sha256: z.string(), bytes: z.number(), licence: z.string(), kind: z.string(), available: z.boolean(),
  })),
});
const robotAssetsRoute = createRoute({
  method: "get",
  path: "/me/assets",
  tags: ["Devices"],
  summary: "The pinned asset manifest for this robot",
  middleware: [requireDeviceSession("robot")] as const,
  responses: {
    200: { content: { "application/json": { schema: RobotAssetsSchema } }, description: "Pinned assets the hub serves to robots." },
    ...errorResponses({ 401: "Not signed in", 403: "Not a robot device session" }),
  },
});
devicesRoutes.openapi(robotAssetsRoute, async (c) => {
  if (process.env.MAIPAI_TEST_ALLOW_MULTIPLE_HUBS !== "1" && process.env.NODE_ENV !== "test") void ensureRobotAssets();
  const deviceId = c.get("deviceId");
  const clipBundle = await robotClipAssetForDevice(deviceId);
  return c.json({
    assets: [...await Promise.all(ROBOT_ASSETS.map(async (asset) => ({
      id: asset.id, file: asset.file, sha256: asset.sha256, bytes: asset.bytes, licence: asset.licence, kind: asset.kind,
      available: await isRobotAssetAvailable(asset.id),
    }))), ...(clipBundle ? [clipBundle] : [])],
  }, 200);
});

const robotAssetBytesRoute = createRoute({
  method: "get",
  path: "/me/assets/{id}",
  tags: ["Devices"],
  summary: "Fetch one verified robot asset from the hub",
  middleware: [requireDeviceSession("robot")] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "Verified bytes; ETag is the pinned SHA-256." },
    ...errorResponses({ 401: "Not signed in", 403: "Not a robot device session", 404: "Unknown asset", 503: "Asset is not installed or failed integrity verification" }),
  },
});
devicesRoutes.openapi(robotAssetBytesRoute, async (c) => {
  const id = c.req.valid("param").id;
  if (id === "clip-bundle" || id.startsWith("clip:")) {
    const deviceId = c.get("deviceId");
    const bundle = await readRobotClipBundle(deviceId);
    if (id === "clip-bundle" && !bundle && robotClipBundleExists(deviceId)) {
      await readVerifiedRobotClipAsset(deviceId, id);
      return c.json({ error: "Robot clip manifest failed its integrity check" }, 503);
    }
    const knownClip = id === "clip-bundle" ? bundle !== null : bundle?.clips.some((clip) => id === `clip:${clip.id}`) === true;
    if (!knownClip) return c.json({ error: "Unknown robot asset" }, 404);
    const asset = await readVerifiedRobotClipAsset(deviceId, id);
    if (!asset) return c.json({ error: "Robot clip is not ready" }, 503);
    return new Response(asset.bytes, {
      status: 200,
      headers: { "Content-Type": asset.contentType, "Content-Length": String(asset.bytes.byteLength), ETag: `"${asset.sha256}"`, "Cache-Control": "private, max-age=31536000, immutable" },
    });
  }
  const asset = robotAssetById(id);
  if (!asset) return c.json({ error: "Unknown robot asset" }, 404);
  const bytes = await readVerifiedRobotAsset(asset);
  if (!bytes) return c.json({ error: "Robot asset is not ready" }, 503);
  return new Response(bytes, {
    status: 200,
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(asset.bytes), ETag: `"${asset.sha256}"`, "Cache-Control": "private, max-age=31536000, immutable" },
  });
});

const sendCommandRoute = createRoute({
  method: "post",
  path: "/{id}/commands",
  tags: ["Devices"],
  summary: "Ask a paired robot to mute or unmute its microphone",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id", "device-a1b2c3"),
    body: { content: { "application/json": { schema: z.object({ kind: z.enum(["mute", "unmute"]) }) } } },
  },
  responses: {
    202: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Persisted for delivery to the robot." },
    ...errorResponses({ 400: "Not a robot", 401: "Not signed in", 404: "No such device (or it is not yours to control)" }),
  },
});
devicesRoutes.openapi(sendCommandRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const device = getDeviceById(id);
  const { kind } = c.req.valid("json");
  // ROBOT-ADMIN-PLACE-01: a robot is the household's. Anyone but a child or guest may ask it to mute (the privacy-safe
  // direction); unmuting stays with the person who paired it and admins.
  const mayMuteAnyRobot = kind === "mute" && actor.role !== "child" && actor.role !== "guest";
  if (!device || (device.personId !== actor.id && actor.role !== "owner" && actor.role !== "admin" && !(mayMuteAnyRobot && device.kind === "robot"))) {
    return c.json({ error: "No such device" }, 404);
  }
  if (device.kind !== "robot") return c.json({ error: "Not a robot" }, 400);
  const command = issueDeviceCommand(device.id, kind, {});
  return c.json({ id: command.id }, 202);
});

// MOTOR-REBOOT-CARD: the robot offers to reboot a latched motor (state frame `motors_reboot_offer`); an adult answers
// on the Devices card. Only a yes sends `motor_reboot`, and it names the motors the hub stored, never the browser's.
const motorRebootRoute = createRoute({
  method: "post",
  path: "/{id}/motor-reboot",
  tags: ["Devices"],
  summary: "Answer a robot's offer to reboot a latched motor (adults only)",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id", "device-a1b2c3"),
    body: { content: { "application/json": { schema: z.object({ answer: z.enum(["yes", "no"]) }) } } },
  },
  responses: {
    202: { content: { "application/json": { schema: z.object({ id: z.string(), motors: z.array(z.string()) }) } }, description: "Yes: the reboot command is persisted for delivery to the robot." },
    204: { description: "No: nothing is sent and the offer is dismissed." },
    ...errorResponses({ 400: "Not a robot", 401: "Not signed in", 403: "Not an adult", 404: "No such device (or it is not yours to control)", 409: "No motor reboot is being offered" }),
  },
});
devicesRoutes.openapi(motorRebootRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const device = getDeviceById(id);
  if (!device || (device.personId !== actor.id && actor.role !== "owner" && actor.role !== "admin")) {
    return c.json({ error: "No such device" }, 404);
  }
  if (device.kind !== "robot") return c.json({ error: "Not a robot" }, 400);
  if (speakerAgeBand(actor, new Date()) !== "adult") {
    return c.json({ error: "Only an adult can restart a robot's motor. Ask an adult to answer this." }, 403);
  }
  const motors = getPendingMotorRebootOffer(device.id);
  if (motors.length === 0) return c.json({ error: "No motor is waiting for a restart. The robot will ask again if it needs to." }, 409);
  if (c.req.valid("json").answer === "no") {
    markMotorRebootAnswered(device.id, motors);
    return c.body(null, 204);
  }
  const command = issueDeviceCommand(device.id, "motor_reboot", { motors });
  markMotorRebootAnswered(device.id, motors);
  return c.json({ id: command.id, motors }, 202);
});

// LIVE-VIEW-01: the hub's own live view of a robot. Start and stop are for an admitted adult only
// (lib/liveView.ts decides); the robot posts JPEG frames, the hub re-serves them to the one viewer.
const startLiveViewRoute = createRoute({
  method: "post",
  path: "/{id}/live-view",
  tags: ["Devices"],
  summary: "Open a live view of a paired robot's camera (admins and named adults only)",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "device-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ view_id: z.string(), stream: z.string() }) } }, description: "The view is starting; open `stream` to watch." },
    ...errorResponses({ 400: "Not a robot", 401: "Not signed in", 403: "Live view is off or this person may not watch", 404: "No such device (or it is not yours to control)" }),
  },
});
devicesRoutes.openapi(startLiveViewRoute, (c) => {
  const started = startLiveView(c.get("person"), c.req.valid("param").id);
  if (!started.ok) return c.json({ error: started.error }, started.status);
  return c.json({ view_id: started.viewId, stream: `/api/devices/live-view/${started.viewId}` }, 200);
});

const watchLiveViewRoute = createRoute({
  method: "get",
  path: "/live-view/{viewId}",
  tags: ["Devices"],
  summary: "Watch a live view (multipart JPEG stream); closing the page stops the view",
  middleware: [requireAuth] as const,
  request: { params: z.object({ viewId: z.string() }) },
  responses: {
    200: { description: "A multipart/x-mixed-replace stream of JPEG frames." },
    ...errorResponses({ 401: "Not signed in", 403: "Live view is off or this person may not watch", 404: "No such view" }),
  },
});
devicesRoutes.openapi(watchLiveViewRoute, (c) => {
  const actor = c.get("person");
  const view = getLiveView(c.req.valid("param").viewId);
  if (!view || view.personId !== actor.id) return c.json({ error: "That live view is not open. Start it again from the robot's card." }, 404);
  const admitted = liveViewAdmits(actor);
  if (!admitted.ok) { stopLiveView(view.viewId); return c.json({ error: admitted.error }, admitted.status); }
  return new Response(liveViewStream(view), { status: 200, headers: { "Content-Type": LIVE_VIEW_CONTENT_TYPE, "Cache-Control": "no-store" } });
});

const stopLiveViewRoute = createRoute({
  method: "delete",
  path: "/live-view/{viewId}",
  tags: ["Devices"],
  summary: "Close a live view",
  middleware: [requireAuth] as const,
  request: { params: z.object({ viewId: z.string() }) },
  responses: {
    204: { description: "Closed." },
    ...errorResponses({ 401: "Not signed in", 404: "No such view" }),
  },
});
devicesRoutes.openapi(stopLiveViewRoute, (c) => {
  const view = getLiveView(c.req.valid("param").viewId);
  if (!view || view.personId !== c.get("person").id) return c.json({ error: "That live view is not open." }, 404);
  stopLiveView(view.viewId);
  return c.body(null, 204);
});

const streamFrameRoute = createRoute({
  method: "post",
  path: "/me/stream/{viewId}",
  tags: ["Devices"],
  summary: "The robot posts one JPEG frame of an open live view",
  middleware: [requireDeviceSession("robot")] as const,
  request: { params: z.object({ viewId: z.string() }) },
  responses: {
    204: { description: "Frame accepted." },
    ...errorResponses({ 400: "Not a JPEG, or too large", 401: "Not signed in", 403: "Not a robot device session", 404: "No open view for this robot" }),
  },
});
devicesRoutes.openapi(streamFrameRoute, async (c) => {
  const outcome = pushLiveFrame(c.get("deviceId"), c.req.valid("param").viewId, new Uint8Array(await c.req.arrayBuffer()));
  if (outcome === "unknown_view") return c.json({ error: "No live view is open for this robot. Stop streaming." }, 404);
  if (outcome === "bad_frame") return c.json({ error: "A live view frame must be a JPEG under 512 KB." }, 400);
  return c.body(null, 204);
});

// ROBOT-VISION-01: the robot's one camera picture for its short-lived scene description. The picture is described once by the local
// chat model and dropped; nothing is stored or returned (lib/robotVision.ts, docs/design/robot-vision-2026-10-21.md).
const visionFrameRoute = createRoute({
  method: "post",
  path: "/me/vision",
  tags: ["Devices"],
  summary: "The robot posts one JPEG camera picture for its scene description",
  middleware: [requireDeviceSession("robot")] as const,
  request: {
    query: z.object({
      purpose: z.enum(["scene", "ask"]).default("scene"),
      people: z.coerce.number().int().min(0).max(20).optional(),
      light: z.enum(["dark", "dim", "bright"]).optional(),
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.literal(true), expires_in_s: z.number() }) } }, description: "The picture was described and dropped; the description lasts about a minute." },
    ...errorResponses({ 400: "Not a picture", 401: "Not signed in", 403: "Robot vision is off for this robot", 413: "Too large", 415: "Not a JPEG", 429: "Too fast", 503: "The chat model is not reading pictures" }),
  },
});
devicesRoutes.openapi(visionFrameRoute, async (c) => {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > MAX_FRAME_BYTES) return c.json({ error: "A camera picture must be under 512 KB. Send a smaller one." }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const query = c.req.valid("query");
  const outcome = await acceptFrame({ deviceId: c.get("deviceId"), bytes, people: query.people ?? null, brightness: query.light ?? "unknown", purpose: query.purpose });
  if (!outcome.ok) return c.json({ error: outcome.error, code: outcome.code }, outcome.status);
  return c.json({ ok: true as const, expires_in_s: Math.round((outcome.scene.expiresAt - outcome.scene.at) / 1000) }, 200);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Devices"],
  summary: "Revoke a device - deletes it and every token pointing at it",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "device-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Revoked." },
    ...errorResponses({ 404: "No such device (or it isn't mine)" }),
  },
});
devicesRoutes.openapi(deleteRoute, async (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const current = getDeviceById(id);
  // ROBOT-ADMIN-PLACE-01: a robot belongs to the household, so any admin may forget it, not only the admin who paired it.
  const adminForgetsRobot = current?.kind === "robot" && (actor.role === "owner" || actor.role === "admin");
  if (!current || (current.personId !== actor.id && !adminForgetsRobot)) return c.json({ error: "No such device" }, 404);
  if (current.kind === "robot") await forgetRobotHost(id);
  if (!deleteDevice(id, current.personId)) return c.json({ error: "No such device" }, 404);
  forgetRobotSocketAddress(id);
  closeDeviceCommandChannel(id);
  return c.json({ success: true as const }, 200);
});

// ROBOT-DEVICE-01: "Add a robot" finds a unit on the LAN before an admin
// types anything (bot/docs/dev/design-reachy-mini-2026-09-27.md section
// 9). Admin-only, same tier as the other hardware-facing routes in
// routes/host.ts: discovering and pairing new hardware is a household
// admin action, not something every signed-in person can trigger.
const DiscoveredRobotSchema = z.object({
  name: z.string(),
  host: z.string(),
  port: z.number(),
  addresses: z.array(z.string()),
  model: z.string().nullable(),
  daemonVersion: z.string().nullable(),
  unitId: z.string().nullable(),
});

const discoverRoute = createRoute({
  method: "get",
  path: "/discover-robots",
  tags: ["Devices"],
  summary: "Browse the LAN for a Reachy Mini robot to pair",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: {
      content: { "application/json": { schema: z.array(DiscoveredRobotSchema) } },
      description: "Every robot that answered within the browse window. Empty if none did.",
    },
  },
});
devicesRoutes.openapi(discoverRoute, async (c) => {
  const robots = await discoverRobots();
  return c.json(robots, 200);
});

// ROBOT-DEVICE-01: "the add flow refuses to finish while the unit's
// published default SSH password stands and rotates it into the
// credentials center." A separate step from pairing itself (pairing
// mints the device token through Quick Connect's own /approve, unchanged)
// since this needs the admin to supply the vendor's own default password,
// which this hub never stores or guesses.
const rotatePasswordRoute = createRoute({
  method: "post",
  path: "/{id}/rotate-robot-password",
  tags: ["Devices"],
  summary: "Rotate a paired robot's SSH password off the vendor's published default",
  middleware: [requireRole("owner", "admin")] as const,
  request: {
    params: idParamSchema("id", "device-a1b2c3"),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            host: z.string().min(1).openapi({ description: "The robot's LAN address or mDNS host." }),
            port: z.number().int().positive().default(22),
            sshUsername: z.string().min(1).default("pollen"),
            currentPassword: z
              .string()
              .min(1)
              .optional()
              .openapi({ description: "The vendor's own published default - never stored. Optional once this device or another at the same host has a rotated password on file; that one is tried first." }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ success: z.literal(true), rotatedAt: z.string() }) } },
      description: "Rotated - the new password is stored encrypted, never returned.",
    },
    ...errorResponses({
      404: "No such device",
      400: "Not a robot, or the robot refused the connection or the password change",
    }),
  },
});
devicesRoutes.openapi(rotatePasswordRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { host, port, sshUsername, currentPassword } = c.req.valid("json");

  const device = getDeviceById(id);
  if (!device) return c.json({ error: "No such device" }, 404);
  if (device.kind !== "robot") return c.json({ error: "Not a robot" }, 400);

  // A code review (2026-09-27) found re-pairing a revoked-and-rediscovered
  // robot could never complete: its previously rotated password lived
  // only under the old, deleted device row, so a fresh pairing's own
  // rotation demanded a vendor default that no longer opened the unit.
  // Candidates are tried in order, stopping at the first that connects -
  // but a code review (2026-09-28) found the original ordering (stored
  // credentials first, admin-supplied last) sends live SSH auth attempts
  // with stale passwords ahead of one the admin explicitly typed, a real
  // lockout risk if the robot's own SSH daemon rate-limits or bans after
  // a few failures (a DHCP-reused host, a factory reset). Typing a
  // password is a deliberate signal - it goes first. Stored credentials
  // exist only to let "Rotate again" and a same-unit re-pair need no
  // typing at all, so they're the fallback, never a guess ahead of one.
  const candidates: string[] = [];
  if (currentPassword) candidates.push(currentPassword);
  const ownCredential = getRobotCredential(device.id);
  if (ownCredential && !candidates.includes(ownCredential.password)) candidates.push(ownCredential.password);
  const hostCredential = getMostRecentRobotCredentialForHost(host);
  if (hostCredential && !candidates.includes(hostCredential.password)) candidates.push(hostCredential.password);

  if (candidates.length === 0) {
    return c.json({ error: "The robot's current password is required the first time it's rotated." }, 400);
  }

  let newPassword: string | undefined;
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      ({ newPassword } = await rotateRobotPassword({ host, port, username: sshUsername, currentPassword: candidate }));
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (newPassword === undefined) {
    const message = lastError instanceof RobotPasswordRotationError ? lastError.message : "Could not connect or change the password";
    return c.json({ error: message }, 400);
  }

  try {
    storeRobotCredential(device.id, host, sshUsername, newPassword);
  } catch (err) {
    // The robot's password already changed at this point - only the write
    // to our own store failed. Never log the password itself; the admin
    // needs to know the vendor default no longer works, not what to type.
    console.error(`[devices] robot ${device.id} password rotated on-device but could not be stored:`, err);
    return c.json({ error: "The robot's password was changed, but it could not be saved. Reset the robot to its vendor default and try again." }, 400);
  }

  return c.json({ success: true as const, rotatedAt: new Date().toISOString() }, 200);
});

// Lets the pairing UI show "still using the vendor default" vs "rotated"
// without ever exposing the stored password itself.
const rotationStatusRoute = createRoute({
  method: "get",
  path: "/{id}/robot-password-status",
  tags: ["Devices"],
  summary: "Whether a paired robot's SSH password has been rotated off the vendor default",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: idParamSchema("id", "device-a1b2c3") },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ rotated: z.boolean() }) } },
      description: "true once rotate-robot-password has succeeded for this device.",
    },
    ...errorResponses({ 404: "No such device", 400: "Not a robot" }),
  },
});
devicesRoutes.openapi(rotationStatusRoute, (c) => {
  const { id } = c.req.valid("param");
  const device = getDeviceById(id);
  if (!device) return c.json({ error: "No such device" }, 404);
  if (device.kind !== "robot") return c.json({ error: "Not a robot" }, 400);
  return c.json({ rotated: hasRotatedRobotCredential(device.id) }, 200);
});

const offlineScopeRoute = createRoute({
  method: "patch", path: "/{id}/offline-scope", tags: ["Devices"], summary: "Set a device's default-deny offline permissions (owner or admin)",
  middleware: [requireAuth] as const,
  request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: z.object({ offline_scope: z.array(z.enum(["media.offline", "offline.records"])).max(2) }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Permission saved. New byte requests use it immediately." }, ...errorResponses({ 400: "A robot, TV or pod cannot keep media", 401: "Sign in", 403: "Use your own browser, and ask a grown-up if you are a child or teen", 404: "Device missing or owned by someone else" }) },
});
devicesRoutes.openapi(offlineScopeRoute, (c) => {
  const session = getCookie(c, "session");
  if (!session || !resolveHumanSession(session)) return c.json({ error: "A paired device cannot change offline permissions. Sign in on your own browser to change them." }, 403);
  const actor = c.get("person");
  const device = getDeviceById(c.req.valid("param").id);
  if (!device || (device.personId !== actor.id && actor.role !== "owner" && actor.role !== "admin")) return c.json({ error: "This device is not yours to change. Choose your own device or ask an admin." }, 404);
  // A child's or teen's keep permission is a guardian's to give: they cannot grant it to themselves.
  if (actor.role !== "owner" && actor.role !== "admin" && mediaBandOf(actor) !== "adult") return c.json({ error: "A grown-up sets this. Ask a grown-up to allow keeping media on this device." }, 403);
  const requested = c.req.valid("json").offline_scope;
  if (requested.length > 0 && !mayHoldMediaOffline(device)) return c.json({ error: "A shared device such as a robot, TV or pod cannot keep copies. Use a phone, computer or browser." }, 400);
  setDeviceOfflineScope(device.id, requested);
  return c.json({ success: true as const }, 200);
});
