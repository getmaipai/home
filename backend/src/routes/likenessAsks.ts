// PERUSE-2026-10-25: the per-use consent ask. Signed in as the requester or the pictured adult; the decision is recorded as made
// from that account. No session is issued and no secret is checked (presence confirmation, design section 8).
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { askFor, asksFor, cancelAsk, decideAsk } from "@/lib/likeness/ask";

export const likenessAskRoutes = apiRouter();

const AskSchema = z.object({
  id: z.string(),
  state: z.enum(["waiting", "approved", "declined", "expired", "consumed", "cancelled"]),
  medium: z.enum(["picture", "video"]),
  count: z.number(),
  style_name: z.string().nullable(),
  requester_name: z.string(),
  subject_name: z.string(),
  prompt: z.string().nullable().describe("The exact prompt Home will send, only while the ask is open."),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
  as: z.enum(["subject", "requester"]).describe("Which side of the ask the reader is."),
});
const IdParam = z.object({ id: z.string().min(1).max(64) });

const listRoute = createRoute({
  method: "get", path: "/", tags: ["Pictures"], summary: "Consent asks you are part of", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ asks: z.array(AskSchema) }) } }, description: "Newest first. As the pictured adult every ask about you; as the requester only your own." }, ...errorResponses({ 401: "Not signed in" }) },
});
likenessAskRoutes.openapi(listRoute, (c) => c.json({ asks: asksFor(c.get("person")) }, 200));

const getRoute = createRoute({
  method: "get", path: "/{id}", tags: ["Pictures"], summary: "One consent ask, for its card", middleware: [requireAuth] as const,
  request: { params: IdParam },
  responses: { 200: { content: { "application/json": { schema: AskSchema } }, description: "The ask." }, ...errorResponses({ 401: "Not signed in", 404: "No such ask for you" }) },
});
likenessAskRoutes.openapi(getRoute, (c) => {
  const ask = askFor(c.req.valid("param").id, c.get("person"));
  return ask ? c.json(ask, 200) : (c.json({ error: "That request isn't here any more." }, 404) as never);
});

const decideRoute = createRoute({
  method: "post", path: "/{id}/decide", tags: ["Pictures"], summary: "Consent to or decline one ask", middleware: [requireAuth] as const,
  request: { params: IdParam, body: { content: { "application/json": { schema: z.object({ decision: z.enum(["consent", "decline"]) }) } }, required: true } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ state: z.enum(["waiting", "approved", "declined", "expired", "consumed", "cancelled"]) }) } }, description: "The ask after the decision." },
    ...errorResponses({ 401: "Not signed in", 404: "No such ask for you", 409: "The ask already ended" }),
  },
});
likenessAskRoutes.openapi(decideRoute, (c) => {
  const result = decideAsk(c.req.valid("param").id, c.get("person"), c.req.valid("json").decision);
  if (result.ok) return c.json({ state: result.state }, 200);
  return c.json({ error: result.line }, result.code === "not_found" ? 404 : 409) as never;
});

const cancelRoute = createRoute({
  method: "post", path: "/{id}/cancel", tags: ["Pictures"], summary: "Cancel your own waiting ask", middleware: [requireAuth] as const,
  request: { params: IdParam },
  responses: { 200: { content: { "application/json": { schema: z.object({ state: z.literal("cancelled") }) } }, description: "Cancelled." }, ...errorResponses({ 401: "Not signed in", 404: "No such ask for you", 409: "The ask already ended" }) },
});
likenessAskRoutes.openapi(cancelRoute, (c) => {
  const result = cancelAsk(c.req.valid("param").id, c.get("person"));
  if (result.ok) return c.json({ state: "cancelled" as const }, 200);
  return c.json({ error: result.line }, result.code === "not_found" ? 404 : 409) as never;
});
