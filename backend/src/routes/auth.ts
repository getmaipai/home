// Session F, step 6: converted to @hono/zod-openapi. A code review
// (2026-09-06) found this file still a plain Hono() router with
// hand-written handlers despite being heavily rewritten in this same
// diff (hasPasskeys/totpRequired fields, rewritten /select, /verify-
// secret, /me, /change-secret) - every other new route file in this
// step already uses the required style (CLAUDE.md: "any route you touch
// gets converted to this style as part of touching it"), and this file's
// new response fields would otherwise be invisible to /api/docs and its
// consumers (Go, Desktop, firmware pods).
import { createRoute, z } from "@hono/zod-openapi";
import { getCookie, deleteCookie } from "hono/cookie";
import { eq, isNull } from "drizzle-orm";
import { Person } from "@maipai/spec/gen/ts/person.js";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { db, sqlite } from "@/db";
import { people, personCredentials, passkeyCredentials, sessions } from "@/db/schema";
import { requiresCredential, getAuthMethods, roleRequiresCredential } from "@/lib/personAuthMethods";
import { isTotpEnabled } from "@/lib/totp";
import { hashSessionToken, issueSession } from "@/lib/session";
import { hashSecret, verifySecret } from "@/lib/secret";
import { recordFailedAttempt, clearFailedAttempts, LOCKOUT_THRESHOLD } from "@/lib/credentialLockout";
import { getClientIp, throttleCheck, throttleFail, throttleReset } from "@/lib/secretThrottle";
import { newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { requireAuth, invalidateSessionCache } from "@/middleware/auth";
import { toRoster, parsePersonCandidate, personToDbValues } from "@/lib/personShape";
import { validateDisplayName, validateSecret } from "@/lib/validation";

export const auth = apiRouter();

const RosterSchema = Person.omit({ birthdate: true }).extend({ hasSecret: z.boolean(), hasPasskeys: z.boolean() });

// Shared by /verify-secret and /change-secret: "prove you know this
// person's current secret" is the identical lockout-check, verify,
// failure-bookkeeping, success-reset sequence either way. A code review
// (2026-09-04) found this duplicated near-verbatim between the two the
// moment a second real consumer (change-secret) needed it - the same
// "extract on the second consumer" pattern lib/access.ts's own header
// comment documents. Callers still run their own IP throttleCheck first
// (not folded in here): verify-secret's real behavior is to check that
// before even confirming the person/record exist, and change-secret's
// record-exists branch needs to decide whether to throttle-check at all
// before this function has anything to verify against.
//
// Returns a plain result rather than calling c.json() itself (a code
// review, 2026-09-06, found the @hono/zod-openapi conversion of this
// file couldn't typecheck a shared helper's Response against each
// route's own distinct declared response union) - each caller builds its
// own c.json(...) from the returned body/status, keeping full type
// safety against that route's own createRoute() schema.
type SecretCheckFailure = { ok: false; status: 401 | 429; body: { error: string; retryAfter?: number; attemptsLeft?: number } };
async function verifyAgainstRecord(
  ip: string,
  personId: string,
  record: { secretHash: string; lockedUntil: string | null },
  providedSecret: string,
  wrongSecretMessage: string,
): Promise<{ ok: true } | SecretCheckFailure> {
  if (record.lockedUntil && new Date(record.lockedUntil).getTime() > Date.now()) {
    const retryAfter = Math.ceil((new Date(record.lockedUntil).getTime() - Date.now()) / 1000);
    return { ok: false, status: 429, body: { error: "Too many attempts", retryAfter } };
  }

  const valid = await verifySecret(providedSecret, record.secretHash);
  if (!valid) {
    throttleFail(ip);
    // Atomic re-read-and-increment (lib/credentialLockout.ts): a code
    // review (2026-09-04) found an earlier inline `record.failedAttempts
    // + 1` used a count read before this function's `await` above, so
    // concurrent requests for the same profile could undercount real
    // attempts.
    const { failedAttempts } = recordFailedAttempt(personId);
    return {
      ok: false,
      status: 401,
      body: { error: wrongSecretMessage, attemptsLeft: Math.max(0, LOCKOUT_THRESHOLD - failedAttempts) },
    };
  }

  throttleReset(ip);
  return { ok: true };
}

// The profile picker: every non-deleted person, never a secret hash, and
// never a birthdate (3.1: core-only). Public (unauthenticated) by design,
// same as the legacy hub's /profiles: the picker has to render before
// anyone is signed in.
const profilesRoute = createRoute({
  method: "get",
  path: "/profiles",
  tags: ["Auth"],
  summary: "The household's profile picker",
  responses: {
    200: { content: { "application/json": { schema: z.array(RosterSchema) } }, description: "Every non-deleted person, no secret hash, no birthdate." },
  },
});
auth.openapi(profilesRoute, (c) => {
  // One query via a left join, not two round trips joined in JS (a code
  // review, 2026-09-04, flagged the old version on this exact point: this
  // is the most frequently hit route in the app, rendered before anyone
  // is signed in). Step 6: secretHash itself (not just row presence) is
  // what says "has a PIN/password" now that a row can exist purely to
  // hold a passkey-only person's lockout counter (personCredentials.
  // secretHash is nullable, see db/schema.ts's own comment) - a second,
  // tiny query for the distinct set of people with any passkey, rather
  // than one passkey lookup per row in a loop.
  const rows = db
    .select({ person: people, secretHash: personCredentials.secretHash })
    .from(people)
    .leftJoin(personCredentials, eq(people.id, personCredentials.personId))
    .where(isNull(people.deletedAt))
    .all();
  const withPasskeys = new Set(db.selectDistinct({ personId: passkeyCredentials.personId }).from(passkeyCredentials).all().map((r) => r.personId));

  return c.json(
    rows.map((r) => ({
      ...toRoster(r.person),
      hasSecret: r.secretHash != null,
      hasPasskeys: withPasskeys.has(r.person.id),
    })),
    200,
  );
});

// First-run only: creates the household owner. Refuses once any person
// exists, so this can never be used to mint a second owner over the
// network (routes/people.ts is the ongoing way to add people).
const setupRoute = createRoute({
  method: "post",
  path: "/setup",
  tags: ["Auth"],
  summary: "First-run: create the household owner",
  request: { body: { content: { "application/json": { schema: z.object({ displayName: z.string(), secret: z.string() }) } } } },
  responses: {
    201: { content: { "application/json": { schema: z.object({ person: Person }) } }, description: "The owner, signed in." },
    ...errorResponses({ 400: "Invalid display name or secret", 409: "Setup already completed" }),
  },
});
// COR-4 (code review, 2026-09-06): check-then-insert with a real await
// (hashSecret's own argon2id work) in between - two concurrent first-run
// POSTs could both pass the "anyone exists" check before either had
// written a row, minting two owners. hashSecret() runs OUTSIDE any
// transaction (sqlite.transaction()'s own callback must be synchronous -
// bun:sqlite, like better-sqlite3, has no async transaction API); the
// existence check is then RE-RUN inside the transaction, atomically with
// both inserts, so a second concurrent caller that raced past the
// route's own first check still finds a real owner already committed by
// the time its own transaction runs.
const insertOwnerIfNoneExists = sqlite.transaction(
  (personValues: ReturnType<typeof personToDbValues>, credentialValues: typeof personCredentials.$inferInsert): boolean => {
    const anyone = db.select({ id: people.id }).from(people).limit(1).get();
    if (anyone) return false;
    db.insert(people).values(personValues).run();
    db.insert(personCredentials).values(credentialValues).run();
    return true;
  },
);

auth.openapi(setupRoute, async (c) => {
  const anyone = db.select({ id: people.id }).from(people).limit(1).get();
  if (anyone) return c.json({ error: "Setup already completed" }, 409);

  const body = c.req.valid("json");
  const displayName = validateDisplayName(body.displayName);
  if (!displayName.ok) return c.json({ error: displayName.error }, 400);
  const secret = validateSecret(body.secret);
  if (!secret.ok) return c.json({ error: secret.error }, 400);

  const now = new Date().toISOString();
  const id = newPersonId();

  // Validate the full candidate against the spec BEFORE writing (the same
  // discipline lib/memory.ts's remember() uses): a code review
  // (2026-09-04) found the previous version of this route inserting
  // unvalidated fields straight into SQLite.
  const candidate = parsePersonCandidate({
    id,
    display_name: displayName.value,
    nickname: null,
    birthdate: null,
    role: "owner",
    avatar_seed: id,
    source: "hub",
    local_only: false,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    hlc: nextHlc(),
  });
  if (!candidate.success) {
    return c.json({ error: candidate.error.issues.map((i) => i.message).join("; ") }, 400);
  }

  // hashSecret() (argon2id) happens before the transaction, not inside
  // it - see insertOwnerIfNoneExists's own header for why.
  const secretHash = await hashSecret(secret.value);
  const created = insertOwnerIfNoneExists(personToDbValues(candidate.data), {
    personId: id,
    secretHash,
    failedAttempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  if (!created) return c.json({ error: "Setup already completed" }, 409);

  issueSession(c, id);
  return c.json({ person: candidate.data }, 201);
});

// Select a secret-free profile (4.1: a child's picker entry can be a bare
// tap). Refused for anyone who has a credential on record; use
// /verify-secret for those.
const selectRoute = createRoute({
  method: "post",
  path: "/select",
  tags: ["Auth"],
  summary: "Sign in to a credential-free profile with a bare tap",
  request: { body: { content: { "application/json": { schema: z.object({ personId: z.string() }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Signed in." },
    ...errorResponses({ 400: "This profile needs its PIN, password, or passkey", 404: "Profile not found" }),
  },
});
auth.openapi(selectRoute, (c) => {
  const { personId } = c.req.valid("json");

  const person = db.select().from(people).where(eq(people.id, personId)).get();
  if (!person || person.deletedAt || !person.enabled) return c.json({ error: "Profile not found" }, 404);

  // Step 6: a passkey-only profile must be refused a bare-tap sign-in
  // exactly like a PIN/password one - requiresCredential() checks both
  // personCredentials.secretHash and passkeyCredentials, not just
  // whether a personCredentials row exists (one can now exist purely to
  // hold a passkey-only person's shared lockout counter).
  //
  // roleRequiresCredential() (issues #35/#47 plus the review that found
  // applyAgeBandChanges() bypassing every route-level guard) is checked
  // here too, not just whichever credential happens to exist YET: an
  // owner/admin/adult profile that somehow ended up with none - the
  // exact state the age-band sweep could otherwise produce - must be
  // refused a bare tap rather than silently getting the exact "no
  // credential at all" treatment this route exists to gate.
  if (requiresCredential(personId) || roleRequiresCredential(person.role)) {
    return c.json({ error: "This profile needs its PIN, password, or passkey" }, 400);
  }

  issueSession(c, personId);
  return c.json({ success: true as const }, 200);
});

// Select a secret-protected profile.
const verifySecretRoute = createRoute({
  method: "post",
  path: "/verify-secret",
  tags: ["Auth"],
  summary: "Sign in with a PIN or password",
  request: { body: { content: { "application/json": { schema: z.object({ personId: z.string(), secret: z.string() }) } } } },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ success: z.literal(true), totpRequired: z.boolean() }) } },
      description: "totpRequired: true means no session cookie yet - POST /api/auth/totp/challenge finishes signing in.",
    },
    ...errorResponses({ 400: "No PIN or password set for this profile", 401: "Invalid PIN or password", 404: "Profile not found", 429: "Too many attempts" }),
  },
});
auth.openapi(verifySecretRoute, async (c) => {
  const { personId, secret } = c.req.valid("json");

  const ip = getClientIp(c);
  const throttled = throttleCheck(ip);
  if (throttled.blocked) {
    return c.json({ error: "Too many attempts", retryAfter: throttled.retryAfter }, 429);
  }

  // A code review (2026-09-04) found this route never checked
  // people.deletedAt, unlike /select and /profiles: a soft-deleted
  // person's credentials would keep working. No route in this slice sets
  // deletedAt yet (delete-person is deferred, see docs/dev.md), but the
  // check is added now so the invariant already holds when one lands.
  const person = db.select().from(people).where(eq(people.id, personId)).get();
  if (!person || person.deletedAt || !person.enabled) return c.json({ error: "Profile not found" }, 404);

  const record = db
    .select()
    .from(personCredentials)
    .where(eq(personCredentials.personId, personId))
    .get();
  // secretHash nullable as of step 6 (a passkey-only person's row holds
  // only their shared lockout counter) - null reads the same as "no row"
  // for THIS route's purposes, since there's no PIN/password to verify.
  if (!record || record.secretHash === null) return c.json({ error: "No PIN or password set for this profile" }, 400);

  const verified = await verifyAgainstRecord(ip, personId, { secretHash: record.secretHash, lockedUntil: record.lockedUntil }, secret, "Invalid PIN or password");
  if (!verified.ok) return c.json(verified.body, verified.status);

  clearFailedAttempts(personId);

  // Step 6: optional TOTP for owner/admin - a second factor delays the
  // session, it never replaces the PIN/password check above. POST
  // /api/auth/totp/challenge is the follow-up that actually issues the
  // session once the code checks out.
  if (isTotpEnabled(personId)) return c.json({ success: true as const, totpRequired: true }, 200);

  issueSession(c, personId);
  return c.json({ success: true as const, totpRequired: false }, 200);
});

const meRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Auth"],
  summary: "My own profile",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: RosterSchema } }, description: "The signed-in person." },
  },
});
auth.openapi(meRoute, (c) => {
  const person = c.get("person");
  const { hasSecret, hasPasskeys } = getAuthMethods(person.id);
  return c.json({ ...toRoster(person), hasSecret, hasPasskeys }, 200);
});

