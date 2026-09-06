// Session F, step 6: "Sessions per device under Profile with revoke"
// (BACKLOG.md, platform plan 4.1). Cookie-based browser sessions only -
// device-token-backed native clients (lib/deviceTokens.ts) show up under
// GET /api/devices instead, since a native client's long-lived identity
// is its device token, not whichever short-lived session cookie it
// currently holds.
import { createRoute, z } from "@hono/zod-openapi";
import { eq, and } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { hashSessionToken } from "@/lib/session";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";

export const authSessionsRoutes = apiRouter();

const SessionSchema = z.object({
  id: z.string(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  isCurrent: z.boolean(),
});

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Sessions"],
  summary: "My own active browser sessions",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(SessionSchema) } }, description: "Every non-expired session for my profile." },
  },
});
authSessionsRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  const currentToken = getCookie(c, "session");
  const currentHash = currentToken ? hashSessionToken(currentToken) : null;
  const rows = db.select().from(sessions).where(eq(sessions.personId, actor.id)).all();
  return c.json(
    rows.map((r) => ({
      id: r.id,
      userAgent: r.userAgent,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      isCurrent: r.tokenHash === currentHash,
    })),
    200,
  );
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Sessions"],
  summary: "Revoke one of my own sessions - signs that device out immediately",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Revoked." },
    ...errorResponses({ 404: "No such session (or it isn't mine)" }),
  },
});
authSessionsRoutes.openapi(deleteRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const row = db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, id), eq(sessions.personId, actor.id))).get();
  if (!row) return c.json({ error: "No such session" }, 404);
  db.delete(sessions).where(eq(sessions.id, id)).run();
  // invalidateSessionCache() needs the raw token (it hashes internally),
  // which this route never has for an arbitrary session row - clearing
  // every cached entry for this person is a harmless superset (the
  // sessionCache TTL is only 10s anyway) rather than inventing a
  // by-hash variant for this one caller.
  invalidateSessionCacheForPerson(actor.id);
  return c.json({ success: true as const }, 200);
});
