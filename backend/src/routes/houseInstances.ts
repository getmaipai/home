// HOUSE-02: Settings, House. Admin-only routes to add, rename, enable, disable and remove connector instances, test one,
// and choose which Home Assistant areas and entities Home may see (the exposure list).
// No instance slug, label or address is written to the tool audit or to logs (connector-instances design C3).
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { addInstance, connectionFor, listInstanceViews, removeInstance, updateInstance } from "@/lib/connectors/manage";
import type { ConnectorType, InstanceDeps } from "@/lib/connectors/instances";
import { fetchHouseRegistry } from "@/lib/house/registry";
import { getExposure, setExposure } from "@/lib/house/exposure";
import { clearHouseRegistry } from "@/lib/house/cache";

export const houseInstanceRoutes = apiRouter();
const Type = z.enum(["home_assistant", "uptime_kuma", "gitea", "immich", "unifi", "plex"]);
const View = z.object({ type: Type, instance: z.string(), label: z.string(), address: z.string(), enabled: z.boolean(), virtual: z.boolean(), hasToken: z.boolean() });
const Err = z.object({ error: z.string() });

let testDeps: InstanceDeps = {};
export function __setInstanceAdminDepsForTests(deps: InstanceDeps = {}): void { testDeps = deps; }

const params = z.object({ type: Type, slug: z.string().min(1).max(40) });
const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });

houseInstanceRoutes.openapi(createRoute({ method: "get", path: "/{type}", tags: ["House"], summary: "Connector instances of one type", middleware: [requireRole("owner", "admin")] as const, request: { params: z.object({ type: Type }) },
  responses: { 200: { ...json(z.object({ instances: z.array(View) })), description: "Instances, never their tokens" }, ...errorResponses({ 401: "Sign in", 403: "Only the owner or an admin" }) } }),
  (c) => c.json({ instances: listInstanceViews(c.req.valid("param").type) }, 200));

houseInstanceRoutes.openapi(createRoute({ method: "post", path: "/{type}", tags: ["House"], summary: "Add a connector instance", middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ type: Type }), body: { content: { "application/json": { schema: z.object({ label: z.string(), address: z.string(), token: z.string().optional() }) } } } },
  responses: { 201: { ...json(View), description: "Added" }, 400: { ...json(Err), description: "Fix the field named" }, ...errorResponses({ 401: "Sign in", 403: "Only the owner or an admin" }) } }),
  (c) => {
    const result = addInstance({ type: c.req.valid("param").type, ...c.req.valid("json") });
    if (!result.ok) return c.json({ error: result.message }, 400);
    clearHouseRegistry();
    return c.json(result.value, 201);
  });

houseInstanceRoutes.openapi(createRoute({ method: "put", path: "/{type}/{slug}", tags: ["House"], summary: "Rename, re-address, enable or disable an instance, or replace its token", middleware: [requireRole("owner", "admin")] as const,
  request: { params, body: { content: { "application/json": { schema: z.object({ label: z.string().optional(), address: z.string().optional(), enabled: z.boolean().optional(), token: z.string().optional() }) } } } },
  responses: { 200: { ...json(View), description: "Saved" }, 400: { ...json(Err), description: "Fix the field named" }, 404: { ...json(Err), description: "No such connection" }, ...errorResponses({ 401: "Sign in", 403: "Only the owner or an admin" }) } }),
  (c) => {
    const { type, slug } = c.req.valid("param");
    const result = updateInstance(type, slug, c.req.valid("json"));
    if (!result.ok) return c.json({ error: result.message }, result.status);
    clearHouseRegistry();
    return c.json(result.value, 200);
  });

houseInstanceRoutes.openapi(createRoute({ method: "delete", path: "/{type}/{slug}", tags: ["House"], summary: "Remove an instance (its name is never reused)", middleware: [requireRole("owner", "admin")] as const, request: { params },
  responses: { 200: { ...json(z.object({ ok: z.literal(true) })), description: "Removed" }, 404: { ...json(Err), description: "No such connection" }, ...errorResponses({ 401: "Sign in", 403: "Only the owner or an admin" }) } }),
  (c) => {
    const { type, slug } = c.req.valid("param");
    const result = removeInstance(type, slug);
    if (!result.ok) return c.json({ error: result.message }, 404);
    clearHouseRegistry();
    return c.json({ ok: true as const }, 200);
  });

const testResult = z.union([z.object({ ok: z.literal(true), rooms: z.number(), devices: z.number() }), z.object({ ok: z.literal(false), kind: z.string(), nextStep: z.string() })]);
const NEXT: Record<string, string> = {
  refused: "Home Assistant refused the token. Create a new long-lived token in your Home Assistant profile and paste it here.",
  timeout: "Check that Home Assistant is responding on your home network, then try again.",
  unreachable: "Check that Home Assistant is on and reachable at that address.",
};

