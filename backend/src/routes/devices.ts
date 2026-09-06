// Session F, step 6: the household's own device inventory (wave-2's F-
// to-E contract: "GET /api/devices, DELETE /api/devices/:id"). Scoped to
// the signed-in person's own paired devices, same personal-Profile-page
// scope BACKLOG.md's "Sessions per device under Profile with revoke"
// describes - not a household-wide admin view (that's a later, undecided
// feature; nothing in this wave's contract asks for one).
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listDevicesForPerson, deleteDevice } from "@/lib/devices";

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
