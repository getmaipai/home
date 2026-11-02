// The one "prove you know this person's secret" sequence: lockout check, verifySecret, failure bookkeeping, throttle. Extracted from routes/auth.ts
// (ADULT-LOCK-02) so sign-in (/verify-secret), /change-secret and the Adult lock's unlock route share one definition; sign-in behaviour is unchanged.
// Callers still run their own IP throttleCheck first (verify-secret checks it before even confirming the person exists).
//
// Returns a plain result rather than a Response: each caller builds its own c.json(...) from the body and status, keeping full type safety against
// that route's own createRoute() schema.
import { verifySecret } from "@/lib/secret";
import { recordFailedAttempt, LOCKOUT_THRESHOLD, type LockoutPurpose } from "@/lib/credentialLockout";
import { throttleFail, throttleReset } from "@/lib/secretThrottle";

export type SecretCheckFailure = { ok: false; status: 401 | 429; body: { error: string; retryAfter?: number; attemptsLeft?: number } };

/** Adult-lock guesses in flight, by person: the lockout counts a failure only after the slow hash check ends, so a burst of parallel guesses would all pass
 * the lockout check first. One guess per person at a time closes that (a second one answers as locked out for a second). Sign-in is unchanged. */
const unlockInFlight = new Set<string>();

export async function verifyAgainstRecord(
  ip: string,
  personId: string,
  record: { secretHash: string; lockedUntil: string | null },
  providedSecret: string,
  wrongSecretMessage: string,
  purpose: LockoutPurpose = "signin",
): Promise<{ ok: true } | SecretCheckFailure> {
  if (record.lockedUntil && new Date(record.lockedUntil).getTime() > Date.now()) {
    const retryAfter = Math.ceil((new Date(record.lockedUntil).getTime() - Date.now()) / 1000);
    return { ok: false, status: 429, body: { error: "Too many attempts", retryAfter } };
  }

  if (purpose === "adult_unlock") {
    if (unlockInFlight.has(personId)) return { ok: false, status: 429, body: { error: "Too many attempts", retryAfter: 1 } };
    unlockInFlight.add(personId);
  }
  let valid: boolean;
  try { valid = await verifySecret(providedSecret, record.secretHash); } finally { unlockInFlight.delete(personId); }
  if (!valid) {
    throttleFail(ip);
    // Atomic re-read-and-increment (lib/credentialLockout.ts): concurrent requests for one profile must not undercount real attempts.
    const { failedAttempts } = recordFailedAttempt(personId, purpose);
    return {
      ok: false,
      status: 401,
      body: { error: wrongSecretMessage, attemptsLeft: Math.max(0, LOCKOUT_THRESHOLD - failedAttempts) },
    };
  }

  throttleReset(ip);
  return { ok: true };
}
