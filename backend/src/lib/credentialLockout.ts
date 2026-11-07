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
import { createThrottle } from "@maipai/core/src/secretThrottle";

// Exponential backoff once a profile crosses the failed-attempt
// threshold: 30s, 2m, 10m, 1h. 4.1: "Rate limits and lockouts apply to
// PIN, password and passkey ceremonies alike."
export const LOCKOUT_THRESHOLD = 5;
export const PROFILE_SIGNIN_LOCKOUT_THRESHOLD = 25;
const signinAddressThrottle = createThrottle({ maxFails: LOCKOUT_THRESHOLD, windowMs: 30_000 });
const signinAddressFailures = new Map<string, number>();
const signinAddressLockedUntil = new Map<string, number>();
const MAX_SIGNIN_ADDRESS_BUCKETS = 5_000;

export function checkSigninAddress(ip: string, personId: string): { blocked: boolean; retryAfter: number; attemptsLeft: number } {
  const key = `signin:${personId}:${ip}`;
  const lockedUntil = signinAddressLockedUntil.get(key) ?? 0;
  if (lockedUntil > Date.now()) return { blocked: true, retryAfter: Math.ceil((lockedUntil - Date.now()) / 1000), attemptsLeft: Math.max(0, LOCKOUT_THRESHOLD - (signinAddressFailures.get(key) ?? 0)) };
  const checked = signinAddressThrottle.check(key);
  return { ...checked, attemptsLeft: Math.max(0, LOCKOUT_THRESHOLD - (signinAddressFailures.get(key) ?? 0)) };
}

export function failSigninAddress(ip: string, personId: string): number {
  const key = `signin:${personId}:${ip}`;
  if (!signinAddressFailures.has(key) && signinAddressFailures.size >= MAX_SIGNIN_ADDRESS_BUCKETS) {
    const oldest = signinAddressFailures.keys().next().value;
    if (oldest) { signinAddressFailures.delete(oldest); signinAddressLockedUntil.delete(oldest); }
  }
  const attempts = (signinAddressFailures.get(key) ?? 0) + 1;
  signinAddressFailures.set(key, attempts);
  signinAddressThrottle.fail(key);
  if (attempts >= LOCKOUT_THRESHOLD) signinAddressLockedUntil.set(key, Date.now() + lockoutDurationMs(attempts, LOCKOUT_THRESHOLD));
  return Math.max(0, LOCKOUT_THRESHOLD - attempts);
}

export function resetSigninAddress(ip: string, personId: string): void {
  const key = `signin:${personId}:${ip}`;
  signinAddressFailures.delete(key);
  signinAddressLockedUntil.delete(key);
  signinAddressThrottle.reset(key);
}

export function __resetSigninAddressForTests(): void { signinAddressFailures.clear(); signinAddressLockedUntil.clear(); signinAddressThrottle.__resetForTests(); }

// Contract: only meaningful for failedAttempts >= LOCKOUT_THRESHOLD (the
// only way a caller reaches it). A code review (2026-09-04) found a
// defensive `Math.max(0, index)` clamp here that could never fire at the
// real call site, masking a test that claimed to prove "stays at zero
// below the threshold" while actually just exercising the dead clamp.
// Removed rather than kept "for safety": a clamp that hides an
// out-of-contract call is worse than letting it throw, per the org
// testing standard ("a test asserts behavior a person cares about").
export function lockoutDurationMs(failedAttempts: number, threshold = LOCKOUT_THRESHOLD): number {
  const backoffs = [30_000, 120_000, 600_000, 3_600_000];
  const index = Math.min(failedAttempts - threshold, backoffs.length - 1);
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

/** ADULT-LOCK-02: what a counter protects. Each purpose has its own failed-attempt count and lockout on the one schedule above, so a child poking at an
 * open adult page cannot lock the adult out of signing in. The IP throttle is shared (lib/secretThrottle.ts). */
export type LockoutPurpose = "signin" | "adult_unlock";

export function clearFailedAttempts(personId: string, purpose: LockoutPurpose = "signin"): void {
  const set = purpose === "adult_unlock" ? { adultFailedAttempts: 0, adultLockedUntil: null } : { failedAttempts: 0, lockedUntil: null };
  db.update(personCredentials)
    .set({ ...set, updatedAt: new Date().toISOString() })
    .where(eq(personCredentials.personId, personId))
    .run();
}

export function currentLockout(personId: string, purpose: LockoutPurpose = "signin"): { failedAttempts: number; lockedUntil: string | null } | null {
  const row = db
    .select({ failedAttempts: personCredentials.failedAttempts, lockedUntil: personCredentials.lockedUntil, adultFailedAttempts: personCredentials.adultFailedAttempts, adultLockedUntil: personCredentials.adultLockedUntil })
    .from(personCredentials)
    .where(eq(personCredentials.personId, personId))
    .get();
  if (!row) return null;
  return purpose === "adult_unlock" ? { failedAttempts: row.adultFailedAttempts, lockedUntil: row.adultLockedUntil } : { failedAttempts: row.failedAttempts, lockedUntil: row.lockedUntil };
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
export const recordFailedAttempt = sqlite.transaction((personId: string, purpose: LockoutPurpose = "signin"): FailedAttemptResult => {
  const [countColumn, untilColumn] = purpose === "adult_unlock" ? ["adult_failed_attempts", "adult_locked_until"] : ["failed_attempts", "locked_until"];
  const row = sqlite
    .query(`SELECT ${countColumn} AS n FROM person_credentials WHERE person_id = ?`)
    .get(personId) as { n: number } | undefined;
  const failedAttempts = (row?.n ?? 0) + 1;
  const threshold = purpose === "adult_unlock" ? LOCKOUT_THRESHOLD : PROFILE_SIGNIN_LOCKOUT_THRESHOLD;
  const lockedUntil =
    failedAttempts >= threshold
    ? new Date(Date.now() + lockoutDurationMs(failedAttempts, threshold)).toISOString()
      : null;
  sqlite
    .query(
      `UPDATE person_credentials SET ${countColumn} = ?, ${untilColumn} = ?, updated_at = ? WHERE person_id = ?`,
    )
    .run(failedAttempts, lockedUntil, new Date().toISOString(), personId);
  return { failedAttempts, lockedUntil };
});
