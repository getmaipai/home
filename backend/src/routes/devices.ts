// Session F, step 6: the household's own device inventory (wave-2's F-
// to-E contract: "GET /api/devices, DELETE /api/devices/:id"). Scoped to
// the signed-in person's own paired devices, same personal-Profile-page
// scope BACKLOG.md's "Sessions per device under Profile with revoke"
// describes - not a household-wide admin view (that's a later, undecided
// feature; nothing in this wave's contract asks for one).
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { listDevicesForPerson, listDevicesByKind, deleteDevice, getDeviceById } from "@/lib/devices";
import { discoverRobots } from "@/lib/robotDiscovery";
import { rotateRobotPassword, RobotPasswordRotationError } from "@/lib/robotSsh";
import { storeRobotCredential, hasRotatedRobotCredential } from "@/lib/robotCredentials";

export const devicesRoutes = apiRouter();

const DeviceSchema = z.object({
  id: z.string(),
  kind: z.enum(["robot", "pod", "tv", "phone", "desktop", "browser"]),
  name: z.string(),
  area: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
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
    devices.map((d) => ({ id: d.id, kind: d.kind, name: d.name, area: d.area, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt })),
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
    robots.map((d) => ({ id: d.id, kind: d.kind, name: d.name, area: d.area, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt })),
    200,
  );
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
            currentPassword: z.string().min(1).openapi({ description: "The vendor's own published default - never stored." }),
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

  let newPassword: string;
  try {
    ({ newPassword } = await rotateRobotPassword({ host, port, username: sshUsername, currentPassword }));
  } catch (err) {
    const message = err instanceof RobotPasswordRotationError ? err.message : "Could not connect or change the password";
    return c.json({ error: message }, 400);
  }

  try {
    storeRobotCredential(device.id, sshUsername, newPassword);
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
