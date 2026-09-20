// Home's own backup-archive encryption instance, keyed by the same
// keystore lib/keystore.ts already instantiates - a dedicated "backup"
// key, not the PIN/password pepper or the secrets key: a compromised or
// rotated pepper must never also invalidate every existing backup, and
// vice versa. The AES-256-GCM logic lives in
// @maipai/core/src/backupCrypto now (core-v0.1.0).
import { createBackupCrypto } from "@maipai/core/src/backupCrypto";
import { getOrCreateHexKey, markKeychainProvisioned, wasKeychainProvisioned } from "@/lib/keystore";

export const BACKUP_KEY_NAME = "backup";

const backupCrypto = createBackupCrypto({ getOrCreateHexKey, markKeychainProvisioned, wasKeychainProvisioned }, BACKUP_KEY_NAME);

export const encryptFile = backupCrypto.encryptFile;
export const decryptFile = backupCrypto.decryptFile;
