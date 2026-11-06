import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { effectivePermissions } from "@/lib/permissions";
import { getHouseholdSettingValue } from "@/lib/settings";
import { recordToolAudit } from "@/lib/toolAudit";
import { recordUndo, type UndoInverse } from "@/lib/toolUndo";
import { HOUSE_TOOL_ID } from "@/lib/house/ids";
import { houseLanFetch } from "@/lib/house/connection";
import { loadHouseRegistry } from "@/lib/house/cache";
import { houseAccess, type HouseActor, type HouseBand, type EffectivePermission } from "@/lib/house/access";
import { performHouseAction, houseServiceCall, supportedActions, type HouseActionInput, type HouseActionName, type HouseActionResult } from "@/lib/house/act";
import { visibleHouseEntities } from "@/lib/house/tool";
import type { HouseEntity } from "@/lib/house/registry";
import type { PersonRow } from "@/types";

export type HouseRoomsDeps = {
  loadRegistry: typeof loadHouseRegistry;
  connection: typeof houseLanFetch;
  permissionsOf: (id: string) => EffectivePermission[];
  perform: (entity: HouseEntity, action: HouseActionInput) => Promise<HouseActionResult>;
  audit: typeof recordToolAudit;
  undo: typeof recordUndo;
  mode: () => unknown;
};
const defaults: HouseRoomsDeps = {
  loadRegistry: loadHouseRegistry, connection: houseLanFetch, permissionsOf: effectivePermissions,
  perform: async (entity, action) => { const connection = houseLanFetch(); return connection.ok ? performHouseAction({ lanFetch: connection.lanFetch, token: connection.token, entity, action }) : { ok: false, kind: "unreachable" }; },
  audit: recordToolAudit, undo: recordUndo, mode: () => getHouseholdSettingValue("tools.house.mode"),
};
let overrides: Partial<HouseRoomsDeps> = {};
export function __setHouseRoomsDepsForTests(deps: Partial<HouseRoomsDeps> = {}): void { overrides = deps; }
function deps(): HouseRoomsDeps { return { ...defaults, ...overrides }; }
function bandOf(person: PersonRow): HouseBand { return person.role === "child" ? "child" : person.role === "teen" ? "teen" : "adult"; }
function actorOf(person: PersonRow): HouseActor { return { id: person.id, role: person.role as HouseActor["role"], band: bandOf(person) }; }
function inaccessible(actor: HouseActor): boolean { return !actor.id || actor.role === "guest" || actor.role === "unknown"; }
function stateFlags(entity: HouseEntity) {
  const state = entity.state.toLowerCase();
  const onState = entity.kind === "cover" ? state === "open" : entity.kind === "lock" ? state === "unlocked" : state === "on";
  return { on: onState, locked: entity.kind === "lock" ? state === "locked" : undefined, unavailable: state === "unavailable" || state === "unknown" };
}
const roomsRoute = createRoute({
  method: "get", path: "/rooms", tags: ["House"], summary: "Rooms and visible home entities",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ rooms: z.array(z.object({ id: z.string(), name: z.string(), entities: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string(), on: z.boolean(), brightness: z.number().nullable(), swatch: z.string().nullable(), locked: z.boolean().optional(), unavailable: z.boolean(), sensitive: z.boolean(), canControl: z.boolean() })) })), status: z.enum(["not_configured", "unreachable"]).optional() }) } }, description: "Visible rooms and entities." },
    ...errorResponses({ 401: "Sign in to view rooms", 403: "This speaker cannot view rooms" }),
  },
});
export const houseRoutes = apiRouter();
houseRoutes.openapi(roomsRoute, async (c) => {
  const d = deps(); const person = c.get("person"); const actor = actorOf(person);
  if (inaccessible(actor)) return c.json({ error: "Rooms are unavailable for this speaker. Sign in as a household member." }, 403);
  const connection = d.connection();
  if (!connection.ok && connection.reason === "not_set") return c.json({ rooms: [], status: "not_configured" }, 200);
  const registry = await d.loadRegistry();
  if (!registry.ok) return c.json({ rooms: [], status: "unreachable" }, 200);
  const permissions = d.permissionsOf(person.id);
  const visible = visibleHouseEntities({ actor, permissions, entities: registry.entities });
  type RoomEntity = { id: string; name: string; kind: string; on: boolean; brightness: number | null; swatch: string | null; locked?: boolean; unavailable: boolean; sensitive: boolean; canControl: boolean };
  const roomMap = new Map<string, { id: string; name: string; entities: RoomEntity[] }>();
  for (const area of registry.areas) roomMap.set(area.id, { id: area.id, name: area.name, entities: [] });
  for (const entity of visible) {
    const access = houseAccess({ actor, permissions, entity, level: "control" });
    const key = entity.area ?? "other";
    if (!roomMap.has(key)) roomMap.set(key, { id: key, name: "Other", entities: [] });
    const flags = stateFlags(entity);
    roomMap.get(key)!.entities.push({ id: entity.id, name: entity.name, kind: entity.kind, ...flags, brightness: entity.brightness, swatch: entity.rgb ? `rgb(${entity.rgb[0]}, ${entity.rgb[1]}, ${entity.rgb[2]})` : null, sensitive: !!entity.sensitive, canControl: access.allowed && !flags.unavailable });
  }
  return c.json({ rooms: [...roomMap.values()].filter((room) => room.entities.length) }, 200);
});

