import { Hono, type Context } from "hono";
import { requireAuth, requireRole } from "@/middleware/auth";
import {
  remember,
  list,
  recall,
  archive,
  supersede,
  forget,
  exportPerson,
  runMaintenance,
  type MemoryOpResult,
  type ListOptions,
} from "@/lib/memory";
import type { AppEnv } from "@/types";

export const memoryRoutes = new Hono<AppEnv>();

function fail(c: Context<AppEnv>, result: Extract<MemoryOpResult<unknown>, { ok: false }>) {
  return c.json({ error: result.error }, result.status);
}

function parseListOptions(query: URLSearchParams): ListOptions {
  const opts: ListOptions = {};
  const scope = query.get("scope");
  if (scope === "household" || scope === "person" || scope === "self") opts.scope = scope;
  const person = query.get("person");
  if (person) opts.person = person;
  return opts;
}

memoryRoutes.post("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "a JSON body is required" }, 400);
  const result = remember(actor, body as Parameters<typeof remember>[1]);
  if (!result.ok) return fail(c, result);
  return c.json(result.value, 201);
});

memoryRoutes.get("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const opts = parseListOptions(new URL(c.req.url).searchParams);
  return c.json(list(actor, opts));
});

memoryRoutes.get("/recall", requireAuth, async (c) => {
  const actor = c.get("person");
  const query = new URL(c.req.url).searchParams;
  const q = query.get("q");
  if (!q) return c.json({ error: "q is required" }, 400);
  const opts = parseListOptions(query);
  return c.json(recall(actor, q, opts));
});

memoryRoutes.get("/export", requireAuth, async (c) => {
  const actor = c.get("person");
  const personId = new URL(c.req.url).searchParams.get("personId");
  if (!personId) return c.json({ error: "personId is required" }, 400);
  const result = exportPerson(actor, personId);
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

memoryRoutes.post("/forget", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { personId?: string };
  if (!body.personId) return c.json({ error: "personId is required" }, 400);
  const result = forget(actor, body.personId);
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

memoryRoutes.post("/maintenance/run", requireRole("owner", "admin"), async (c) => {
  return c.json(runMaintenance());
});

memoryRoutes.post("/:id/archive", requireAuth, async (c) => {
  const actor = c.get("person");
  const result = archive(actor, c.req.param("id"));
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

memoryRoutes.post("/:id/supersede", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "a JSON body is required" }, 400);
  const result = supersede(actor, c.req.param("id"), body as Parameters<typeof supersede>[2]);
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});
