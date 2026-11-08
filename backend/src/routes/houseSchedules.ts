// HOUSE-04 / SCHED-02 app side: the signed-in adult's own device schedules (what, when, status) and Cancel.
// Own rows only. The owner and admins also get a count of other people's live schedules, never names or devices (rule 6a).
// Teens and children are refused for now (the HOUSE-04 schedule verdict), as is anyone who is not a known household adult.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { houseLanFetch } from "@/lib/house/connection";
import { fetchHouseRegistry, type HouseEntity } from "@/lib/house/registry";
import { describeSchedule, plainName } from "@/lib/house/scheduleTool";
import { scheduleActor } from "@/lib/schedules/guard";
import { adminScheduleCount, cancelSchedule, defaultZone, listOwnSchedules, type PublicSchedule, type ScheduleDeps } from "@/lib/schedules/store";
import { isOwnerOrAdminRole } from "@/wire";

export type HouseSchedulesDeps = { schedule?: ScheduleDeps; entities: () => Promise<HouseEntity[]> };
const defaults: HouseSchedulesDeps = {
  entities: async () => {
    const connection = houseLanFetch();
    if (!connection.ok) return [];
    const result = await fetchHouseRegistry({ lanFetch: connection.lanFetch, token: connection.token });
    return result.ok ? result.entities : [];
  },
};
let overrides: Partial<HouseSchedulesDeps> = {};
export function __setHouseSchedulesDepsForTests(deps: Partial<HouseSchedulesDeps> = {}): void { overrides = deps; }
const deps = (): HouseSchedulesDeps => ({ ...defaults, ...overrides });

const keyOf = (entity: Pick<HouseEntity, "id"> & { instance?: string }): string => `${entity.instance ?? "default"}/${entity.id}`;
const isLive = (row: PublicSchedule): boolean => row.state === "active" || row.state === "paused";
const REFUSED = { error: "Device schedules are for adults signed in on their own profile. Ask an adult in your household to set or change one." };

const ScheduleView = z.object({ id: z.string(), what: z.string(), when: z.string(), state: z.enum(["active", "paused"]), note: z.string().nullable() });
const listRoute = createRoute({
  method: "get", path: "/", tags: ["House"], summary: "My scheduled device actions", middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ schedules: z.array(ScheduleView), others: z.number().nullable() }) } }, description: "Own live schedules; others is a count for the owner and admins, otherwise null." },
    ...errorResponses({ 401: "Sign in to see your schedules", 403: "Adults only" }),
  },
});
const cancelRoute = createRoute({
  method: "delete", path: "/{id}", tags: ["House"], summary: "Cancel one of my scheduled device actions", middleware: [requireAuth] as const,
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } }, description: "Cancelled." },
    ...errorResponses({ 401: "Sign in to cancel a schedule", 403: "Adults only", 404: "No such schedule of yours" }),
  },
});

export const houseSchedulesRoutes = apiRouter();

houseSchedulesRoutes.openapi(listRoute, async (c) => {
  const person = c.get("person");
  if (!scheduleActor({ id: person.id, role: person.role })) return c.json(REFUSED, 403);
  const d = deps();
  const own = listOwnSchedules(person.id).filter(isLive);
  const names = new Map((await d.entities()).map((entity) => [keyOf(entity), plainName(entity)]));
  const zone = d.schedule?.zoneOf?.(person.id) ?? defaultZone(person.id);
  const schedules = own.map((row) => ({ id: row.id, state: row.state as "active" | "paused", ...describeSchedule(row, names, zone) }));
  const all = adminScheduleCount();
  const others = isOwnerOrAdminRole(person.role) ? Math.max(0, all.active + all.paused - own.length) : null;
  return c.json({ schedules, others }, 200);
});

houseSchedulesRoutes.openapi(cancelRoute, async (c) => {
  const person = c.get("person");
  if (!scheduleActor({ id: person.id, role: person.role })) return c.json(REFUSED, 403);
  const result = await cancelSchedule(person.id, c.req.valid("param").id, deps().schedule);
  return result.ok ? c.json({ ok: true as const }, 200) : c.json({ error: "That schedule is not there any more. Refresh the list and try again." }, 404);
});
