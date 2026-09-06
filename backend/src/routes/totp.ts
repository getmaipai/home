// Session F, step 6: optional TOTP for owner and admin only (platform
// plan 4.1). Not in wave-2's F-to-E route contract by name (only
// devices/sessions/passkeys are), but named in the step's own text and
// BACKLOG.md - a small, self-contained addition on top of the required
// surface, gated to the two roles the plan actually asks for.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { beginEnrollment, verifyEnrollment, verifyTotp, isTotpEnabled, disableTotp } from "@/lib/totp";
import { issueSession } from "@/lib/session";
import { getClientIp, throttleCheck, throttleFail, throttleReset } from "@/lib/secretThrottle";
import { recordFailedAttempt, clearFailedAttempts, ensureCredentialRowExists, currentLockout, LOCKOUT_THRESHOLD } from "@/lib/credentialLockout";

export const totpRoutes = apiRouter();

// The follow-up to a PIN/password or passkey sign-in that returned
// totpRequired: true (routes/auth.ts's /verify-secret, routes/passkeys.ts's
// /authenticate/verify) - public, the same reason those are: a person
// hasn't finished signing in yet at the moment they're entering their
// second factor.
//
// A code review (2026-09-06) found this route callable standalone, cold,
// with no PIN/password/passkey ever verified first - personId is
// discoverable via the public GET /api/auth/profiles, so with only
// per-IP throttling protecting it, an attacker could brute-force the
// 6-digit code across rotating IPs. The same shared per-person lockout
// (lib/credentialLockout.ts) every primary-factor ceremony uses is
// applied here too, keyed on personId directly - this route is reachable
// on its own, so it needs its own guess-limiting, not just a comment
// assuming an earlier step already provided it.
const challengeRoute = createRoute({
  method: "post",
  path: "/challenge",
  tags: ["TOTP"],
  summary: "Finish signing in with a TOTP code",
  request: { body: { content: { "application/json": { schema: z.object({ personId: z.string(), token: z.string().min(6).max(6) }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "A session cookie is now set." },
    ...errorResponses({ 401: "Wrong code", 429: "Too many attempts" }),
  },
});
totpRoutes.openapi(challengeRoute, (c) => {
  const { personId, token } = c.req.valid("json");
  const ip = getClientIp(c);
  const throttled = throttleCheck(ip);
  if (throttled.blocked) return c.json({ error: "Too many attempts", retryAfter: throttled.retryAfter }, 429);
  const lockout = currentLockout(personId);
  if (lockout?.lockedUntil && new Date(lockout.lockedUntil).getTime() > Date.now()) {
    const retryAfter = Math.ceil((new Date(lockout.lockedUntil).getTime() - Date.now()) / 1000);
    return c.json({ error: "Too many attempts", retryAfter }, 429);
  }

  if (!verifyTotp(personId, token)) {
    throttleFail(ip);
    ensureCredentialRowExists(personId);
    const { failedAttempts } = recordFailedAttempt(personId);
    return c.json({ error: "That code didn't match.", attemptsLeft: Math.max(0, LOCKOUT_THRESHOLD - failedAttempts) }, 401);
  }
  throttleReset(ip);
  clearFailedAttempts(personId);
  issueSession(c, personId);
  return c.json({ success: true as const }, 200);
});

const enrollRoute = createRoute({
  method: "post",
  path: "/enroll",
  tags: ["TOTP"],
  summary: "Start (or restart) TOTP enrollment - owner/admin only",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ uri: z.string() }) } },
      description: "An otpauth:// URI - render as a QR code. Not usable to sign in until POST /verify confirms a real generated code.",
    },
  },
});
totpRoutes.openapi(enrollRoute, (c) => {
  const actor = c.get("person");
  const { uri } = beginEnrollment(actor.id, actor.displayName);
  return c.json({ uri }, 200);
});

const verifyRoute = createRoute({
  method: "post",
  path: "/verify",
  tags: ["TOTP"],
  summary: "Confirm enrollment with a real generated code",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: z.object({ token: z.string().min(6).max(6) }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "TOTP is now required at sign-in." },
    ...errorResponses({ 400: "Wrong code, or no enrollment in progress" }),
  },
});
totpRoutes.openapi(verifyRoute, (c) => {
  const actor = c.get("person");
  const { token } = c.req.valid("json");
  if (!verifyEnrollment(actor.id, token)) return c.json({ error: "That code didn't match. Check your authenticator app's time and try again." }, 400);
  return c.json({ success: true as const }, 200);
});

const statusRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["TOTP"],
  summary: "Whether TOTP is enabled for my own profile",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ enabled: z.boolean() }) } }, description: "True only once enrollment has been confirmed." },
  },
});
totpRoutes.openapi(statusRoute, (c) => {
  const actor = c.get("person");
  return c.json({ enabled: isTotpEnabled(actor.id) }, 200);
});

const disableRoute = createRoute({
  method: "post",
  path: "/disable",
  tags: ["TOTP"],
  summary: "Turn off TOTP for my own profile",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "TOTP is no longer required at sign-in." },
  },
});
totpRoutes.openapi(disableRoute, (c) => {
  const actor = c.get("person");
  disableTotp(actor.id);
  return c.json({ success: true as const }, 200);
});
