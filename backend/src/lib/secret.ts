// Hashing for a person's sign-in secret (PIN or password, 4.1: "Profiles
// on the Netflix-style picker with a PIN or password"). Both go through
// the same path; the wizard, not this module, decides which shape it
// asks a person for. Adapted from the legacy hub's lib/pin.ts (principle
// 8: hard-won crypto logic, reused fresh). Lockout timing moved to
// lib/credentialLockout.ts (step 6) once passkeys needed to share it too.

import { createHmac } from "node:crypto";
import { getOrCreateHexKey } from "@/lib/keystore";

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

/** Forces the pepper to resolve now rather than on the first real
 * sign-in - called once at boot (index.ts) so a broken keystore (a
 * Windows DPAPI failure, KeystoreProtectionFailedError) surfaces as a
 * refused boot with a clear reason, not a random first sign-in's own
 * opaque 500. */
export function ensureSecretPepperReady(): void {
  getPepper();
}

/** The non-secret length class stored beside the hash
 * (person_credentials.secret_digits): the digit count of an all-digit PIN
 * of 4 to 10 digits, else 0 (a password or anything non-numeric). The
 * sign-in screen uses it to size the PIN entry and to auto-submit only at
 * the exact length, so a longer PIN is never tried at 4 digits first. */
export function secretDigitsOf(secret: string): number {
  return /^\d{4,10}$/.test(secret) ? secret.length : 0;
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

/** Test-only: the pepper is module-local state with no other reset hook. */
export function __resetPepperCacheForTests(): void {
  cachedPepper = null;
}

/** One-way API-key digest under the existing sign-in pepper. */
export function hashApiKeySecret(secret: string): string {
  return createHmac("sha256", getPepper()).update(secret).digest("hex");
}
