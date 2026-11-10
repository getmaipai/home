// The one "prove you know this person's secret" sequence: lockout check, verifySecret, failure bookkeeping, throttle. Extracted from routes/auth.ts
// (ADULT-LOCK-02) so sign-in (/verify-secret), /change-secret and the Adult lock's unlock route share one definition; sign-in behaviour is unchanged.
// Callers still run their own IP throttleCheck first (verify-secret checks it before even confirming the person exists).
//
// Returns a plain result rather than a Response: each caller builds its own c.json(...) from the body and status, keeping full type safety against
// that route's own createRoute() schema.
import { verifySecret } from "@/lib/secret";
import { recordFailedAttempt, LOCKOUT_THRESHOLD, checkSigninAddress, failSigninAddress, resetSigninAddress, type LockoutPurpose } from "@/lib/credentialLockout";
import { throttleFail, throttleReset } from "@/lib/secretThrottle";

export type SecretCheckFailure = { ok: false; status: 401 | 429; body: { error: string; retryAfter?: number; attemptsLeft?: number } };

/** Apply the same failure bookkeeping to another credential ceremony (for example a passkey). */
export function recordCredentialFailure(ip: string, personId: string, message: string, purpose: LockoutPurpose = "signin"): SecretCheckFailure {
  throttleFail(ip);
  const { failedAttempts } = recordFailedAttempt(personId, purpose);
  const attemptsLeft = purpose === "signin" ? failSigninAddress(ip, personId) : Math.max(0, LOCKOUT_THRESHOLD - failedAttempts);
  return { ok: false, status: 401, body: { error: message, attemptsLeft } };
}

/** Serialize slow proofs per purpose and profile, closing the gap between lockout read and failed-attempt write. */
const proofInFlight = new Set<string>();

export async function verifyAgainstRecord(
  ip: string,
  personId: string,
  record: { secretHash: string; lockedUntil: string | null },
  providedSecret: string,
  wrongSecretMessage: string,
  purpose: LockoutPurpose = "signin",
): Promise<{ ok: true } | SecretCheckFailure> {
  const address = purpose === "signin" ? checkSigninAddress(ip, personId) : null;
  if (address?.blocked) return { ok: false, status: 429, body: { error: "Too many attempts", retryAfter: address.retryAfter } };
  if (record.lockedUntil && new Date(record.lockedUntil).getTime() > Date.now()) {
    const retryAfter = Math.ceil((new Date(record.lockedUntil).getTime() - Date.now()) / 1000);
    return { ok: false, status: 429, body: { error: "Too many attempts", retryAfter } };
  }

  const flightKey = `${purpose}:${personId}`;
  if (proofInFlight.has(flightKey)) return { ok: false, status: 429, body: { error: "Too many attempts", retryAfter: 1 } };
  proofInFlight.add(flightKey);
  let valid: boolean;
  try { valid = await verifySecret(providedSecret, record.secretHash); } finally { proofInFlight.delete(flightKey); }
  if (!valid) {
    // Atomic re-read-and-increment (lib/credentialLockout.ts): concurrent requests for one profile must not undercount real attempts.
    return recordCredentialFailure(ip, personId, wrongSecretMessage, purpose);
  }

  throttleReset(ip);
  if (purpose === "signin") resetSigninAddress(ip, personId);
  return { ok: true };
}
