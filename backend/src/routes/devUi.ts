// UI-SHOWCASE: admin-only developer route behind the Chat showcase page
// (/dev/ui). It plays a named fixture (lib/uiFixtures.ts) through the real
// assistant-stream sink, the same encoder POST /api/turn/stream uses, at a
// chosen pace. Additive: nothing here is read by the real turn path. The one
// stored failed-tool and generation-failure rows (no conversation), so the
// admin error-detail controls read real records.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { createAssistantStreamSink } from "@/lib/assistantStreamWire";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { DEFAULT_PACE, UI_FIXTURES, findFixture } from "@/lib/uiFixtures";

export const devUiRoutes = apiRouter();

const listRoute = createRoute({
  method: "get", path: "/", tags: ["Developer"],
  summary: "The Chat showcase's scenarios",
  description: "Owner/admin only: the canned turns the Chat showcase can play, each with a one-line description.",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ fixtures: z.array(z.object({ id: z.string(), title: z.string(), description: z.string() })) }) } }, description: "The scenarios, in showcase order." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});

devUiRoutes.openapi(listRoute, (c) => c.json({ fixtures: UI_FIXTURES.map(({ id, title, description }) => ({ id, title, description })) }, 200));

const streamRoute = createRoute({
  method: "post", path: "/{fixture_id}/stream", tags: ["Developer"],
  summary: "Play one scenario as an assistant-stream turn",
  description: "Owner/admin only, and refused for a temporary (Incognito) request: streams the named fixture's events through the real assistant-stream encoder, at the chosen pace. Stores only fixture rows for admin error-detail scenarios (no conversation).",
  middleware: [requireRole("owner", "admin")] as const,
  request: {
    params: idParamSchema("fixture_id"),
    body: { content: { "application/json": { schema: z.object({ pace: z.enum(["instant", "normal", "slow"]).default("normal"), temporary: z.boolean().optional() }) } } },
  },
  responses: {
    200: { content: { "application/x-assistant-stream": { schema: z.string() } }, description: "The fixture as an assistant-stream turn." },
    ...errorResponses({ 403: "Not owner/admin, or a temporary request", 404: "Unknown fixture" }),
  },
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

devUiRoutes.openapi(streamRoute, (c) => {
  const { pace, temporary } = c.req.valid("json");
  if (temporary === true) return c.json({ error: "The showcase is not available in a temporary chat" }, 403);
  const fixture = findFixture(c.req.valid("param").fixture_id);
  if (!fixture) return c.json({ error: "Unknown fixture" }, 404);
  if (fixture.storedOutcomes || fixture.storedStats) {
    const person = c.get("person");
    const turnId = `showcase-${fixture.id}`;
    db.insert(conversationTurns).values({
      id: turnId, personId: person.id, conversationId: null, surface: "chat", userText: "saturday market hours", replyText: "", source: "model", safetyAction: "allow",
      minorSpeaker: false, createdAt: new Date().toISOString(), hlc: nextHlc(),
      outcomes: fixture.storedOutcomes ? JSON.stringify(fixture.storedOutcomes) : null,
      stats: fixture.storedStats ? JSON.stringify(fixture.storedStats) : null,
    }).onConflictDoUpdate({ target: conversationTurns.id, set: { personId: person.id } }).run();
  }
  const ms = pace === "instant" ? 0 : (fixture.pace ?? DEFAULT_PACE)[pace];
  let cancelled = false;
  const sink = createAssistantStreamSink(() => { cancelled = true; });
  void (async () => {
    for (const event of fixture.events) {
      if (cancelled) return;
      sink.write(event);
      if (ms > 0 && "type" in event && (event.type === "delta" || event.type === "reasoning")) await sleep(ms);
    }
    sink.close();
  })();
  return new Response(sink.readable, { headers: sink.headers }) as never;
});
