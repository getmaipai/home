// Home's own reversible-secret instance, keyed by the same keystore
// lib/keystore.ts already instantiates. The AES-256-GCM logic lives in
// @maipai/core/src/secrets now (core-v0.1.0); this is Home's own
// key name and env-var override.
import { createSecrets } from "@maipai/core/src/secrets";
import { getOrCreateHexKey, markKeychainProvisioned, wasKeychainProvisioned } from "@/lib/keystore";

/** The one household key name and its env override; anything else that derives a key from it reads these. */
export const SECRETS_KEY_NAME = "secrets_key";
export const SECRETS_KEY_ENV = "MAIPAI_SECRETS_KEY";
const secrets = createSecrets({
  keystore: { getOrCreateHexKey, markKeychainProvisioned, wasKeychainProvisioned },
  keyName: SECRETS_KEY_NAME,
  envKeyVar: SECRETS_KEY_ENV,
});
/** The raw household key, for HMAC-derived signing keys (never for direct encryption: use encryptSecret). */
export function householdKeyBytes(): Buffer {
  return Buffer.from(process.env[SECRETS_KEY_ENV] ?? getOrCreateHexKey(SECRETS_KEY_NAME, 32), "hex");
}

export const encryptSecret = secrets.encrypt;
export const decryptSecret = secrets.decrypt;
export const __resetSecretsKeyCacheForTests = secrets.__resetKeyCacheForTests;