const allowedActions = ["turn_on", "turn_off", "set_brightness", "activate", "lock", "unlock", "open", "close"] as const;
const actRoute = createRoute({
  method: "post", path: "/act", tags: ["House"], summary: "Control one visible home entity",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ entity: z.string().min(1), action: z.enum(allowedActions), value: z.number().finite().optional() }).strict() } } } },
  responses: {
    200: { content: { "application/json": { schema: z.union([z.object({ ok: z.literal(true), state: z.string(), undoId: z.string().optional() }), z.object({ ok: z.literal(false), kind: z.enum(["refused", "unreachable", "timeout", "not_confirmed"]) })]) } }, description: "Action result." },
    ...errorResponses({ 400: "Invalid action request", 401: "Sign in to control home entities", 403: "This person cannot control this entity" }),
  },
});
houseRoutes.openapi(actRoute, async (c) => {
  const d = deps(); const person = c.get("person"); const actor = actorOf(person); const input = c.req.valid("json");
  if (inaccessible(actor)) return c.json({ error: "Home controls are unavailable for this speaker. Sign in as a household member." }, 403);
  if (d.mode() === "never") { d.audit({ personId: person.id, tool: HOUSE_TOOL_ID, action: input.action, decision: "never", band: actor.band }); return c.json({ error: "Home controls are turned off for this household. Change the House control setting to continue." }, 403); }
  const registry = await d.loadRegistry();
  if (!registry.ok) { const kind = registry.kind === "timeout" ? "timeout" as const : registry.kind === "refused" ? "refused" as const : "unreachable" as const; d.audit({ personId: person.id, tool: HOUSE_TOOL_ID, action: input.action, decision: "never", band: actor.band }); return c.json({ ok: false as const, kind }, 200); }
  const entity = registry.entities.find((item) => item.id === input.entity);
  const permissions = d.permissionsOf(person.id);
  if (!entity || !visibleHouseEntities({ actor, permissions, entities: [entity] }).length) { d.audit({ personId: person.id, tool: HOUSE_TOOL_ID, action: input.action, decision: "never", band: actor.band }); return c.json({ error: "That entity is not visible to you. Ask a household adult to grant access." }, 403); }
  const control = houseAccess({ actor, permissions, entity, level: "control" });
  const confirm = houseAccess({ actor, permissions, entity, level: "confirm" });
  if (!control.allowed || (entity.sensitive && !confirm.allowed)) { d.audit({ personId: person.id, tool: HOUSE_TOOL_ID, action: input.action, decision: "never", band: actor.band }); return c.json({ error: "You do not have permission to control this entity. Ask a household adult to update your access." }, 403); }
  if (actor.band !== "adult" && entity.sensitive) { d.audit({ personId: person.id, tool: HOUSE_TOOL_ID, action: input.action, decision: "never", band: actor.band }); return c.json({ error: "This sensitive device is not available for a child or teen. Ask an adult to control it." }, 403); }
  const action = { name: input.action as HouseActionName, ...(input.value !== undefined ? { value: input.value } : {}) };
  if (!supportedActions(entity).includes(action.name)) { d.audit({ personId: person.id, tool: HOUSE_TOOL_ID, action: input.action, decision: "never", band: actor.band }); return c.json({ ok: false as const, kind: "refused" as const }, 200); }
  const result = await d.perform(entity, action);
  d.audit({ personId: person.id, tool: HOUSE_TOOL_ID, action: input.action, decision: result.ok ? "do" : "never", band: actor.band });
  if (!result.ok) return c.json({ ok: false as const, kind: result.kind }, 200);
  const inverse = result.undo && (!entity.sensitive || result.undo.name === "lock" || result.undo.name === "close") ? [houseServiceCall(entity, result.undo)] : [];
  const receipt = inverse.length ? d.undo({ personId: person.id, tool: HOUSE_TOOL_ID, action: input.action, inverse: { kind: "house_restore", calls: inverse } as UndoInverse }) : undefined;
  return c.json({ ok: true as const, state: result.after.state, ...(receipt ? { undoId: receipt.id } : {}) }, 200);
});
