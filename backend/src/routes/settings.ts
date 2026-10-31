import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { listPlayableVoices, isPlayableVoiceId } from "@/lib/voiceList";
import { requireAuth, requireRole } from "@/middleware/auth";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";
import { getHouseholdSettingValue, listValues, setValue, resetValue, parseScope, assertCanAccessScope } from "@/lib/settings";
import { getRegistry } from "@/lib/settingsRegistry";
import { ensureCodingPiecesFresh } from "@/lib/stackCodingPieces";
import { isCodingStackKey, pushCodingSettings } from "@/lib/stackCodingSync";
import { issueApiToken, revokeApiToken, listApiKeys, listApiKeysForAdmin, createApiKey, renameApiKey, revokeApiKey, codeAdmission, CreateApiKeyInput } from "@/lib/apiKeys";
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { closeRobotDeviceCommandChannels, listRobotsPairedUnderPerson, publishSettingsChanged } from "@/lib/deviceCommands";
import { listDevicesByKind } from "@/lib/devices";
import { renderClipBundle } from "@/lib/robotClips";
import { personaWriteRefusal } from "@/lib/companionsApp";
import { ROBOT_COMPANION_KEY, ROBOT_CONTROLS_KEY, robotAssignmentRefusal } from "@/lib/robotCompanion";
import { refreshHomeAssistantEvents } from "@/lib/integrations/homeAssistant";
import { refreshSafetyAlarmSensors } from "@/lib/safetyAlarm";
import { validateWebSources } from "@/lib/retrieval/webSources";
import { validateCustomHosts } from "@/lib/blocklists/customHosts";
import { checkSearchInstance } from "@/lib/searchInstanceCheck";
import { applyEngineWhere, validateRemoteEngineSetting, ENGINE_WHERE_KEY, refreshConfiguredEngineLink } from "@/lib/remoteStackSettings";
import { canBindHubPort, configuredHubPort, configuredLanExposure, HUB_PORT_IN_USE_MESSAGE, HUB_PORT_SETTING } from "@/lib/networkSettings";
import { packagesLosingCapability, reconcileCapabilities, removalConfirmation } from "@/lib/capabilityReconcile";
import { detectLanIps } from "@/lib/hubEndpoints";
import { scheduleHubRestart } from "@/lib/hubRestart";
import { turnOnTailscaleAccess, setTailscaleRenewalActive } from "@/lib/tailscale";
import { closeRobotSttSockets } from "@/routes/stt";
import { startRobotHosts, stopRobotHosts } from "@/lib/robotHost";
import { getStackClient } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import { raiseIssue, resolveIssue } from "@/lib/issues";

export const settingsRoutes = apiRouter();

function refreshRobotClips(deviceIds: string[]): void {
  for (const deviceId of deviceIds) {
    void renderClipBundle(deviceId).catch(() => {
      console.error("[robot-clips] settings render failed; check Repairs to retry the bundle");
    });
  }
}

// `value` is genuinely arbitrary JSON (its real shape depends on the
// key's selector in the registry, validated at the lib layer, not by
// this schema) - `z.unknown()` documents that honestly rather than
// pretending a narrower type.
export const ResolvedSettingSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  source: z.enum(["user", "default", "package", "sync"]),
  label: z.string(),
  help: z.string().optional(),
  level: z.enum(["basic", "advanced", "expert"]),
  secret: z.boolean(),
  isSet: z.boolean().optional(),
  does: z.string().optional(),
  state: z.string().optional(),
  reason: z.string().optional(),
  layer: z.enum(["person", "household", "band", "default"]).optional(),
  locked: z.boolean().optional(),
});

// The registry itself: declarative metadata (labels, defaults, help), not
// a person's data. Gated behind sign-in for consistency with the rest of
// the API rather than any real sensitivity concern.
const registryRoute = createRoute({
  method: "get",
  path: "/registry",
  tags: ["Settings"],
  summary: "Every declared settings key's metadata",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(SettingsKey) } }, description: "The full registry." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
settingsRoutes.openapi(registryRoute, (c) => c.json(getRegistry(), 200));

