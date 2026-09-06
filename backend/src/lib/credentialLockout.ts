// Rate limits and lockouts shared across every way a person proves who
// they are - PIN, password, and passkey ceremonies alike (session-f-
// platform-and-trust.md step 6: "lockout rules shared with PIN and
// password"). One row per person on person_credentials (moved here from
// lib/secret.ts, which stays focused on hashing) - a shared counter
// rather than one lockout table per credential type, because the threat
// this defends against (someone hammering a profile trying to get in) is
// the same regardless of which ceremony they're attempting, and a person
// switching between "try my PIN" and "try my passkey" shouldn't reset
// the count either way lets them try.
//
// person_credentials.secretHash is nullable (a passkey-only person has
// no PIN/password at all) - this module never touches that column, only
// failedAttempts/lockedUntil, so it works identically whether or not a
// secret is set.
import { sqlite } from "@/db";
import { db } from "@/db";
import { personCredentials } from "@/db/schema";
import { eq } from "drizzle-orm";

// Exponential backoff once a profile crosses the failed-attempt
// threshold: 30s, 2m, 10m, 1h. 4.1: "Rate limits and lockouts apply to
// PIN, password and passkey ceremonies alike."
export const LOCKOUT_THRESHOLD = 5;

// Contract: only meaningful for failedAttempts >= LOCKOUT_THRESHOLD (the
// only way a caller reaches it). A code review (2026-09-04) found a
// defensive `Math.max(0, index)` clamp here that could never fire at the
// real call site, masking a test that claimed to prove "stays at zero
// below the threshold" while actually just exercising the dead clamp.
// Removed rather than kept "for safety": a clamp that hides an
// out-of-contract call is worse than letting it throw, per the org
// testing standard ("a test asserts behavior a person cares about").
export function lockoutDurationMs(failedAttempts: number): number {
  const backoffs = [30_000, 120_000, 600_000, 3_600_000];
  const index = Math.min(failedAttempts - LOCKOUT_THRESHOLD, backoffs.length - 1);
  return backoffs[index] ?? 3_600_000;
}

interface FailedAttemptResult {
  failedAttempts: number;
  lockedUntil: string | null;
}

/** Ensures a person_credentials row exists for `personId` with no PIN or
 * password set, so a passkey-only enrollment has somewhere to keep its
 * shared lockout counter. A no-op if a row (with or without a secret)
 * already exists. */
export function ensureCredentialRowExists(personId: string): void {
  const now = new Date().toISOString();
  db.insert(personCredentials)
    .values({ personId, secretHash: null, failedAttempts: 0, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: personCredentials.personId })
    .run();
}

export function clearFailedAttempts(personId: string): void {
  db.update(personCredentials)
    .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date().toISOString() })
    .where(eq(personCredentials.personId, personId))
    .run();
}

export function currentLockout(personId: string): { failedAttempts: number; lockedUntil: string | null } | null {
  const row = db
    .select({ failedAttempts: personCredentials.failedAttempts, lockedUntil: personCredentials.lockedUntil })
    .from(personCredentials)
    .where(eq(personCredentials.personId, personId))
    .get();
  return row ?? null;
}

// Atomic read-modify-write for the failed-attempt counter. A code review
// (2026-09-04) found routes/auth.ts computing `record.failedAttempts + 1`
// from a value read BEFORE the async Argon2id verify: two concurrent
// /verify-secret requests for the same profile both read the same stale
// count, both write the same incremented value, and the counter
// undercounts real attempts across a race. This function re-reads inside
// a synchronous bun:sqlite transaction (no `await` inside it, so nothing
// else can interleave, the same technique lib/memoryId.ts's `nextSeq`
// already uses), taking the fresh count at write time instead of trusting
// a value read before the async gap. ensureCredentialRowExists() must be
// called first for a person with no PIN/password/passkey row yet - this
// function's UPDATE is a no-op against a row that doesn't exist.
export const recordFailedAttempt = sqlite.transaction((personId: string): FailedAttemptResult => {
  const row = sqlite
    .query("SELECT failed_attempts FROM person_credentials WHERE person_id = ?")
    .get(personId) as { failed_attempts: number } | undefined;
  const failedAttempts = (row?.failed_attempts ?? 0) + 1;
  const lockedUntil =
    failedAttempts >= LOCKOUT_THRESHOLD
      ? new Date(Date.now() + lockoutDurationMs(failedAttempts)).toISOString()
      : null;
  sqlite
    .query(
      "UPDATE person_credentials SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE person_id = ?",
    )
    .run(failedAttempts, lockedUntil, new Date().toISOString(), personId);
  return { failedAttempts, lockedUntil };
});