houseInstanceRoutes.openapi(createRoute({ method: "post", path: "/{type}/{slug}/test", tags: ["House"], summary: "Test one instance", middleware: [requireRole("owner", "admin")] as const, request: { params },
  responses: { 200: { ...json(testResult), description: "Result with the next step" }, 404: { ...json(Err), description: "No such connection" }, ...errorResponses({ 401: "Sign in", 403: "Only the owner or an admin" }) } }),
  async (c) => {
    const { type, slug } = c.req.valid("param");
    const found = connectionFor(type, slug, testDeps);
    if (!found) return c.json({ error: "That connection no longer exists. Reload Settings, House and pick one from the list." }, 404);
    if (!found.connection.ok) return c.json({ ok: false as const, kind: found.connection.reason, nextStep: found.connection.message }, 200);
    if (type !== "home_assistant") return c.json({ ok: false as const, kind: "unsupported", nextStep: "Testing this service arrives with its connector." }, 200);
    const result = await fetchHouseRegistry({ lanFetch: found.connection.lanFetch, token: found.connection.token });
    if (!result.ok) return c.json({ ok: false as const, kind: result.kind, nextStep: NEXT[result.kind] ?? NEXT.unreachable! }, 200);
    return c.json({ ok: true as const, rooms: result.areas.length, devices: result.entities.length }, 200);
  });

const Editor = z.object({
  configured: z.boolean(), exposedAreas: z.array(z.string()), exposedEntities: z.array(z.string()),
  areas: z.array(z.object({ id: z.string(), name: z.string() })),
  entities: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string(), area: z.string().nullable(), sensitive: z.string().nullable() })),
});
const Unreachable = z.object({ error: z.string(), nextStep: z.string() });

houseInstanceRoutes.openapi(createRoute({ method: "get", path: "/{type}/{slug}/exposure", tags: ["House"], summary: "Everything Home Assistant has, and what is exposed now", middleware: [requireRole("owner", "admin")] as const, request: { params },
  responses: { 200: { ...json(Editor), description: "Registry and the saved list" }, 404: { ...json(Err), description: "No such connection" }, 502: { ...json(Unreachable), description: "Home Assistant did not answer" }, ...errorResponses({ 401: "Sign in", 403: "Only the owner or an admin" }) } }),
  async (c) => {
    const { type, slug } = c.req.valid("param");
    const found = connectionFor(type, slug, testDeps);
    if (!found) return c.json({ error: "That connection no longer exists. Reload Settings, House and pick one from the list." }, 404);
    if (!found.connection.ok) return c.json({ error: "Home cannot read this connection yet.", nextStep: found.connection.message }, 502);
    const registry = await fetchHouseRegistry({ lanFetch: found.connection.lanFetch, token: found.connection.token });
    if (!registry.ok) return c.json({ error: "Home Assistant did not answer, so the list of devices could not load.", nextStep: NEXT[registry.kind] ?? NEXT.unreachable! }, 502);
    const saved = getExposure(slug, type);
    return c.json({
      configured: saved !== null, exposedAreas: saved?.areas ?? [], exposedEntities: saved?.entities ?? [],
      areas: registry.areas.map((area) => ({ id: area.id, name: area.name })),
      entities: registry.entities.map((entity) => ({ id: entity.id, name: entity.name, kind: entity.kind, area: entity.area, sensitive: entity.sensitive })),
    }, 200);
  });

houseInstanceRoutes.openapi(createRoute({ method: "put", path: "/{type}/{slug}/exposure", tags: ["House"], summary: "Save which areas and entities Home may see", middleware: [requireRole("owner", "admin")] as const,
  request: { params, body: { content: { "application/json": { schema: z.object({ areas: z.array(z.string().max(120)).max(500), entities: z.array(z.string().max(160)).max(5000) }) } } } },
  responses: { 200: { ...json(z.object({ ok: z.literal(true) })), description: "Saved" }, 404: { ...json(Err), description: "No such connection" }, ...errorResponses({ 401: "Sign in", 403: "Only the owner or an admin" }) } }),
  (c) => {
    const { type, slug } = c.req.valid("param");
    if (!listInstanceViews(type as ConnectorType).some((item) => item.instance === slug)) return c.json({ error: "That connection no longer exists. Reload Settings, House and pick one from the list." }, 404);
    setExposure(slug, c.req.valid("json"), type);
    return c.json({ ok: true as const }, 200);
  });
