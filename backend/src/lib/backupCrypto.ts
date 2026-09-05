// Backup encryption, kept in its own module with no database import.
//
// lib/backup.ts imports the live `sqlite` handle (it snapshots it), and
// lib/restoreStaging.ts has to run BEFORE that handle is opened. Both
// need these two functions, so they live here rather than in either:
// importing backup.ts from restoreStaging.ts would open the database as
// a side effect of the module that exists to replace it.
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { getOrCreateHexKey } from "@/lib/keystore";

export const BACKUP_KEY_NAME = "backup";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

// AES-256-GCM, keyed from the keystore, never inside the archive
// (CLAUDE.md > Credentials and secrets; 2.5's own security section says
// the same thing about backups specifically). Format: [12-byte IV][16-byte
// auth tag][ciphertext]. A dedicated "backup" key, not the PIN/password
// pepper: a compromised or rotated pepper must never also invalidate
// every existing backup, and vice versa. Provisional key handling: 2.5's
// real design prints this key as part of an "emergency kit" at setup (a
// wizard screen that doesn't exist, chapter 6); until then it lives in
// the same keystore the pepper does (macOS Keychain / Windows DPAPI / a
// 0600 file), recoverable the same way, just not yet shown to anyone.
export function encryptFile(plainPath: string, outPath: string): void {
  const key = Buffer.from(getOrCreateHexKey(BACKUP_KEY_NAME), "hex");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(readFileSync(plainPath)), cipher.final()]);
  writeFileSync(outPath, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), { mode: 0o600 });
}

export function decryptFile(inPath: string, outPath: string): void {
  const key = Buffer.from(getOrCreateHexKey(BACKUP_KEY_NAME), "hex");
  const raw = readFileSync(inPath);
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  // A tampered or corrupted archive fails GCM's tag check right here
  // (2.5: "archives are signed and a tampered one is refused"; GCM's own
  // authentication tag is that check, not a separate signature scheme):
  // decipher.final() throws before any bytes are written to outPath.
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  writeFileSync(outPath, plain, { mode: 0o600 });
}

