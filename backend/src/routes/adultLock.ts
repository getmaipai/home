// ADULT-LOCK-02: the Adult lock's three routes (docs/dev/adult-lock.md). `unlock` takes no item id, so it cannot be used to probe for one; its
// failures are the same 401 and 429 bodies sign-in returns, so the page reuses `usePasscodeAttempt` and `PasscodeInput` unchanged.
import { createRoute, z } from "@hono/zod-openapi";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { db } from "@/db";
import { passkeyCredentials, personCredentials } from "@/db/schema";
import { requireAuth } from "@/middleware/auth";
import { speakerAgeBand } from "@/lib/ageBand";
import { clearFailedAttempts, currentLockout, ensureCredentialRowExists } from "@/lib/credentialLockout";
import { recordCredentialFailure, verifyAgainstRecord } from "@/lib/secretCheck";
import { getClientIp, throttleCheck } from "@/lib/secretThrottle";
import { PROOF_HEADER, countUnlock, issueProof, issueTicket, revokeProof, sessionKeyOf } from "@/lib/adultLock";
import type { PersonRow } from "@/types";
import { authenticationOptions, verifyAuthentication } from "@/lib/passkeys";

export const adultLockRoutes = apiRouter();

const SHARED_SCREEN_LINE = "Unlock on your own screen. Open Home on your own phone or computer and try again.";
const NO_SECRET_LINE = "Set a passcode in Account to open these.";

/** The session key when this request is a person's own written screen (a human browser session of an adult), else a refusal body. */
function ownScreen(c: Parameters<Parameters<typeof adultLockRoutes.openapi>[1]>[0], actor: PersonRow): { ok: true; sessionKey: string } | { ok: false } {
  const sessionKey = sessionKeyOf(getCookie(c, "session"));
  if (!sessionKey || speakerAgeBand(actor, new Date()) !== "adult") return { ok: false };
  return { ok: true, sessionKey };
}

const AssertionSchema = z.record(z.string(), z.any());
const CredentialBody = z.object({ secret: z.string().min(1).max(200).optional(), passkey_assertion: AssertionSchema.optional() });
const UnlockBody = CredentialBody.extend({ visit: z.string().min(1).max(80).optional() })
  .refine((body) => Boolean(body.secret) !== Boolean(body.passkey_assertion), "Provide exactly one credential");
const ConfirmBody = CredentialBody.extend({ action: z.literal("unmark"), item: z.string().min(1).max(80) })
  .refine((body) => Boolean(body.secret) !== Boolean(body.passkey_assertion), "Provide exactly one credential");
const passkeyFailureMessage = "Invalid PIN or password";
const PASSKEY_RETRY_LINE = "That passkey check timed out. Press Use a passkey and try again.";

const optionsRoute = createRoute({
  method: "post", path: "/unlock/options", tags: ["Adult lock"], summary: "Passkey options for unlocking on this adult's own screen", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.record(z.string(), z.any()) } }, description: "Pass straight to navigator.credentials.get()." }, ...errorResponses({ 403: "Not an adult's own screen" }) },
});
adultLockRoutes.openapi(optionsRoute, async (c) => {
  const actor = c.get("person");
  if (!ownScreen(c, actor).ok) return c.json({ error: SHARED_SCREEN_LINE }, 403);
  return c.json(await authenticationOptions(actor.id), 200);
});

