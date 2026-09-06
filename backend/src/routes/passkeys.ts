// Session F, step 6: passkeys (wave-2's F-to-E contract: "POST
// /api/auth/passkeys/register/{options,verify} and .../authenticate/
// {options,verify}"). Registration is self-service on an already-signed-in
// profile (lib/passkeys.ts's own header explains why); authentication is
// public, the same reason /verify-secret is - a person hasn't signed in
// yet at the moment they're proving who they are.
import { createRoute, z } from "@hono/zod-openapi";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { issueSession } from "@/lib/session";
import { getClientIp, throttleCheck, throttleFail, throttleReset } from "@/lib/secretThrottle";
import { tryConsume } from "@/lib/rateLimiter";
import { recordFailedAttempt, clearFailedAttempts, ensureCredentialRowExists, currentLockout, LOCKOUT_THRESHOLD } from "@/lib/credentialLockout";
import { registrationOptions, verifyRegistration, authenticationOptions, verifyAuthentication, listPasskeys, deletePasskey } from "@/lib/passkeys";
import { isTotpEnabled } from "@/lib/totp";

export const passkeysRoutes = apiRouter();

// The WebAuthn response bodies are opaque JSON from the browser's
// navigator.credentials.{create,get}() - @simplewebauthn/server does the
// real structural verification (and throws on a malformed shape, caught
// below), so this is deliberately loose rather than hand-modeling
// WebAuthn's full nested attestation/assertion shape a second time.
const WebAuthnResponseSchema = z.record(z.string(), z.any());

const registerOptionsRoute = createRoute({
  method: "post",
  path: "/register/options",
  tags: ["Passkeys"],
  summary: "Options for registering a new passkey to my own profile",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.record(z.string(), z.any()) } }, description: "Pass straight to navigator.credentials.create()." },
  },
});
passkeysRoutes.openapi(registerOptionsRoute, async (c) => {
  const actor = c.get("person");
  const options = await registrationOptions(actor.id, actor.displayName);
  return c.json(options, 200);
});

const registerVerifyRoute = createRoute({
  method: "post",
  path: "/register/verify",
  tags: ["Passkeys"],
  summary: "Verify a registration ceremony and save the new passkey",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ response: WebAuthnResponseSchema, name: z.string().min(1).max(60) }),
        },
      },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Saved." },
    ...errorResponses({ 400: "The registration ceremony could not be verified" }),
  },
});
passkeysRoutes.openapi(registerVerifyRoute, async (c) => {
  const actor = c.get("person");
  const { response, name } = c.req.valid("json");
  const result = await verifyRegistration(actor.id, response as RegistrationResponseJSON, name);
  if (!result.ok) return c.json({ error: result.error ?? "Could not verify this passkey." }, 400);
  return c.json({ success: true as const }, 200);
});

const passkeySummaryRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Passkeys"],
  summary: "My own registered passkeys",
  middleware: [requireAuth] as const,
  responses: {
    200: {
      content: { "application/json": { schema: z.array(z.object({ id: z.string(), name: z.string(), createdAt: z.string(), lastUsedAt: z.string().nullable() })) } },
      description: "Never the public key or any WebAuthn internals - just what a person needs to recognize and revoke one.",
    },
  },
});
passkeysRoutes.openapi(passkeySummaryRoute, (c) => {
  const actor = c.get("person");
  return c.json(listPasskeys(actor.id), 200);
});

const deletePasskeyRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Passkeys"],
  summary: "Remove a passkey from my own profile",
  middleware: [requireAuth] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Removed." },
    ...errorResponses({ 404: "No such passkey (or it isn't mine)" }),
  },
});
passkeysRoutes.openapi(deletePasskeyRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  if (!deletePasskey(id, actor.id)) return c.json({ error: "No such passkey" }, 404);
  return c.json({ success: true as const }, 200);
});

