import { createRoute, z } from "@hono/zod-openapi";
import { db } from "@/db";
import { statusEvents } from "@/db/schema";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listStatusApps } from "@/lib/appNeeds";
import { appResponseWithLiveRoleHealth, componentForNeed } from "@/lib/statusApps";
import { serviceDiagnostics } from "@/lib/serviceHealth";
import { getHouseholdSettingValue } from "@/lib/settings";
import { getEngineLink } from "@/lib/stack/link";
import type { StatusAppsWire } from "../wire";

export const statusAppsRoutes = apiRouter();
const EngineComputerResponse = z.object({
  configured: z.boolean(),
  state: z.enum(["working", "connecting", "slow_to_answer", "reconnecting", "not_reachable"]),
  reason: z.string().nullable(),
  details: z.object({ path: z.enum(["home", "tailnet"]).nullable(), lastProbeAt: z.string().nullable(), contract: z.string().nullable() }).optional(),
});
type EngineComputerPublicState = z.infer<typeof EngineComputerResponse>["state"];
const reasonWords: Record<string, string> = {
  link_refused: "The engine computer refused the connection.", link_timeout: "The engine computer did not answer in time.",
  link_dns: "The engine computer could not be found on the network.", link_auth_refused: "The secure connection was refused.",
  link_host_key_changed: "The engine computer's identity changed. Pair it again.", link_needs_update: "The engine computer needs an update.",
  link_not_paired: "The engine computer is not paired yet.", link_outside_home: "The engine computer is outside your home network.",
  link_stack_down: "The engine service is not running.",
};
const engineComputerRoute = createRoute({ method: "get", path: "/engine-computer", tags: ["Status"], summary: "Read the engine computer connection status",
  middleware: [requireAuth] as const, responses: { 200: { content: { "application/json": { schema: EngineComputerResponse } }, description: "Plain-language link status; connection details are admin-only." }, ...errorResponses({ 401: "Not signed in" }) } });
statusAppsRoutes.openapi(engineComputerRoute, (c) => {
  const configured = getHouseholdSettingValue("engines.stack.where") === "another_computer";
  const link = configured ? getEngineLink() : null;
  const snapshot = link?.snapshot();
  const state = snapshot?.state ?? "offline";
  const label: EngineComputerPublicState = state === "ready" ? "working" : state === "connecting" ? "connecting" : state === "degraded" ? "slow_to_answer" : state === "reconnecting" ? "reconnecting" : "not_reachable";
  const reason = snapshot?.reason ? reasonWords[snapshot.reason] ?? "The engine computer connection needs attention." : configured && !link ? reasonWords.link_not_paired! : null;
  const person = c.get("person");
  const admin = person.role === "owner" || person.role === "admin";
  const details = link?.statusDetails();
  return c.json({ configured, state: label, reason, ...(admin && configured ? { details: {
    path: details?.path ?? null, lastProbeAt: details?.lastProbeAt ?? null, contract: details?.contract ?? null,
  } } : {}) }, 200);
});
const NeedSchema = z.object({ kind: z.enum(["engine", "service", "internet"]), id: z.string(), name: z.string(), purpose: z.string(), required: z.boolean(), state: z.enum(["operational", "degraded", "down", "waiting", "unknown"]), last_success_at: z.string().nullable().optional(), last_error_class: z.string().nullable().optional(), success_count: z.number().optional(), failure_count: z.number().optional() });
const AppDayMinutesSchema = z.object({ operational: z.number(), degraded: z.number(), outage: z.number(), maintenance: z.number() });
const AppSchema = z.object({ id: z.string(), name: z.string(), state: z.enum(["operational", "degraded", "down", "waiting_for_internet"]), reason: z.string().nullable(), paused: z.boolean().optional(), needs: z.array(NeedSchema).optional(), history: z.array(z.object({ date: z.string(), state: z.enum(["operational", "degraded", "down", "waiting_for_internet"]), uptime: z.number(), minutes: AppDayMinutesSchema })).length(90), uptimePercent: z.number() });
const ResponseSchema = z.array(AppSchema) satisfies z.ZodType<StatusAppsWire>;

export const appsRoute = createRoute({ method: "get", path: "/apps", tags: ["Status"], summary: "Read app health derived from declared needs",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: ResponseSchema } }, description: "App health and ninety daily uptime buckets with minutes by state. Needs are visible to owners and admins." }, ...errorResponses({ 401: "Not signed in" }) } });

export type StatusAppsRoute = typeof appsRoute;

statusAppsRoutes.openapi(appsRoute, async (c) => {
  const person = c.get("person");
  const showNeeds = person.role === "owner" || person.role === "admin";
  const events = db.select({ component: statusEvents.component, state: statusEvents.state, at: statusEvents.at }).from(statusEvents).all();
  const apps = await Promise.all(listStatusApps().map(async (app) => {
    const result = await appResponseWithLiveRoleHealth(app, events, showNeeds);
    if (showNeeds && result.needs) result.needs = result.needs.map((need) => need.kind === "service" ? { ...need, ...serviceDiagnostics(componentForNeed(need)) } : need);
    return result;
  }));
  return c.json(apps, 200);
});
