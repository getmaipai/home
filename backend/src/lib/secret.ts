// Hashing and lockout timing for a person's sign-in secret (PIN or
// password, 4.1: "Profiles on the Netflix-style picker with a PIN or
// password"). Both go through the same path; the wizard, not this module,
// decides which shape it asks a person for. Adapted from the legacy hub's
// lib/pin.ts (principle 8: hard-won crypto logic, reused fresh).

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

export function lockoutDurationMs(failedAttempts: number): number {
  const backoffs = [30_000, 120_000, 600_000, 3_600_000];
  const index = Math.min(failedAttempts - LOCKOUT_THRESHOLD, backoffs.length - 1);
  return backoffs[Math.max(0, index)] ?? 3_600_000;
}