const authOptionsRoute = createRoute({
  method: "post",
  path: "/authenticate/options",
  tags: ["Passkeys"],
  summary: "Options for signing in with a passkey",
  request: { body: { content: { "application/json": { schema: z.object({ personId: z.string() }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.record(z.string(), z.any()) } }, description: "Pass straight to navigator.credentials.get()." },
    ...errorResponses({ 404: "No such profile", 429: "Too many attempts" }),
  },
});
// A code review (2026-09-06) found this route unthrottled: options()
// stores a fresh challenge keyed only by personId (lib/passkeys.ts),
// one-shot and OVERWRITING whatever was pending - an attacker who knows
// a victim's personId (discoverable via the public GET /api/auth/profiles)
// could hammer this to keep clobbering their pending challenge, denying
// that person's own concurrent sign-in attempt. secretThrottle's
// throttleCheck()/throttleFail() pair is the wrong tool here - it only
// ever blocks after a WRONG-ANSWER failure elsewhere records one, and
// generating options never fails that way, so checking it alone would
// never actually trip. This needs a straightforward request-volume
// limiter instead (lib/rateLimiter.ts's token bucket, the same one step
// 5's GET /api/setup/ca and Quick Connect's /code use for exactly this
// "too many requests, not too many wrong answers" shape).
const AUTH_OPTIONS_RATE_LIMIT = { capacity: 10, refillPerSecond: 0.5 };

passkeysRoutes.openapi(authOptionsRoute, async (c) => {
  const { personId } = c.req.valid("json");
  if (!tryConsume(`passkey-auth-options:${personId}`, AUTH_OPTIONS_RATE_LIMIT)) {
    return c.json({ error: "Too many requests. Wait a moment and try again." }, 429);
  }

  const person = db.select({ id: people.id }).from(people).where(eq(people.id, personId)).get();
  if (!person) return c.json({ error: "No such profile" }, 404);
  const options = await authenticationOptions(personId);
  return c.json(options, 200);
});

const authVerifyRoute = createRoute({
  method: "post",
  path: "/authenticate/verify",
  tags: ["Passkeys"],
  summary: "Verify a passkey sign-in",
  request: {
    body: { content: { "application/json": { schema: z.object({ personId: z.string(), response: WebAuthnResponseSchema }) } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ success: z.literal(true), totpRequired: z.boolean() }) } },
      description: "A session cookie is set unless totpRequired is true, in which case POST /api/auth/totp/challenge finishes signing in.",
    },
    ...errorResponses({ 401: "Could not verify this passkey", 404: "No such profile", 429: "Too many attempts" }),
  },
});
passkeysRoutes.openapi(authVerifyRoute, async (c) => {
  const { personId, response } = c.req.valid("json");

  // A code review (2026-09-06) found this falling straight into
  // ensureCredentialRowExists(personId) on a verification failure with no
  // check that personId is even real: person_credentials.person_id
  // references people.id (FK enforced), so a probe with a nonexistent
  // personId threw an unhandled SqliteError (a 500) instead of the
  // intended 401/404. Checked first, before any lockout bookkeeping.
  const person = db.select({ id: people.id }).from(people).where(eq(people.id, personId)).get();
  if (!person) return c.json({ error: "No such profile" }, 404);

  // The same shared lockout (lib/credentialLockout.ts) and per-IP
  // throttle a PIN/password ceremony uses (4.1: "rate limits and
  // lockouts apply to PIN, password and passkey ceremonies alike") -
  // checked BEFORE the (more expensive) cryptographic verification, same
  // ordering /verify-secret already uses.
  const ip = getClientIp(c);
  const throttled = throttleCheck(ip);
  if (throttled.blocked) return c.json({ error: "Too many attempts", retryAfter: throttled.retryAfter }, 429);
  const lockout = currentLockout(personId);
  if (lockout?.lockedUntil && new Date(lockout.lockedUntil).getTime() > Date.now()) {
    const retryAfter = Math.ceil((new Date(lockout.lockedUntil).getTime() - Date.now()) / 1000);
    return c.json({ error: "Too many attempts", retryAfter }, 429);
  }

  const result = await verifyAuthentication(personId, response as AuthenticationResponseJSON);
  if (!result.ok) {
    throttleFail(ip);
    ensureCredentialRowExists(personId);
    const { failedAttempts } = recordFailedAttempt(personId);
    return c.json({ error: result.error ?? "Could not verify this passkey.", attemptsLeft: Math.max(0, LOCKOUT_THRESHOLD - failedAttempts) }, 401);
  }

  throttleReset(ip);
  clearFailedAttempts(personId);

  if (isTotpEnabled(personId)) return c.json({ success: true as const, totpRequired: true }, 200);
  issueSession(c, personId);
  return c.json({ success: true as const, totpRequired: false }, 200);
});
