import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { allowed } from "@/lib/films/background";
import { listDocuments } from "@/lib/longform/documents";
import { approveStage, mayRender, startProduction, writeBible, writeOutline } from "@/lib/longform/stages";
import { isProducing, produce, progressOf, stopProducing } from "@/lib/longform/runner";
import { MAX_PRODUCTION_SECONDS, MIN_PRODUCTION_SECONDS } from "@/lib/longform/structure";
import type { PersonRow } from "@/types";

// LONGFORM-01: a long-form production is pitched, then written stage by stage (treatment, bible, outline); the person approves each.
export const longformRoutes = apiRouter();
const params = z.object({ id: z.string().min(1).max(120) });
const view = z.object({
  production_id: z.string(),
  documents: z.array(z.object({ kind: z.string(), key: z.string(), version: z.number(), approved: z.boolean(), json: z.unknown() })),
  may_render: z.boolean(),
});
const error = z.object({ error: z.string() });
const body = <T extends z.ZodTypeAny>(schema: T) => ({ body: { content: { "application/json": { schema } }, required: true } });
const responses = {
  200: { description: "The production's documents", content: { "application/json": { schema: view } } },
  400: { description: "Refused, with the reason", content: { "application/json": { schema: error } } },
  404: { description: "Not available", content: { "application/json": { schema: error } } },
};
const base = { tags: ["Productions"], middleware: [requireAuth], responses };

const create = createRoute({ ...base, method: "post", path: "/", summary: "Pitch a long-form production and write its treatment",
  request: body(z.object({ idea: z.string().trim().min(3).max(4000), seconds: z.number().int().min(MIN_PRODUCTION_SECONDS).max(MAX_PRODUCTION_SECONDS), look: z.string().trim().max(160).optional() })) });
const read = createRoute({ ...base, method: "get", path: "/{id}", summary: "Read a production's documents", request: { params } });
const bible = createRoute({ ...base, method: "post", path: "/{id}/bible", summary: "Write the bible from the approved treatment", request: { params } });
const outline = createRoute({ ...base, method: "post", path: "/{id}/outline", summary: "Write the outline from the approved bible", request: { params } });
const approve = createRoute({ ...base, method: "post", path: "/{id}/approve", summary: "Approve a document",
  request: { params, ...body(z.object({ kind: z.enum(["treatment", "bible", "outline"]) })) } });

const progressView = z.object({ producing: z.boolean(), scenes_total: z.number(), scenes_done: z.number(), seconds_left: z.number().nullable(), runs: z.array(z.object({ scene_key: z.string(), state: z.string(), done_steps: z.number(), total_steps: z.number() })) });
const progressResponses = { ...responses, 200: { description: "How far the production has come", content: { "application/json": { schema: progressView } } } };
const produceRoute = createRoute({ ...base, responses: progressResponses, method: "post", path: "/{id}/produce", summary: "Make every scene of an approved production in the background (safe to call again to resume)", request: { params } });
const progressRoute = createRoute({ ...base, responses: progressResponses, method: "get", path: "/{id}/progress", summary: "Read how far the scenes have come", request: { params } });
const stopRoute = createRoute({ ...base, responses: progressResponses, method: "post", path: "/{id}/stop", summary: "Stop making scenes after the current step", request: { params } });

function viewOf(actor: PersonRow, productionId: string) {
  return {
    production_id: productionId,
    documents: listDocuments(actor, productionId).map((d) => ({ kind: d.kind, key: d.key, version: d.version, approved: d.approved, json: d.json })),
    may_render: mayRender(actor, productionId),
  };
}
const NOT_HERE = "Production unavailable";
const ADULTS = "Long productions are for adults on their own written screen.";

longformRoutes.openapi(create, async (c) => {
  const actor = c.get("person") as PersonRow;
  if (!allowed(actor)) return c.json({ error: ADULTS }, 400);
  const r = await startProduction(actor, c.req.valid("json"));
  return r.ok ? c.json(viewOf(actor, r.productionId), 200) : c.json({ error: r.line }, 400);
});
longformRoutes.openapi(read, (c) => {
  const actor = c.get("person") as PersonRow;
  if (!allowed(actor)) return c.json({ error: NOT_HERE }, 404);
  const v = viewOf(actor, c.req.valid("param").id);
  return v.documents.length ? c.json(v, 200) : c.json({ error: NOT_HERE }, 404);
});
longformRoutes.openapi(bible, async (c) => {
  const actor = c.get("person") as PersonRow, id = c.req.valid("param").id;
  if (!allowed(actor)) return c.json({ error: NOT_HERE }, 404);
  const r = await writeBible(actor, id);
  return r.ok ? c.json(viewOf(actor, id), 200) : c.json({ error: r.line }, 400);
});
longformRoutes.openapi(outline, async (c) => {
  const actor = c.get("person") as PersonRow, id = c.req.valid("param").id;
  if (!allowed(actor)) return c.json({ error: NOT_HERE }, 404);
  const r = await writeOutline(actor, id);
  return r.ok ? c.json(viewOf(actor, id), 200) : c.json({ error: r.line }, 400);
});
longformRoutes.openapi(approve, (c) => {
  const actor = c.get("person") as PersonRow, id = c.req.valid("param").id;
  if (!allowed(actor)) return c.json({ error: NOT_HERE }, 404);
  const d = approveStage(actor, id, c.req.valid("json").kind);
  return d ? c.json(viewOf(actor, id), 200) : c.json({ error: "Nothing to approve yet." }, 400);
});
longformRoutes.openapi(produceRoute, (c) => {
  const actor = c.get("person") as PersonRow, id = c.req.valid("param").id;
  if (!allowed(actor)) return c.json({ error: NOT_HERE }, 404);
  if (!mayRender(actor, id)) return c.json({ error: "Approve the bible and the outline before anything is made." }, 400);
  if (isProducing(id)) return c.json({ error: "This production is already being made." }, 400);
  void produce(actor, id).then((r) => { if (!r.ok) console.warn("[longform] production stopped:", id, r.line); else console.info("[longform] production finished:", id); }).catch((e) => console.error("[longform] produce failed", id, e));
  return c.json(progressOf(actor, id), 200);
});
longformRoutes.openapi(progressRoute, (c) => {
  const actor = c.get("person") as PersonRow, id = c.req.valid("param").id;
  if (!allowed(actor)) return c.json({ error: NOT_HERE }, 404);
  return viewOf(actor, id).documents.length ? c.json(progressOf(actor, id), 200) : c.json({ error: NOT_HERE }, 404);
});
longformRoutes.openapi(stopRoute, (c) => {
  const actor = c.get("person") as PersonRow, id = c.req.valid("param").id;
  if (!allowed(actor)) return c.json({ error: NOT_HERE }, 404);
  stopProducing(id);
  return c.json(progressOf(actor, id), 200);
});