const capabilitiesRoute = createRoute({
  method: "get",
  path: "/capabilities",
  tags: ["Settings"],
  summary: "Settings capabilities the signed-in viewer may need to draw their pages",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ robotsEnabled: z.boolean() }) } }, description: "Boolean capabilities derived from household settings." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
settingsRoutes.openapi(capabilitiesRoute, (c) => c.json({ robotsEnabled: getHouseholdSettingValue("home.robots.enabled") === true }, 200));

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Settings"],
  summary: "Resolved settings values for a scope",
  middleware: [requireAuth] as const,
  request: {
    query: z.object({
      scope: z.string().openapi({ param: { name: "scope", in: "query" }, example: "household" }),
      key: z.string().optional(),
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: z.array(ResolvedSettingSchema) } }, description: "Every key resolved for this scope." },
    ...errorResponses({ 400: "Invalid scope, or scope is missing", 401: "Not signed in", 403: "Not allowed to read this scope" }),
  },
});
settingsRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  const query = c.req.valid("query");
  const result = listValues(actor, query.scope, query.key);
  // A code review (2026-09-06) found a "settingsErrorResponse(result)"
  // helper here that every call site immediately destructured back into
  // an identical c.json(...) call - pure indirection removed in favor of
  // this direct ternary, which type-checks the same way
  // lib/openapi.ts's errorResponses() comment already explains (the
  // literal status resolves per-branch either way).
  if (!result.ok) {
    return result.status === 400 ? c.json({ error: result.error }, 400) : c.json({ error: result.error }, 403);
  }
  return c.json(result.value, 200);
});

