import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { evaluateSafety } from "@/lib/safety";
import { speakerAgeBand } from "@/lib/ageBand";
import type { AppEnv } from "@/types";
import { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import { applyAlarmAction, listActiveSafetyAlarms, safetySensorMappings, type SafetyAlarmAction } from "@/lib/safetyAlarm";
import { listHomeAssistantSensorCandidates } from "@/lib/integrations/homeAssistant";
import { refreshSafetyAlarmSensors } from "@/lib/safetyAlarm";
import { setHouseholdSettingValue } from "@/lib/settings";

export const safetyRoutes = apiRouter();

const checkRoute = createRoute({
  method: "post",
  path: "/check",
  tags: ["Safety"],
  summary: "Check a person's own text against the safety layer",
  description: "Checks the signed-in person's own text in their own speaker context. No turn engine needed: this is a direct safety check surface.",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            text: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: SafetyResult } },
      description: "The safety layer's verdict on the submitted text.",
    },
    ...errorResponses({ 400: "text is required" }),
  },
});

// No turn engine exists yet to call the safety layer on a real
// conversation turn (4.5 is later in the roadmap, see docs/dev.md), so
// this route is today's real caller: it checks the signed-in person's own
// text in their own speaker context. The turn engine will call
// evaluateSafety() directly once it exists; this route stays useful after
// that too (a dev/diagnostics surface, 4.13).
safetyRoutes.openapi(checkRoute, async (c) => {
  const person = c.get("person");
  const body = c.req.valid("json") as { text?: string };
  if (!body.text || typeof body.text !== "string") {
    return c.json({ error: "text is required" }, 400);
  }
  const result = evaluateSafety(body.text, speakerAgeBand(person, new Date()));
  return c.json(result, 200);
});

const activeAlarmsRoute = createRoute({
  method: "get", path: "/alarms", tags: ["Safety"],
  summary: "List active household safety alarms", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.array(z.object({ id: z.string(), sensorId: z.string(), area: z.string().nullable(), kind: z.string(), state: z.string(), startedAt: z.string() })) } }, description: "Current active safety alarms." }, ...errorResponses({ 401: "Not signed in" }) },
});
safetyRoutes.openapi(activeAlarmsRoute, (c) => c.json(listActiveSafetyAlarms(), 200));

const alarmActionRoute = createRoute({
  method: "post", path: "/alarms/{id}/actions", tags: ["Safety"],
  summary: "Acknowledge, quiet here, or mark an active safety alarm false", middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "alarm-123"), body: { content: { "application/json": { schema: z.object({ action: z.enum(["acknowledge", "quiet_here", "false_alarm"]) }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ state: z.string() }) } }, description: "Alarm action applied." }, ...errorResponses({ 400: "Action is invalid in this context", 401: "Not signed in", 403: "Only an adult may act; only an admin may mark a false alarm", 404: "No active alarm" }) },
});
safetyRoutes.openapi(alarmActionRoute, (c) => {
  const result = applyAlarmAction(c.get("person").id, c.req.valid("param").id, c.req.valid("json").action as SafetyAlarmAction);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ state: result.state }, 200);
});

const alarmSensorsRoute = createRoute({
  method: "get", path: "/alarm-sensors", tags: ["Safety"],
  summary: "List Home Assistant sensors available for safety alarm mapping",
  middleware: [requireAuth, requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ candidates: z.array(z.object({ entityId: z.string(), name: z.string(), deviceClass: z.string().nullable(), area: z.string().nullable(), suggestedKind: z.enum(["smoke", "carbon_monoxide", "gas", "water_leak", "alarm_panel"]) })), mappings: z.array(z.object({ entityId: z.string(), area: z.string().nullable(), kind: z.enum(["smoke", "carbon_monoxide", "gas", "water_leak", "alarm_panel"]) })) }) } }, description: "Candidate Home Assistant sensors and current mappings." }, ...errorResponses({ 401: "Not signed in", 403: "Owner or admin only", 502: "Home Assistant could not be reached" }) },
});
safetyRoutes.openapi(alarmSensorsRoute, async (c) => {
  try { return c.json({ candidates: await listHomeAssistantSensorCandidates(), mappings: safetySensorMappings() }, 200); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Home Assistant could not be reached" }, 502); }
});

const saveAlarmSensorsRoute = createRoute({
  method: "put", path: "/alarm-sensors", tags: ["Safety"],
  summary: "Save the household's Home Assistant safety sensor mappings",
  middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: z.object({ mappings: z.array(z.object({ entityId: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/), area: z.string().max(80).nullable(), kind: z.enum(["smoke", "carbon_monoxide", "gas", "water_leak", "alarm_panel"]) })).max(50) }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ mappings: z.array(z.object({ entityId: z.string(), area: z.string().nullable(), kind: z.enum(["smoke", "carbon_monoxide", "gas", "water_leak", "alarm_panel"]) })) }) } }, description: "Saved mappings." }, ...errorResponses({ 400: "Mapping is invalid or contains a duplicate entity", 401: "Not signed in", 403: "Owner or admin only", 502: "Home Assistant could not be reached" }) },
});
safetyRoutes.openapi(saveAlarmSensorsRoute, async (c) => {
  const { mappings } = c.req.valid("json");
  if (new Set(mappings.map((mapping) => mapping.entityId)).size !== mappings.length) return c.json({ error: "Each safety sensor can be mapped only once" }, 400);
  let candidates;
  try { candidates = await listHomeAssistantSensorCandidates(); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Home Assistant could not be reached" }, 502); }
  const candidateIds = new Set(candidates.map((candidate) => candidate.entityId));
  if (mappings.some((mapping) => !candidateIds.has(mapping.entityId))) return c.json({ error: "Every mapped entity must be an available Home Assistant binary sensor" }, 400);
  const normalized = mappings.map((mapping) => ({ ...mapping, area: mapping.area?.trim() || null }));
  const result = setHouseholdSettingValue("safety.alarm.sensors", JSON.stringify(normalized));
  if (!result.ok) return c.json({ error: result.error }, 400);
  refreshSafetyAlarmSensors();
  return c.json({ mappings: normalized }, 200);
});
