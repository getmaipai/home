// Hashing and lockout timing for a person's sign-in secret (PIN or
// password, 4.1: "Profiles on the Netflix-style picker with a PIN or
// password"). Both go through the same path; the wizard, not this module,
// decides which shape it asks a person for. Adapted from the legacy hub's
// lib/pin.ts (principle 8: hard-won crypto logic, reused fresh).

import { createHmac } from "node:crypto";
import { getOrCreateHexKey } from "@/lib/keystore";
import { sqlite } from "@/db";

let cachedPepper: Buffer | null = null;

// An operator-set MAIPAI_SECRET_PEPPER (hex) wins, so the pepper can live
// outside the data directory entirely; otherwise the keystore keeps a
// generated one outside the database (see lib/keystore.ts), so a fresh
// install works with no manual setup and a stolen hub.db never carries its
// own pepper.
function getPepper(): Buffer {
  if (cachedPepper) return cachedPepper;
  const envSecret = process.env.MAIPAI_SECRET_PEPPER;
  if (envSecret && /^[0-9a-fA-F]{2,}$/.test(envSecret)) {
    const buf = Buffer.from(envSecret, "hex");
    if (buf.byteLength > 0) {
      cachedPepper = buf;
      return buf;
    }
  }
  cachedPepper = Buffer.from(getOrCreateHexKey("secret_pepper", 32), "hex");
  return cachedPepper;
}

function applyPepper(secret: string): string {
  return createHmac("sha256", getPepper()).update(secret).digest("base64");
}

export async function hashSecret(secret: string): Promise<string> {
  return Bun.password.hash(applyPepper(secret), {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 3,
  });
}

export async function verifySecret(
  secret: string,
  hash: string,
): Promise<boolean> {
  return Bun.password.verify(applyPepper(secret), hash);
}

// Exponential backoff once a profile crosses the failed-attempt threshold:
// 30s, 2m, 10m, 1h. 4.1: "Rate limits and lockouts apply to PIN, password
// and passkey ceremonies alike."
export const LOCKOUT_THRESHOLD = 5;

// Contract: only meaningful for failedAttempts >= LOCKOUT_THRESHOLD (the
// only way routes/auth.ts calls it). A code review (2026-09-04) found a
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

// Atomic read-modify-write for the failed-attempt counter. A code review
// (2026-09-04) found routes/auth.ts computing `record.failedAttempts + 1`
// from a value read BEFORE the async Argon2id verify: two concurrent
// /verify-secret requests for the same profile both read the same stale
// count, both write the same incremented value, and the counter
// undercounts real attempts across a race. This function re-reads inside
// a synchronous bun:sqlite transaction (no `await` inside it, so nothing
// else can interleave, the same technique lib/memoryId.ts's `nextSeq`
// already uses), taking the fresh count at write time instead of trusting
// a value read before the async gap.
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
