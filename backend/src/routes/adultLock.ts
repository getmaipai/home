// ADULT-LOCK-02: the Adult lock's three routes (docs/dev/adult-lock.md). `unlock` takes no item id, so it cannot be used to probe for one; its
// failures are the same 401 and 429 bodies sign-in returns, so the page reuses `usePasscodeAttempt` and `PasscodeInput` unchanged.
import { createRoute, z } from "@hono/zod-openapi";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { db } from "@/db";
import { personCredentials } from "@/db/schema";
import { requireAuth } from "@/middleware/auth";
import { speakerAgeBand } from "@/lib/ageBand";
import { clearFailedAttempts, currentLockout } from "@/lib/credentialLockout";
import { verifyAgainstRecord } from "@/lib/secretCheck";
import { getClientIp, throttleCheck } from "@/lib/secretThrottle";
import { PROOF_HEADER, countUnlock, issueProof, issueTicket, revokeProof, sessionKeyOf } from "@/lib/adultLock";
import type { PersonRow } from "@/types";

export const adultLockRoutes = apiRouter();

const SHARED_SCREEN_LINE = "Unlock on your own screen. Open Home on your own phone or computer and try again.";
const NO_SECRET_LINE = "Set a passcode in Account to open these.";

/** The session key when this request is a person's own written screen (a human browser session of an adult), else a refusal body. */
function ownScreen(c: Parameters<Parameters<typeof adultLockRoutes.openapi>[1]>[0], actor: PersonRow): { ok: true; sessionKey: string } | { ok: false } {
  const sessionKey = sessionKeyOf(getCookie(c, "session"));
  if (!sessionKey || speakerAgeBand(actor, new Date()) !== "adult") return { ok: false };
  return { ok: true, sessionKey };
}

const SecretBody = z.object({ secret: z.string().min(1).max(200), visit: z.string().min(1).max(80).optional() });
const unlockRoute = createRoute({
  method: "post", path: "/unlock", tags: ["Adult lock"], summary: "Unlock this page's adult-only items with your own passcode", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: SecretBody } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ proof: z.string(), idle_seconds: z.number() }) } }, description: "A short-lived proof. Keep it in memory, send it as X-Adult-Unlock, drop it when the page ends." },
    ...errorResponses({ 400: "No passcode is set", 401: "Wrong passcode", 403: "Not an adult's own screen", 429: "Too many attempts" }),
  },
});
adultLockRoutes.openapi(unlockRoute, async (c) => {
  const actor = c.get("person");
  const screen = ownScreen(c, actor);
  if (!screen.ok) return c.json({ error: SHARED_SCREEN_LINE }, 403);
  const { secret, visit } = c.req.valid("json");
  const ip = getClientIp(c);
  const throttled = throttleCheck(ip);
  if (throttled.blocked) { countUnlock("locked_out"); return c.json({ error: "Too many attempts", retryAfter: throttled.retryAfter }, 429); }
  const record = db.select().from(personCredentials).where(eq(personCredentials.personId, actor.id)).get();
  if (!record || record.secretHash === null) return c.json({ error: NO_SECRET_LINE }, 400);
  const lockout = currentLockout(actor.id, "adult_unlock");
  const verified = await verifyAgainstRecord(ip, actor.id, { secretHash: record.secretHash, lockedUntil: lockout?.lockedUntil ?? null }, secret, "Invalid PIN or password", "adult_unlock");
  if (!verified.ok) {
    countUnlock(verified.status === 429 ? "locked_out" : "wrong");
    return c.json(verified.body, verified.status);
  }
  clearFailedAttempts(actor.id, "adult_unlock");
  countUnlock("ok");
  return c.json(issueProof(actor.id, screen.sessionKey, visit ?? "page"), 200);
});

const lockRoute = createRoute({
  method: "post", path: "/lock", tags: ["Adult lock"], summary: "Lock now: end this page's unlock", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ locked: z.literal(true) }) } }, description: "The proof no longer works." } },
});
adultLockRoutes.openapi(lockRoute, (c) => {
  revokeProof(c.req.header(PROOF_HEADER));
  return c.json({ locked: true as const }, 200);
});

const confirmRoute = createRoute({
  method: "post", path: "/confirm", tags: ["Adult lock"], summary: "A fresh passcode for one action on one item (the creator removing the lock): a single-use ticket valid 30 seconds", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ secret: z.string().min(1).max(200), action: z.literal("unmark"), item: z.string().min(1).max(80) }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ticket: z.string(), expires_in: z.number() }) } }, description: "Single use, bound to this item and this session. A live unlock proof does not replace it." },
    ...errorResponses({ 400: "No passcode is set", 401: "Wrong passcode", 403: "Not an adult's own screen", 429: "Too many attempts" }),
  },
});
adultLockRoutes.openapi(confirmRoute, async (c) => {
  const actor = c.get("person");
  const screen = ownScreen(c, actor);
  if (!screen.ok) return c.json({ error: SHARED_SCREEN_LINE }, 403);
  const { secret, item } = c.req.valid("json");
  const ip = getClientIp(c);
  const throttled = throttleCheck(ip);
  if (throttled.blocked) return c.json({ error: "Too many attempts", retryAfter: throttled.retryAfter }, 429);
  const record = db.select().from(personCredentials).where(eq(personCredentials.personId, actor.id)).get();
  if (!record || record.secretHash === null) return c.json({ error: NO_SECRET_LINE }, 400);
  const lockout = currentLockout(actor.id, "adult_unlock");
  const verified = await verifyAgainstRecord(ip, actor.id, { secretHash: record.secretHash, lockedUntil: lockout?.lockedUntil ?? null }, secret, "Invalid PIN or password", "adult_unlock");
  if (!verified.ok) return c.json(verified.body, verified.status);
  clearFailedAttempts(actor.id, "adult_unlock");
  return c.json(issueTicket(actor.id, screen.sessionKey, item), 200);
});