const putRoute = createRoute({
  method: "put",
  path: "/",
  tags: ["Settings"],
  summary: "Set one settings value",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ scope: z.string(), key: z.string(), value: z.unknown(), confirmRemoval: z.boolean().optional() }),
        },
      },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: ResolvedSettingSchema } }, description: "The value as stored." },
    409: { content: { "application/json": { schema: z.object({ error: z.string(), readiness: z.unknown().optional() }) } }, description: "Coding mode is not ready or the Stack could not start the switch." },
    ...errorResponses({ 400: "Invalid scope/key/value, or a newer value already exists", 401: "Not signed in", 403: "A child needs a parent to choose a voice, or only the person may change their own voice" }),
  },
});
settingsRoutes.openapi(putRoute, async (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  if (body.value === undefined) return c.json({ error: "scope, key, and value are required" }, 400);
  if (body.scope === "household") {
    if (body.key === HUB_PORT_SETTING && typeof body.value === "number" && body.value !== configuredHubPort()) {
      const exposure = configuredLanExposure();
      if (!canBindHubPort(body.value, exposure, detectLanIps())) return c.json({ error: HUB_PORT_IN_USE_MESSAGE }, 400);
    }
    const refusal = await validateRemoteEngineSetting(body.key, body.value);
    if (refusal) return c.json({ error: refusal }, 400);
    const sourcesRefusal = validateWebSources(body.key, body.value);
    if (sourcesRefusal) return c.json({ error: sourcesRefusal }, 400);
    const hostsRefusal = validateCustomHosts(body.key, body.value);
    if (hostsRefusal) return c.json({ error: hostsRefusal }, 400);
  }
  // ROBOT-VOICE-01: authorization decides first; only an allowed writer learns whether a voice is on this hub.
  const voiceDefinition = getRegistry().find((entry) => entry.key === body.key);
  const voiceScope = parseScope(body.scope);
  if (voiceDefinition?.range?.options_from === "voices.tts" && body.value !== voiceDefinition.default && voiceScope?.kind === voiceDefinition.scope && assertCanAccessScope(actor, voiceScope, "write").ok) {
    const available = await listPlayableVoices();
    if (typeof body.value !== "string" || !isPlayableVoiceId(available, body.value)) return c.json({ error: "That voice is not on this hub. Choose one from the list." }, 400);
  }
  // CAP-GATE-01: packages that require what is being turned off are named
  // first; nothing is saved or removed until the person confirms.
  const roleOff = body.scope === "household" && body.value === "off" ? /^engines\.([a-z]+)\.choice$/.exec(body.key)?.[1] : undefined;
  const warning = roleOff ? removalConfirmation(packagesLosingCapability([roleOff])) : null;
  if (warning && body.confirmRemoval !== true) return c.json({ error: warning }, 400);
  // ROBOT-COMPANION-01: a robot's controls and companion must agree; only an admin reaches this (anyone else gets setValue's 403 below).
  const assignScope = /^device:([a-z0-9-]+)$/.exec(body.scope);
  if (assignScope && (body.key === ROBOT_CONTROLS_KEY || body.key === ROBOT_COMPANION_KEY) && isOwnerOrAdminActor(actor)) {
    const refusal = robotAssignmentRefusal(assignScope[1]!, body.key, body.value);
    if (refusal) return c.json({ error: refusal }, 400);
  }
  // COMPANIONS-APP-01: a person's companion must fit their own type (a child's list holds child companions only).
  if (body.key === "persona.active_id") {
    const personaRefusal = personaWriteRefusal(body.scope, body.value);
    if (personaRefusal) return c.json({ error: personaRefusal }, 400);
  }
  if (body.scope === "household" && body.key === "coding.home_mode") return c.json({ error: "Coding mode is now Max chat. Pick Max in a chat, or connect a coding app, and Home loads the big model for you." }, 400);
  const result = await setValue(actor, body.scope, body.key, body.value);
  if (!result.ok) {
    return result.status === 400 ? c.json({ error: result.error }, 400) : c.json({ error: result.error }, 403);
  }
  if (warning) await reconcileCapabilities();
  if (body.scope === "household" && body.key === "home.robots.enabled" && body.value === false) {
    await stopRobotHosts();
    closeRobotDeviceCommandChannels();
    closeRobotSttSockets();
  }
  if (body.scope === "household" && body.key === "home.robots.enabled" && body.value === true) await startRobotHosts();
  if (body.scope === "household" && body.key === "search.searxng_url") await checkSearchInstance({ force: true });
  if (body.scope === "household" && body.key === "network.tailnet_access") {
    if (body.value === true) {
      try { await turnOnTailscaleAccess(actor, true); }
      catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not enable away access." }, 400); }
    } else setTailscaleRenewalActive(false);
  }
  if (body.scope === "household" && body.key === ENGINE_WHERE_KEY) await applyEngineWhere(body.value);
  else if (body.scope === "household" && ["engines.stack.remote.host", "engines.stack.remote.ssh_port", "engines.stack.remote.local_port", "engines.stack.remote.allow_tailnet"].includes(body.key)) refreshConfiguredEngineLink();
  publishSettingsChanged(body.scope, body.key, result.value.value);
  // CODE-STACK-01 H2: a coding setting the Stack reads goes to the Stack now; the answer to the save does not wait on it failing.
  if (body.scope === "household" && isCodingStackKey(body.key)) await pushCodingSettings([body.key]);
  const personScope = /^person:([a-z0-9-]+)$/.exec(body.scope);
  if (personScope && body.key === "tts.voice_id") refreshRobotClips(listRobotsPairedUnderPerson(personScope[1]!));
  const robotVoiceScope = /^device:([a-z0-9-]+)$/.exec(body.scope);
  if (robotVoiceScope && (body.key === "robot.voice.id" || body.key === ROBOT_CONTROLS_KEY || body.key === ROBOT_COMPANION_KEY)) refreshRobotClips([robotVoiceScope[1]!]);
  if (body.scope === "household" && ["home.base_url", "home.access_token"].includes(body.key)) refreshHomeAssistantEvents();
  if (body.scope === "household" && body.key === "safety.alarm.sensors") {
    refreshSafetyAlarmSensors();
    refreshRobotClips(listDevicesByKind("robot").map((device) => device.id));
  }
  if (body.scope === "household" && ["network.lan_exposure", "network.hub_port"].includes(body.key)) scheduleHubRestart();
  return c.json(result.value, 200);
});

