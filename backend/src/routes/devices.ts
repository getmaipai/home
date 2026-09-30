// Session F, step 6: the household's own device inventory (wave-2's F-
// to-E contract: "GET /api/devices, DELETE /api/devices/:id"). Scoped to
// the signed-in person's own paired devices, same personal-Profile-page
// scope BACKLOG.md's "Sessions per device under Profile with revoke"
// describes - not a household-wide admin view (that's a later, undecided
// feature; nothing in this wave's contract asks for one).
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth, requireRole, requireDeviceSession } from "@/middleware/auth";
import { listDevicesForPerson, listDevicesByKind, deleteDevice, getDeviceById } from "@/lib/devices";
import { getDeviceState, resolveRequestDevice, upsertDeviceState } from "@/lib/deviceStates";
import { RobotState } from "@maipai/spec/gen/ts/robot-state.js";
import { discoverRobots } from "@/lib/robotDiscovery";
import { rotateRobotPassword, RobotPasswordRotationError } from "@/lib/robotSsh";
import { storeRobotCredential, hasRotatedRobotCredential, getRobotCredential, getMostRecentRobotCredentialForHost } from "@/lib/robotCredentials";

export const devicesRoutes = apiRouter();

const DeviceSchema = z.object({
  id: z.string(),
  kind: z.enum(["robot", "pod", "tv", "phone", "desktop", "browser"]),
  name: z.string(),
  area: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  // A code review (2026-09-28): stored on pairing (createDevice) but never
  // surfaced before now - ROBOT-CARD-01 (not yet built) is what actually
  // renders it; carried here so that page has something to read once it
  // exists.
  capabilities: z.array(z.string()),
  state: z.object({
    activity: z.enum(["starting", "idle", "listening", "thinking", "speaking"]),
    muted: z.boolean(),
    tracking: z.boolean(),
    on_battery: z.boolean().nullable(),
    battery_level: z.number().nullable(),
    daemon_version: z.string().nullable(),
    app_version: z.string().nullable(),
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
  responses: {
    200: { content: { "application/json": { schema: z.array(DeviceSchema) } }, description: "Every device with a live or once-live token paired to me." },
  },
});
devicesRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  const devices = listDevicesForPerson(actor.id);
  return c.json(
    devices.map((d) => ({ id: d.id, kind: d.kind, name: d.name, area: d.area, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt, capabilities: d.capabilities, state: d.kind === "robot" ? getDeviceState(d.id) : null })),
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
  summary: "Every paired robot, household-wide",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(DeviceSchema) } }, description: "Every device of kind \"robot\", regardless of who paired it." },
  },
});
devicesRoutes.openapi(listRobotsRoute, (c) => {
  const robots = listDevicesByKind("robot");
  return c.json(
    robots.map((d) => ({ id: d.id, kind: d.kind, name: d.name, area: d.area, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt, capabilities: d.capabilities, state: getDeviceState(d.id) })),
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
  upsertDeviceState(device.id, c.req.valid("json"));
  return c.body(null, 204);
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
devicesRoutes.openapi(deleteRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  if (!deleteDevice(id, actor.id)) return c.json({ error: "No such device" }, 404);
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
