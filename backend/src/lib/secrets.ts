// Reversible at-rest encryption for a real credential a household stores
// (2026-09-04: the household's own Hugging Face token, needed for voice
// cloning's gated checkpoint - settings/voiceKeys.ts). Unlike lib/secret.ts,
// which HMAC-hashes a PIN one-way, a credential like this has to be
// decryptable to actually use it, so this uses AES-256-GCM - `.github/
// CLAUDE.md` > Credentials and secrets' own named module
// ("lib/secrets: AES-256-GCM, key in data/keys or SECRETS_KEY"), which
// didn't exist anywhere in this rebuild until now (only the one-way PIN
// hasher did). Adapted from `home-legacy.git`'s own `lib/secrets.ts`
// (hard-won logic, reused - the org's "copy from legacy" allowance):
// the legacy version supported migrating a key out of an old
// `app_settings` row, which lib/keystore.ts's own header comment already
// established has nothing to migrate from in a fresh install.
//
// Key management mirrors lib/secret.ts's pepper: an operator-set
// MAIPAI_SECRETS_KEY (hex, 32 bytes) takes precedence so the key can live
// outside the data directory entirely; otherwise the keystore keeps a
// generated one outside the database (lib/keystore.ts), so a fresh
// install works with no manual setup and a stolen hub.db never carries
// its own key. NEVER log or return the plaintext to a client - callers
// that resolve a `secret: true` settings value for a person-facing
// response must go through settings.ts's resolveForResponse(), which
// already redacts it; this module is only for the internal call sites
// that genuinely need the real value (e.g. attaching it to an outbound
// request).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getOrCreateHexKey } from "@/lib/keystore";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const envKey = process.env.MAIPAI_SECRETS_KEY;
  if (envKey && /^[0-9a-fA-F]{64}$/.test(envKey)) {
    cachedKey = Buffer.from(envKey, "hex");
    return cachedKey;
  }
  cachedKey = Buffer.from(getOrCreateHexKey("secrets_key", 32), "hex");
  return cachedKey;
}

// Serialized as base64 iv:authTag:ciphertext, three fixed-shape parts so
// decrypt can split unambiguously (the first two are constant length;
// only the payload varies).
export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(blob: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = blob.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("decryptSecret: malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** Test-only: forces the next encrypt/decrypt to re-resolve the key
 * (picking up a changed MAIPAI_SECRETS_KEY or a fresh keystore file)
 * instead of reusing the cached one from an earlier test. */
export function __resetSecretsKeyCacheForTests(): void {
  cachedKey = null;
}
