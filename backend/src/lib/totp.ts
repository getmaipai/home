// TOTP: optional second factor for owner and admin only (session-f-
// platform-and-trust.md step 6, platform plan 4.1: "optional TOTP for
// owner and admin"), using `otpauth` (maintained, isomorphic, no native
// deps - CLAUDE.md principle 6, prebuilt over hand-built: hand-rolling
// RFC 6238's HMAC-based counter math is exactly what this exists to
// avoid). The shared secret is a real reversible secret the app stores,
// so it's AES-256-GCM-encrypted via lib/secrets.ts before it ever
// touches disk - the same treatment householdCa.ts's private keys got
// after a code review found them plaintext (step 5).
import { TOTP, Secret } from "otpauth";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { totpSecrets } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/secrets";

const ISSUER = "MaiPai Home";

function makeTotp(secret: Secret, accountLabel: string): TOTP {
  return new TOTP({ issuer: ISSUER, label: accountLabel, secret, algorithm: "SHA1", digits: 6, period: 30 });
}

/** Starts (or restarts) enrollment: mints a fresh secret, stores it
 * encrypted with enabled=false, and returns the otpauth:// URI to render
 * as a QR code. Not usable to sign in until verifyEnrollment() proves the
 * person can actually generate a real code with it - enrollment isn't
 * complete on secret creation alone, or someone who never finished
 * scanning the QR would get locked out of their own next sign-in. */
export function beginEnrollment(personId: string, accountLabel: string): { uri: string } {
  const secret = new Secret({ size: 20 });
  const now = new Date().toISOString();
  db.insert(totpSecrets)
    .values({ personId, secretEncrypted: encryptSecret(secret.base32), enabled: false, lastUsedStep: null, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: totpSecrets.personId,
      set: { secretEncrypted: encryptSecret(secret.base32), enabled: false, lastUsedStep: null, updatedAt: now },
    })
    .run();
  return { uri: makeTotp(secret, accountLabel).toString() };
}

function loadSecret(personId: string): { secret: Secret; enabled: boolean; lastUsedStep: number | null } | null {
  const row = db.select().from(totpSecrets).where(eq(totpSecrets.personId, personId)).get();
  if (!row) return null;
  return { secret: Secret.fromBase32(decryptSecret(row.secretEncrypted)), enabled: row.enabled, lastUsedStep: row.lastUsedStep };
}

// A code review (2026-09-06) found both ceremonies below stateless -
// .validate() alone just checks the code is valid for SOME step within
// the window, so a code observed once (shoulder-surfed, network-
// captured, or hit mid-brute-force) stayed valid for the rest of its
// ~90s window and could be submitted repeatedly, each attempt minting a
// fresh session. RFC 6238 section 5.2's own anti-replay recommendation:
// track the last step actually used and refuse anything at or before it.
// Shared by both verifyEnrollment() and verifyTotp() so replay is closed
// the same way regardless of which ceremony a code was used in.
function validateAndConsumeStep(personId: string, secret: Secret, lastUsedStep: number | null, token: string): boolean {
  const totp = makeTotp(secret, personId);
  const delta = totp.validate({ token, window: 1 });
  if (delta === null) return false;
  const step = TOTP.counter({ period: totp.period }) + delta;
  if (lastUsedStep !== null && step <= lastUsedStep) return false; // replay of an already-used (or older) step
  db.update(totpSecrets).set({ lastUsedStep: step, updatedAt: new Date().toISOString() }).where(eq(totpSecrets.personId, personId)).run();
  return true;
}

/** Confirms enrollment with a real generated code, flipping enabled to
 * true. A one-step-off window (30s either side) tolerates ordinary clock
 * drift between the hub and the person's phone. */
export function verifyEnrollment(personId: string, token: string): boolean {
  const loaded = loadSecret(personId);
  if (!loaded) return false;
  if (!validateAndConsumeStep(personId, loaded.secret, loaded.lastUsedStep, token)) return false;
  db.update(totpSecrets).set({ enabled: true, updatedAt: new Date().toISOString() }).where(eq(totpSecrets.personId, personId)).run();
  return true;
}

export function isTotpEnabled(personId: string): boolean {
  return loadSecret(personId)?.enabled ?? false;
}

/** The sign-in-time check: only meaningful once enrollment is confirmed -
 * a person mid-enrollment (secret minted, QR not yet scanned
 * successfully) is never asked for a code they can't generate. */
export function verifyTotp(personId: string, token: string): boolean {
  const loaded = loadSecret(personId);
  if (!loaded || !loaded.enabled) return false;
  return validateAndConsumeStep(personId, loaded.secret, loaded.lastUsedStep, token);
}

export function disableTotp(personId: string): void {
  db.delete(totpSecrets).where(eq(totpSecrets.personId, personId)).run();
}
