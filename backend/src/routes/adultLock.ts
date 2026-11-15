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
import { scanAutoLocks, clearAutoLocks, undoCleanup, latestCleanup } from "@/lib/adultLockCleanup";
import { randomUUID } from "node:crypto";

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

const CleanupError = z.object({ error: z.string(), code: z.string() });
const cleanupDenied = { error: "Only the household owner can clear automatic locks. Ask the owner to open Settings and try again.", code: "owner_only" };
const cleanupOwner = (actor: PersonRow) => actor.role === "owner";
const autoLocksRoute = createRoute({
  method: "get", path: "/auto-locks", tags: ["Adult lock"], summary: "Count pictures Home locked automatically that the owner can clear", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ candidates: z.number(), left_alone: z.object({ notLocked: z.number(), otherKind: z.number(), minorOwner: z.number(), personSet: z.number(), adultStyle: z.number(), labelledSource: z.number(), notSure: z.number() }), last_run: z.object({ id: z.string(), at: z.string(), changed: z.number(), undone: z.boolean() }).nullable() }) } }, description: "Counts only. No item identifiers." }, 403: { content: { "application/json": { schema: CleanupError } }, description: "Household owner only." } },
});
adultLockRoutes.openapi(autoLocksRoute, async (c) => {
  if (!cleanupOwner(c.get("person"))) return c.json(cleanupDenied, 403);
  const scan = await scanAutoLocks();
  return c.json({ candidates: scan.candidates.length, left_alone: scan.counts, last_run: latestCleanup() }, 200);
});

const ClearBody = z.object({ expected: z.number().int().nonnegative() });
const clearAutoLocksRoute = createRoute({
  method: "post", path: "/auto-locks/clear", tags: ["Adult lock"], summary: "Clear automatic locks after confirming the count", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: ClearBody } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ run_id: z.string(), changed: z.number() }) } }, description: "Cleanup complete." }, 403: { content: { "application/json": { schema: CleanupError } }, description: "Household owner only." }, 409: { content: { "application/json": { schema: CleanupError } }, description: "Count changed or nothing needs clearing." }, 500: { content: { "application/json": { schema: CleanupError } }, description: "Cleanup could not be completed." } },
});
adultLockRoutes.openapi(clearAutoLocksRoute, async (c) => {
  const actor = c.get("person");
  if (!cleanupOwner(actor)) return c.json(cleanupDenied, 403);
  const { expected } = c.req.valid("json");
  try {
    const scan = await scanAutoLocks();
    if (scan.candidates.length !== expected) return c.json({ error: "The number changed. Look again and confirm.", code: "count_changed" }, 409);
    if (!scan.candidates.length) return c.json({ error: "Nothing needs clearing. No picture was locked by the app on its own.", code: "nothing_to_clear" }, 409);
    const runId = `cleanup-${randomUUID()}`;
    const result = await clearAutoLocks({ runId, byPersonId: actor.id, expected });
    return c.json({ run_id: runId, changed: result.changed }, 200);
  } catch (error) {
    const status = (error as { status?: number }).status;
    const code = (error as { code?: string }).code;
    if (status === 409 && code === "count_changed") return c.json({ error: "The number changed. Look again and confirm.", code }, 409);
    if (status === 409 && code === "nothing_to_clear") return c.json({ error: "Nothing needs clearing. No picture was locked by the app on its own.", code }, 409);
    return c.json({ error: "The cleanup could not be saved. Look again and try once more.", code: "cleanup_failed" }, 500);
  }
});

const UndoBody = z.object({ run_id: z.string().regex(/^cleanup-[a-f0-9-]{36}$/) });
const undoAutoLocksRoute = createRoute({
  method: "post", path: "/auto-locks/undo", tags: ["Adult lock"], summary: "Undo one automatic lock cleanup", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: UndoBody } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ restored: z.number(), changed_since: z.number() }) } }, description: "Restoration counts." }, 403: { content: { "application/json": { schema: CleanupError } }, description: "Household owner only." }, 404: { content: { "application/json": { schema: CleanupError } }, description: "Run not found." }, 409: { content: { "application/json": { schema: CleanupError } }, description: "Run already undone." }, 500: { content: { "application/json": { schema: CleanupError } }, description: "Undo could not be completed." } },
});
adultLockRoutes.openapi(undoAutoLocksRoute, async (c) => {
  if (!cleanupOwner(c.get("person"))) return c.json(cleanupDenied, 403);
  const { run_id } = c.req.valid("json");
  try {
    const result = await undoCleanup(run_id);
    return c.json({ restored: result.restored, changed_since: result.changed_since }, 200);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const code = (error as { code?: string }).code ?? "undo_failed";
    const message = error instanceof Error ? error.message : "Undo could not be completed. Look again and try once more.";
    return c.json({ error: message, code }, status as 404 | 409 | 500);
  }
});
