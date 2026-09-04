import { Hono, type Context } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { people, personCredentials, sessions } from "@/db/schema";
import { hashSessionToken, issueSession } from "@/lib/session";
import { hashSecret, verifySecret, recordFailedAttempt, LOCKOUT_THRESHOLD } from "@/lib/secret";
import {
  getClientIp,
  throttleCheck,
  throttleFail,
  throttleReset,
} from "@/lib/secretThrottle";
import { newPersonId } from "@/lib/id";
import { requireAuth, invalidateSessionCache } from "@/middleware/auth";
import { toRoster, parsePersonCandidate, personToDbValues } from "@/lib/personShape";
import { validateDisplayName, validateSecret } from "@/lib/validation";
import type { AppEnv } from "@/types";

export const auth = new Hono<AppEnv>();

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
async function verifyAgainstRecord(
  c: Context<AppEnv>,
  ip: string,
  personId: string,
  record: { secretHash: string; lockedUntil: string | null },
  providedSecret: string,
  wrongSecretMessage: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (record.lockedUntil && new Date(record.lockedUntil).getTime() > Date.now()) {
    const retryAfter = Math.ceil((new Date(record.lockedUntil).getTime() - Date.now()) / 1000);
    return { ok: false, response: c.json({ error: "Too many attempts", retryAfter }, 429) };
  }

  const valid = await verifySecret(providedSecret, record.secretHash);
  if (!valid) {
    throttleFail(ip);
    // Atomic re-read-and-increment (lib/secret.ts): a code review
    // (2026-09-04) found an earlier inline `record.failedAttempts + 1`
    // used a count read before this function's `await` above, so
    // concurrent requests for the same profile could undercount real
    // attempts.
    const { failedAttempts } = recordFailedAttempt(personId);
    return {
      ok: false,
      response: c.json(
        { error: wrongSecretMessage, attemptsLeft: Math.max(0, LOCKOUT_THRESHOLD - failedAttempts) },
        401,
      ),
    };
  }

  throttleReset(ip);
  return { ok: true };
}

// The profile picker: every non-deleted person, never a secret hash, and
// never a birthdate (3.1: core-only). Public (unauthenticated) by design,
// same as the legacy hub's /profiles: the picker has to render before
// anyone is signed in.
auth.get("/profiles", async (c) => {
  // One query via a left join, not two round trips joined in JS (a code
  // review, 2026-09-04, flagged the old version on this exact point: this
  // is the most frequently hit route in the app, rendered before anyone
  // is signed in).
  const rows = db
    .select({ person: people, credentialPersonId: personCredentials.personId })
    .from(people)
    .leftJoin(personCredentials, eq(people.id, personCredentials.personId))
    .where(isNull(people.deletedAt))
    .all();

  return c.json(
    rows.map((r) => ({ ...toRoster(r.person), hasSecret: r.credentialPersonId !== null })),
  );
});

// First-run only: creates the household owner. Refuses once any person
// exists, so this can never be used to mint a second owner over the
// network (routes/people.ts is the ongoing way to add people).
auth.post("/setup", async (c) => {
  const anyone = db.select({ id: people.id }).from(people).limit(1).get();
  if (anyone) return c.json({ error: "Setup already completed" }, 409);

  const body = (await c.req.json().catch(() => ({}))) as {
    displayName?: string;
    secret?: string;
  };
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
  });
  if (!candidate.success) {
    return c.json({ error: candidate.error.issues.map((i) => i.message).join("; ") }, 400);
  }

  db.insert(people).values(personToDbValues(candidate.data)).run();
  db.insert(personCredentials)
    .values({
      personId: id,
      secretHash: await hashSecret(secret.value),
      failedAttempts: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  issueSession(c, id);
  return c.json({ person: candidate.data }, 201);
});

// Select a secret-free profile (4.1: a child's picker entry can be a bare
// tap). Refused for anyone who has a credential on record; use
// /verify-secret for those.
auth.post("/select", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { personId?: string };
  const personId = body.personId;
  if (!personId) return c.json({ error: "personId is required" }, 400);

  const person = db.select().from(people).where(eq(people.id, personId)).get();
  if (!person || person.deletedAt) return c.json({ error: "Profile not found" }, 404);

  const cred = db
    .select({ personId: personCredentials.personId })
    .from(personCredentials)
    .where(eq(personCredentials.personId, personId))
    .get();
  if (cred) return c.json({ error: "This profile needs its PIN or password" }, 400);

  issueSession(c, personId);
  return c.json({ success: true });
});

// Select a secret-protected profile.
auth.post("/verify-secret", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    personId?: string;
    secret?: string;
  };
  const { personId, secret } = body;
  if (!personId || !secret) {
    return c.json({ error: "personId and secret are required" }, 400);
  }

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
  if (!person || person.deletedAt) return c.json({ error: "Profile not found" }, 404);

  const record = db
    .select()
    .from(personCredentials)
    .where(eq(personCredentials.personId, personId))
    .get();
  if (!record) return c.json({ error: "No PIN or password set for this profile" }, 400);

  const verified = await verifyAgainstRecord(c, ip, personId, record, secret, "Invalid PIN or password");
  if (!verified.ok) return verified.response;

  db.update(personCredentials)
    .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date().toISOString() })
    .where(eq(personCredentials.personId, personId))
    .run();

  issueSession(c, personId);
  return c.json({ success: true });
});

auth.get("/me", requireAuth, async (c) => {
  const person = c.get("person");
  const cred = db
    .select({ personId: personCredentials.personId })
    .from(personCredentials)
    .where(eq(personCredentials.personId, person.id))
    .get();
  return c.json({ ...toRoster(person), hasSecret: !!cred });
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
auth.post("/change-secret", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as {
    currentSecret?: string;
    newSecret?: string;
  };
  const newSecret = validateSecret(body.newSecret);
  if (!newSecret.ok) return c.json({ error: newSecret.error }, 400);

  const record = db
    .select()
    .from(personCredentials)
    .where(eq(personCredentials.personId, actor.id))
    .get();

  if (record) {
    if (!body.currentSecret) return c.json({ error: "currentSecret is required" }, 400);

    const ip = getClientIp(c);
    const throttled = throttleCheck(ip);
    if (throttled.blocked) {
      return c.json({ error: "Too many attempts", retryAfter: throttled.retryAfter }, 429);
    }

    const verified = await verifyAgainstRecord(
      c,
      ip,
      actor.id,
      record,
      body.currentSecret,
      "Current PIN or password is incorrect",
    );
    if (!verified.ok) return verified.response;
  }
  // else: no existing credential (a PIN-free profile adding one for the
  // first time) - nothing to verify against.

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

  return c.json({ success: true });
});

auth.post("/logout", requireAuth, async (c) => {
  const token = getCookie(c, "session");
  if (token) {
    db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token))).run();
    invalidateSessionCache(token);
  }
  deleteCookie(c, "session", { path: "/" });
  return c.json({ success: true });
});
