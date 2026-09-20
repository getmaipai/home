// Home's own reversible-secret instance, keyed by the same keystore
// lib/keystore.ts already instantiates. The AES-256-GCM logic lives in
// @maipai/core/src/secrets now (core-v0.1.0); this is Home's own
// key name and env-var override.
import { createSecrets } from "@maipai/core/src/secrets";
import { getOrCreateHexKey, markKeychainProvisioned, wasKeychainProvisioned } from "@/lib/keystore";

const secrets = createSecrets({
  keystore: { getOrCreateHexKey, markKeychainProvisioned, wasKeychainProvisioned },
  keyName: "secrets_key",
  envKeyVar: "MAIPAI_SECRETS_KEY",
});

export const encryptSecret = secrets.encrypt;
export const decryptSecret = secrets.decrypt;
export const __resetSecretsKeyCacheForTests = secrets.__resetKeyCacheForTests;
