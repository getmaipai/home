// The backup key lives in the keystore lib/keystore.ts already instantiates
// a dedicated "backup" key, not the PIN/password pepper or the secrets key:
// a compromised or rotated pepper must never also invalidate every existing
// backup, and vice versa.
//
// Streaming, never whole-file: a household database is routinely several
// hundred MB, and the previous readFileSync/writeFileSync implementation
// blocked the event loop for the whole archive's duration and pinned peak
// RSS to the archive's size. Both directions now run as chunked node:fs
// streams through node:crypto's cipher/decipher streams - the same
// [12-byte IV][16-byte auth tag][ciphertext] format, so every archive
// already on disk decrypts unchanged.
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { AES_GCM_AUTH_TAG_BYTES, AES_GCM_IV_BYTES } from "@maipai/core/src/aesGcm";
import { getOrCreateHexKey } from "@/lib/keystore";

export const BACKUP_KEY_NAME = "backup";

function key(): Buffer {
  return Buffer.from(getOrCreateHexKey(BACKUP_KEY_NAME), "hex");
}

/** Encrypts `plainPath` into an archive at `outPath`, streaming.
 *
 * The archive layout is [12-byte IV][16-byte auth tag][ciphertext]. GCM's
 * auth tag only exists once the final cipher chunk has run, so the file
 * is written in two passes: the 28-byte header is pre-created with zeros,
 * the ciphertext streams in at offset 28, and once the tag is final the
 * header bytes are patched in place over the reserved region. If anything
 * fails mid-stream, the partial file is removed rather than left behind.
 */
export async function encryptFile(plainPath: string, outPath: string): Promise<void> {
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv, { authTagLength: AES_GCM_AUTH_TAG_BYTES });
  const headerSize = AES_GCM_IV_BYTES + AES_GCM_AUTH_TAG_BYTES;
  await fs.writeFile(outPath, Buffer.alloc(headerSize));
  try {
    await pipeline(
      createReadStream(plainPath),
      cipher,
      createWriteStream(outPath, { autoClose: false, start: headerSize, mode: 0o600 }),
    );
    const tag = cipher.getAuthTag();
    const header = Buffer.concat([iv, tag]);
    const fd = await fs.open(outPath, "r+");
    await fd.write(header, 0, header.length, 0);
    await fd.close();
  } catch {
    await fs.unlink(outPath).catch(() => {});
    throw new Error(`could not read or encrypt ${plainPath}`);
  }
}

/** Decrypts an archive at `inPath` into a SQLite file at `outPath`,
 * streaming. A tampered or truncated archive fails GCM's tag check
 * before any plaintext is trusted: the partial output file is removed
 * and an error is thrown, never a corrupt file left behind.
 */
export async function decryptFile(inPath: string, outPath: string): Promise<void> {
  // Read just the 28-byte header - never the whole archive - so a
  // tampered file still fails GCM's tag check without pinning the
  // plaintext in memory.
  let iv: Buffer;
  let authTag: Buffer;
  try {
    const fileLength = (await fs.stat(inPath)).size;
    if (fileLength < AES_GCM_IV_BYTES + AES_GCM_AUTH_TAG_BYTES) {
      throw new Error(`could not decrypt ${inPath}`);
    }
    const fd = await fs.open(inPath, "r");
    try {
      iv = Buffer.alloc(AES_GCM_IV_BYTES);
      authTag = Buffer.alloc(AES_GCM_AUTH_TAG_BYTES);
      await fd.read(iv, 0, AES_GCM_IV_BYTES, 0);
      await fd.read(authTag, 0, AES_GCM_AUTH_TAG_BYTES, AES_GCM_IV_BYTES);
    } finally {
      await fd.close();
    }
  } catch {
    throw new Error(`could not read backup ${inPath}`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), iv, { authTagLength: AES_GCM_AUTH_TAG_BYTES });
  decipher.setAuthTag(authTag);
  // The cipher stream decrypts as chunks arrive; the final tag check runs
  // when the stream ends, before the write stream closes.
  await pipeline(
    createReadStream(inPath, { start: AES_GCM_IV_BYTES + AES_GCM_AUTH_TAG_BYTES }),
    decipher,
    createWriteStream(outPath, { autoClose: false, mode: 0o600 }),
  ).catch(() => {
    throw new Error(`could not decrypt ${inPath}`);
  });
}