const resetRoute = createRoute({
  method: "post",
  path: "/reset",
  tags: ["Settings"],
  summary: "Reset one settings value to its default",
  middleware: [requireAuth] as const,
  request: {
    body: { content: { "application/json": { schema: z.object({ scope: z.string(), key: z.string() }) } } },
  },
  responses: {
    // `success: true` was this route's whole response body before the
    // richer ResolvedSetting body landed; a code review (2026-09-04)
    // flagged replacing it outright as a repurposed field under
    // CLAUDE.md > Compatibility's "API changes are additive" rule (no
    // current caller reads it, but the rule exists for the clients that
    // will) - kept alongside the richer body rather than dropped, so the
    // schema below is the ResolvedSetting shape plus that one extra field.
    200: {
      content: { "application/json": { schema: ResolvedSettingSchema.extend({ success: z.literal(true) }) } },
      description: "Reset to default.",
    },
    ...errorResponses({ 400: "Invalid scope/key", 401: "Not signed in", 403: "Not allowed to write this scope" }),
  },
});
settingsRoutes.openapi(resetRoute, async (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  if (body.scope === "household" && body.key === HUB_PORT_SETTING) {
    const defaultPort = Number(getRegistry().find((key) => key.key === HUB_PORT_SETTING)?.default);
    if (defaultPort !== configuredHubPort() && !canBindHubPort(defaultPort, configuredLanExposure(), detectLanIps())) {
      return c.json({ error: HUB_PORT_IN_USE_MESSAGE }, 400);
    }
  }
  const resetAssignScope = /^device:([a-z0-9-]+)$/.exec(body.scope);
  if (resetAssignScope && body.key === ROBOT_CONTROLS_KEY && isOwnerOrAdminActor(actor)) {
    const refusal = robotAssignmentRefusal(resetAssignScope[1]!, body.key, "child");
    if (refusal) return c.json({ error: refusal }, 400);
  }
  const result = resetValue(actor, body.scope, body.key);
  if (!result.ok) {
    return result.status === 400 ? c.json({ error: result.error }, 400) : c.json({ error: result.error }, 403);
  }
  if (body.scope === "household" && body.key === "home.robots.enabled" && result.value.value === false) {
    await stopRobotHosts();
    closeRobotDeviceCommandChannels();
    closeRobotSttSockets();
  }
  if (body.scope === "household" && body.key === "search.searxng_url") await checkSearchInstance({ force: true });
  publishSettingsChanged(body.scope, body.key, result.value.value);
  if (body.scope === "household" && isCodingStackKey(body.key)) await pushCodingSettings([body.key]);
  const resetRobotVoiceScope = /^device:([a-z0-9-]+)$/.exec(body.scope);
  if (resetRobotVoiceScope && (body.key === "robot.voice.id" || body.key === ROBOT_CONTROLS_KEY || body.key === ROBOT_COMPANION_KEY)) refreshRobotClips([resetRobotVoiceScope[1]!]);
  if (body.scope === "household" && ["home.base_url", "home.access_token"].includes(body.key)) refreshHomeAssistantEvents();
  if (body.scope === "household" && body.key === "safety.alarm.sensors") refreshSafetyAlarmSensors();
  if (body.scope === "household" && ["network.lan_exposure", "network.hub_port"].includes(body.key)) scheduleHubRestart();
  return c.json({ ...result.value, success: true as const }, 200);
});

// Session C step 8 (session-c-brain-and-voice.md): the interim per-person
// API token (lib/apiKeys.ts keeps it as a compatibility key) that
// authenticates POST /v1/chat/completions and the Wyoming satellite
// server until F's real device tokens (session-f-platform-and-trust.md
// step 6) land. Not modeled as a settings key despite the plan's own
// "API token setting" phrasing: a settings value round-trips (readable
// back through GET), which is exactly wrong for a bearer credential -
// this generates and returns the raw token EXACTLY ONCE, the same
// personal-access-token UX every service with this kind of credential
// uses, and never again after that.
const apiTokenGenerateRoute = createRoute({
  method: "post",
  path: "/api-token",
  tags: ["Settings"],
  summary: "Generate a new API token for the signed-in person, replacing any existing one",
  middleware: [requireAuth] as const,
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ token: z.string() }) } },
      description: "The raw token - shown exactly once. It cannot be retrieved again; generate a new one to rotate.",
    },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