// A person changing (or, for a PIN-free profile, first setting) their own
// PIN or password. Never another person's: routes/people.ts has no
// edit-person route yet (docs/dev.md's own deferred list), and this
// isn't that - self-service only, requireAuth's actor is always the
// target. Reuses /verify-secret's exact throttle/lockout shape (both the
// per-profile exponential backoff and the per-IP throttle) for the
// current-secret check: a stolen session cookie alone must not be enough
// to silently lock a family member out of their own profile by racing
// guesses at their current PIN.
const changeSecretRoute = createRoute({
  method: "post",
  path: "/change-secret",
  tags: ["Auth"],
  summary: "Change (or first set) my own PIN or password",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ currentSecret: z.string().optional(), newSecret: z.string() }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Changed." },
    ...errorResponses({ 400: "Invalid secret, or currentSecret is required", 401: "Current PIN or password is incorrect", 429: "Too many attempts" }),
  },
});
auth.openapi(changeSecretRoute, async (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  const newSecret = validateSecret(body.newSecret);
  if (!newSecret.ok) return c.json({ error: newSecret.error }, 400);

  const record = db
    .select()
    .from(personCredentials)
    .where(eq(personCredentials.personId, actor.id))
    .get();

  // secretHash nullable as of step 6: a passkey-only person's row (kept
  // only for their shared lockout counter) reads the same as "no
  // existing credential" here - nothing to verify a currentSecret
  // against, same as a truly PIN-free profile setting one for the first
  // time.
  if (record && record.secretHash !== null) {
    if (!body.currentSecret) return c.json({ error: "currentSecret is required" }, 400);

    const ip = getClientIp(c);
    const throttled = throttleCheck(ip);
    if (throttled.blocked) {
      return c.json({ error: "Too many attempts", retryAfter: throttled.retryAfter }, 429);
    }

    const verified = await verifyAgainstRecord(
      ip,
      actor.id,
      { secretHash: record.secretHash, lockedUntil: record.lockedUntil },
      body.currentSecret,
      "Current PIN or password is incorrect",
    );
    if (!verified.ok) return c.json(verified.body, verified.status);
  }

  const now = new Date().toISOString();
  const secretHash = await hashSecret(newSecret.value);
  // A single atomic upsert, not a read-branched insert-or-update: a code
  // review (2026-09-04) found the earlier version raced on a PIN-free
  // profile (personId is the primary key) - two concurrent requests with
  // no currentSecret could both see `record` as absent and both attempt
  // an INSERT, the second failing with a primary-key violation instead of
  // the intended idempotent "set the PIN" outcome.
  db.insert(personCredentials)
    .values({ personId: actor.id, secretHash, failedAttempts: 0, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: personCredentials.personId,
      set: { secretHash, failedAttempts: 0, lockedUntil: null, updatedAt: now },
    })
    .run();

  return c.json({ success: true as const }, 200);
});

const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  tags: ["Auth"],
  summary: "Sign out this session",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Signed out." },
  },
});
auth.openapi(logoutRoute, (c) => {
  const token = getCookie(c, "session");
  if (token) {
    db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token))).run();
    invalidateSessionCache(token);
  }
  deleteCookie(c, "session", { path: "/" });
  return c.json({ success: true as const }, 200);
});