const unlockRoute = createRoute({
  method: "post", path: "/unlock", tags: ["Adult lock"], summary: "Unlock this page's adult-only items with your own passcode", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: UnlockBody } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ proof: z.string(), idle_seconds: z.number() }) } }, description: "A short-lived proof. Keep it in memory, send it as X-Adult-Unlock, drop it when the page ends." },
    ...errorResponses({ 400: "No passcode is set", 401: "Wrong passcode", 403: "Not an adult's own screen", 429: "Too many attempts" }),
  },
});
adultLockRoutes.openapi(unlockRoute, async (c) => {
  const actor = c.get("person");
  const screen = ownScreen(c, actor);
  if (!screen.ok) return c.json({ error: SHARED_SCREEN_LINE }, 403);
  const { secret, passkey_assertion, visit } = c.req.valid("json");
  const ip = getClientIp(c);
  const throttled = throttleCheck(ip);
  if (throttled.blocked) { countUnlock("locked_out"); return c.json({ error: "Too many attempts", retryAfter: throttled.retryAfter }, 429); }
  const lockout = currentLockout(actor.id, "adult_unlock");
  if (lockout?.lockedUntil && new Date(lockout.lockedUntil).getTime() > Date.now()) {
    const retryAfter = Math.ceil((new Date(lockout.lockedUntil).getTime() - Date.now()) / 1000);
    countUnlock("locked_out"); return c.json({ error: "Too many attempts", retryAfter }, 429);
  }
  let verified: Awaited<ReturnType<typeof verifyAgainstRecord>>;
  if (passkey_assertion) {
    const hasPasskey = db.select({ id: passkeyCredentials.id }).from(passkeyCredentials).where(eq(passkeyCredentials.personId, actor.id)).get();
    if (!hasPasskey) return c.json({ error: NO_SECRET_LINE }, 400);
    const result = await verifyAuthentication(actor.id, passkey_assertion as AuthenticationResponseJSON);
    if (!result.ok) {
      // An expired or unknown challenge is not a wrong guess (another request can overwrite the person's pending challenge): it counts toward nothing.
      if (result.code !== "passkey_verify_failed") return c.json({ error: PASSKEY_RETRY_LINE }, 401);
      ensureCredentialRowExists(actor.id);
      const failure = recordCredentialFailure(ip, actor.id, passkeyFailureMessage, "adult_unlock");
      countUnlock("wrong"); return c.json(failure.body, 401);
    }
    verified = { ok: true };
  } else {
    const record = db.select().from(personCredentials).where(eq(personCredentials.personId, actor.id)).get();
    const hasPasskey = db.select({ id: passkeyCredentials.id }).from(passkeyCredentials).where(eq(passkeyCredentials.personId, actor.id)).get();
    if ((!record || record.secretHash === null) && !hasPasskey) return c.json({ error: NO_SECRET_LINE }, 400);
    if (!record || record.secretHash === null) {
      ensureCredentialRowExists(actor.id);
      const failure = recordCredentialFailure(ip, actor.id, passkeyFailureMessage, "adult_unlock");
      countUnlock("wrong"); return c.json(failure.body, 401);
    }
    verified = await verifyAgainstRecord(ip, actor.id, { secretHash: record.secretHash, lockedUntil: lockout?.lockedUntil ?? null }, secret!, "Invalid PIN or password", "adult_unlock");
  }
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
  request: { body: { content: { "application/json": { schema: ConfirmBody } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ticket: z.string(), expires_in: z.number() }) } }, description: "Single use, bound to this item and this session. A live unlock proof does not replace it." },
    ...errorResponses({ 400: "No passcode is set", 401: "Wrong passcode", 403: "Not an adult's own screen", 429: "Too many attempts" }),
  },
});
adultLockRoutes.openapi(confirmRoute, async (c) => {
  const actor = c.get("person");
  const screen = ownScreen(c, actor);
  if (!screen.ok) return c.json({ error: SHARED_SCREEN_LINE }, 403);
  const { secret, passkey_assertion, item } = c.req.valid("json");
  const ip = getClientIp(c);
  const throttled = throttleCheck(ip);
  if (throttled.blocked) { countUnlock("locked_out"); return c.json({ error: "Too many attempts", retryAfter: throttled.retryAfter }, 429); }
  const lockout = currentLockout(actor.id, "adult_unlock");
  if (lockout?.lockedUntil && new Date(lockout.lockedUntil).getTime() > Date.now()) {
    const retryAfter = Math.ceil((new Date(lockout.lockedUntil).getTime() - Date.now()) / 1000);
    countUnlock("locked_out"); return c.json({ error: "Too many attempts", retryAfter }, 429);
  }
  let verified: Awaited<ReturnType<typeof verifyAgainstRecord>>;
  if (passkey_assertion) {
    const hasPasskey = db.select({ id: passkeyCredentials.id }).from(passkeyCredentials).where(eq(passkeyCredentials.personId, actor.id)).get();
    if (!hasPasskey) return c.json({ error: NO_SECRET_LINE }, 400);
    const result = await verifyAuthentication(actor.id, passkey_assertion as AuthenticationResponseJSON);
    if (!result.ok) {
      // An expired or unknown challenge is not a wrong guess (another request can overwrite the person's pending challenge): it counts toward nothing.
      if (result.code !== "passkey_verify_failed") return c.json({ error: PASSKEY_RETRY_LINE }, 401);
      ensureCredentialRowExists(actor.id);
      const failure = recordCredentialFailure(ip, actor.id, passkeyFailureMessage, "adult_unlock");
      countUnlock("wrong"); return c.json(failure.body, 401);
    }
    verified = { ok: true };
  } else {
    const record = db.select().from(personCredentials).where(eq(personCredentials.personId, actor.id)).get();
    const hasPasskey = db.select({ id: passkeyCredentials.id }).from(passkeyCredentials).where(eq(passkeyCredentials.personId, actor.id)).get();
    if ((!record || record.secretHash === null) && !hasPasskey) return c.json({ error: NO_SECRET_LINE }, 400);
    if (!record || record.secretHash === null) {
      ensureCredentialRowExists(actor.id);
      const failure = recordCredentialFailure(ip, actor.id, passkeyFailureMessage, "adult_unlock");
      countUnlock("wrong"); return c.json(failure.body, 401);
    }
    verified = await verifyAgainstRecord(ip, actor.id, { secretHash: record.secretHash, lockedUntil: lockout?.lockedUntil ?? null }, secret!, "Invalid PIN or password", "adult_unlock");
  }
  if (!verified.ok) { countUnlock(verified.status === 429 ? "locked_out" : "wrong"); return c.json(verified.body, verified.status); }
  clearFailedAttempts(actor.id, "adult_unlock");
  return c.json(issueTicket(actor.id, screen.sessionKey, item), 200);
});