settingsRoutes.openapi(apiTokenGenerateRoute, (c) => {
  const actor = c.get("person");
  return c.json({ token: issueApiToken(actor.id) }, 200);
});

const apiTokenRevokeRoute = createRoute({
  method: "delete",
  path: "/api-token",
  tags: ["Settings"],
  summary: "Revoke the signed-in person's API token, if one exists",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Revoked (or there was none)." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
settingsRoutes.openapi(apiTokenRevokeRoute, (c) => {
  const actor = c.get("person");
  revokeApiToken(actor.id);
  return c.json({ success: true as const }, 200);
});

// CODE-KEYS-01: the personal key store (lib/apiKeys.ts). The secret is in the create response only, once.
const ApiKeySchema = z.object({
  id: z.string(), person_id: z.string(), name: z.string(), scopes: z.array(z.enum(["turn", "code", "settings", "diagnose", "engine"])),
  created_at: z.string(), expires_at: z.string(), revoked_at: z.string().nullable(),
  status: z.enum(["active", "expired", "revoked", "suspended"]),
  suspended_reason: z.string().nullable(),
  last_used_at: z.string().nullable(), last_used_from: z.object({ place: z.enum(["home_network", "away"]), address: z.string() }).nullable(),
  limits: z.object({ requests_per_minute: z.number().int().min(1) }), hint: z.string(), provenance: z.string(), hlc: z.string(),
});
const AdminApiKeyPersonParam = z.object({ personId: z.string(), id: z.string().regex(/^key_[a-z0-9]{6,}$/) });
const AdminApiKeySchema = ApiKeySchema.pick({ id: true, person_id: true, scopes: true, status: true, created_at: true, expires_at: true, revoked_at: true, hint: true });
const keyIdParam = z.object({ id: z.string().regex(/^key_[a-z0-9]{6,}$/) });

settingsRoutes.openapi(createRoute({
  method: "get", path: "/coding-access", tags: ["Settings"],
  summary: "Whether the signed-in person may open their Coding key settings",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ allowed: z.boolean(), can_create: z.boolean() }) } }, description: "Access to the person's own Coding keys and whether a new key may be made now." }, ...errorResponses({ 401: "Not signed in" }) },
}), (c) => {
  const actor = c.get("person");
  const admission = codeAdmission(actor);
  const hasUsableCodeKey = listApiKeys(actor).some((key) => key.scopes.includes("code") && key.status !== "revoked" && key.status !== "expired");
  return c.json({ allowed: admission === "ok" || hasUsableCodeKey, can_create: admission === "ok" }, 200);
});

settingsRoutes.openapi(createRoute({
  method: "get", path: "/api-keys", tags: ["Settings"],
  summary: "List the signed-in person's keys (never a secret)",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ keys: z.array(ApiKeySchema) }) } }, description: "The person's keys." }, ...errorResponses({ 401: "Not signed in" }) },
}), async (c) => {
  await ensureCodingPiecesFresh();
  return c.json({ keys: listApiKeys(c.get("person")) }, 200);
});

settingsRoutes.openapi(createRoute({
  method: "post", path: "/api-keys", tags: ["Settings"],
  summary: "Make a key. The secret is returned in this response only.",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: CreateApiKeyInput } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ key: ApiKeySchema, secret: z.string() }) } }, description: "The new key and its secret, shown once." },
    ...errorResponses({ 400: "The key details or the person's access do not allow this key", 401: "Not signed in" }) },
}), (c) => {
  try { return c.json(createApiKey(c.get("person"), c.req.valid("json")), 200); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : "The key could not be made. Check the details and try again." }, 400); }
});

