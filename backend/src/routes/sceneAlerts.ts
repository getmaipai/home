import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { parseCurrentLocation, resolveWeatherPlace } from "@/lib/places";
import { weatherAlerts, weatherAlertsEnabled, isUsAlertCoordinate } from "@/lib/weatherAlerts";
import { weatherAlertDismissal, resume } from "@/lib/sceneSuppression";

export const sceneAlertsRoutes = apiRouter();
const alertSchema = z.object({ id: z.string(), event: z.string(), severity: z.string(), headline: z.string(), ends: z.string(), dismissed: z.enum(["none", "you", "household"]) });
const querySchema = z.object({ current_location: z.string().optional() });
const listRoute = createRoute({ method: "get", path: "/alerts", tags: ["Scene"], summary: "List the signed-in person's active weather alerts", middleware: [requireAuth] as const,
  request: { query: querySchema }, responses: { 200: { content: { "application/json": { schema: z.array(alertSchema) } }, description: "Active weather alerts without coordinates" }, ...errorResponses({ 401: "Not signed in" }) } });
sceneAlertsRoutes.openapi(listRoute, async (c) => {
  const person = c.get("person");
  let current = null;
  try { const raw = c.req.valid("query").current_location; current = raw ? parseCurrentLocation(JSON.parse(raw)) : null; } catch { current = null; }
  const place = await resolveWeatherPlace({ person, current, preferCurrent: !!current, band: person.role === "child" ? "child" : person.role === "teen" || person.role === "guest" ? "teen" : "adult" }).catch(() => null);
  if (!weatherAlertsEnabled() || !place || typeof place.hostInputs.latitude !== "number" || typeof place.hostInputs.longitude !== "number" || !isUsAlertCoordinate(place.hostInputs.latitude, place.hostInputs.longitude)) return c.json([], 200);
  const now = Date.now();
  const alerts = await weatherAlerts(place.hostInputs.latitude, place.hostInputs.longitude);
  return c.json(alerts.flatMap((alert) => {
    const ends = alert.ends && Number.isFinite(Date.parse(alert.ends)) ? new Date(alert.ends).toISOString() : "";
    if (!alert.id || !alert.event || !ends || Date.parse(ends) <= now) return [];
    const dismissed = weatherAlertDismissal(alert.id, person.id, now);
    if (dismissed !== "none") return [];
    return [{ id: alert.id, event: alert.event, severity: alert.severity.toLowerCase(), headline: alert.headline, ends, dismissed }];
  }), 200);
});

const resumeRoute = createRoute({ method: "post", path: "/alerts/{id}/resume", tags: ["Scene"], summary: "Resume an alert dismissed by the signed-in person", middleware: [requireAuth] as const,
  request: { params: z.object({ id: z.string().min(1).max(500) }) }, responses: { 200: { content: { "application/json": { schema: z.object({ resumed: z.boolean() }) } }, description: "Whether a matching hold was cleared" }, ...errorResponses({ 401: "Not signed in" }) } });
sceneAlertsRoutes.openapi(resumeRoute, (c) => {
  const person = c.get("person");
  const cleared = resume({ kind: "weather_alert", refId: c.req.valid("param").id, byPersonId: person.id, personId: person.id, byConfirmedAdult: ["owner", "admin", "adult"].includes(person.role) });
  return c.json({ resumed: cleared > 0 }, 200);
});
