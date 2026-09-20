// Home's own keystore instance: one keychain/file store rooted at
// data/keys, namespaced "maipai-home" so it never collides with another
// product's keystore entries in the same login keychain. The actual
// keychain/DPAPI/file logic lives in @maipai/core/src/keystore now
// (core-v0.1.0); this file is just Home's own instantiation of it.
import { join } from "node:path";
import { createKeystore } from "@maipai/core/src/keystore";
import { dataDir } from "@/lib/paths";

const keystore = createKeystore({ keysDir: join(dataDir, "keys"), appId: "maipai-home" });

export const getOrCreateHexKey = keystore.getOrCreateHexKey;
export const markKeychainProvisioned = keystore.markKeychainProvisioned;
export const wasKeychainProvisioned = keystore.wasKeychainProvisioned;
export { KeystoreUnavailableError, KeystoreProtectionFailedError } from "@maipai/core/src/keystore";