settingsRoutes.openapi(createRoute({
  method: "patch", path: "/api-keys/{id}", tags: ["Settings"],
  summary: "Rename one of the signed-in person's keys",
  middleware: [requireAuth] as const,
  request: { params: keyIdParam, body: { content: { "application/json": { schema: z.object({ name: z.string().trim().min(1).max(60) }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Renamed." },
    ...errorResponses({ 401: "Not signed in", 404: "No such key" }) },
}), (c) => {
  const found = renameApiKey(c.get("person").id, c.req.valid("param").id, c.req.valid("json").name);
  return found ? c.json({ success: true as const }, 200) : c.json({ error: "No such key. Reload the list and try again." }, 404);
});

settingsRoutes.openapi(createRoute({
  method: "delete", path: "/api-keys/{id}", tags: ["Settings"],
  summary: "Revoke one of the signed-in person's keys",
  middleware: [requireAuth] as const,
  request: { params: keyIdParam },
  responses: { 200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Revoked." },
    ...errorResponses({ 401: "Not signed in", 404: "No such key" }) },
}), (c) => {
  const found = revokeApiKey(c.get("person").id, c.req.valid("param").id);
  return found ? c.json({ success: true as const }, 200) : c.json({ error: "No such key. Reload the list and try again." }, 404);
});

settingsRoutes.openapi(createRoute({
  method: "get", path: "/api-keys/people/{personId}", tags: ["Settings"],
  summary: "Admin read of a person's keys: scopes, status, dates and key hints (no names, hosts or use)",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ personId: z.string() }) },
  responses: { 200: { content: { "application/json": { schema: z.object({ keys: z.array(AdminApiKeySchema) }) } }, description: "The person's keys, without names, addresses or use details." },
    ...errorResponses({ 401: "Not signed in", 403: "Not allowed", 404: "No such person" }) },
}), async (c) => {
  const target = db.select().from(people).where(eq(people.id, c.req.valid("param").personId)).get() as PersonRow | undefined;
  if (!target || target.deletedAt) return c.json({ error: "No such person. Reload the people list and try again." }, 404);
  await ensureCodingPiecesFresh();
  return c.json({ keys: listApiKeysForAdmin(target) }, 200);
});

settingsRoutes.openapi(createRoute({
  method: "delete", path: "/api-keys/people/{personId}/{id}", tags: ["Settings"],
  summary: "Admin revoke of one coding key for a person",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: AdminApiKeyPersonParam },
  responses: { 200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Revoked." }, ...errorResponses({ 401: "Not signed in", 403: "Not allowed", 404: "No such person or key" }) },
}), (c) => {
  const { personId, id } = c.req.valid("param");
  const target = db.select().from(people).where(eq(people.id, personId)).get() as PersonRow | undefined;
  if (!target || target.deletedAt || !listApiKeys(target).some((key) => key.id === id && key.scopes.includes("code"))) return c.json({ error: "No such coding key. Reload the list and try again." }, 404);
  revokeApiKey(personId, id);
  return c.json({ success: true as const }, 200);
});

settingsRoutes.openapi(createRoute({
  method: "delete", path: "/api-keys/people/{personId}", tags: ["Settings"],
  summary: "Admin revoke all coding keys for a person",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ personId: z.string() }) },
  responses: { 200: { content: { "application/json": { schema: z.object({ revoked: z.number().int().nonnegative() }) } }, description: "All coding keys were revoked." }, ...errorResponses({ 401: "Not signed in", 403: "Not allowed", 404: "No such person" }) },
}), (c) => {
  const { personId } = c.req.valid("param");
  const target = db.select().from(people).where(eq(people.id, personId)).get() as PersonRow | undefined;
  if (!target || target.deletedAt) return c.json({ error: "No such person. Reload the people list and try again." }, 404);
  const ids = listApiKeys(target).filter((key) => key.scopes.includes("code") && key.status !== "revoked").map((key) => key.id);
  for (const id of ids) revokeApiKey(personId, id);
  return c.json({ revoked: ids.length }, 200);
});

function isOwnerOrAdminActor(actor: { role: string }): boolean {
  return actor.role === "owner" || actor.role === "admin";
}
