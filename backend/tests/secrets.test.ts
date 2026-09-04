import { describe, expect, test, afterEach } from "bun:test";
import { encryptSecret, decryptSecret, __resetSecretsKeyCacheForTests } from "@/lib/secrets";

// tests/preload.ts sets MAIPAI_KEYSTORE_BACKEND=file, so getOrCreateHexKey()
// never touches the real macOS Keychain here - the key lives in the
// test's own throwaway MAIPAI_DATA_DIR, the same isolation lib/secret.ts's
// own pepper already relies on.
afterEach(() => {
  __resetSecretsKeyCacheForTests();
  delete process.env.MAIPAI_SECRETS_KEY;
});

describe("lib/secrets.ts", () => {
  test("round-trips a real value", () => {
    const blob = encryptSecret("hf_aVeryRealLookingToken1234567890");
    expect(decryptSecret(blob)).toBe("hf_aVeryRealLookingToken1234567890");
  });

  test("the ciphertext never contains the plaintext", () => {
    const plain = "hf_aVeryRealLookingToken1234567890";
    const blob = encryptSecret(plain);
    expect(blob).not.toContain(plain);
  });

  test("two encryptions of the same plaintext produce different ciphertext (a fresh random IV each time)", () => {
    const a = encryptSecret("same value");
    const b = encryptSecret("same value");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same value");
    expect(decryptSecret(b)).toBe("same value");
  });

  test("decrypting a tampered blob throws rather than returning corrupted plaintext", () => {
    const blob = encryptSecret("a real secret");
    const [iv, tag] = blob.split(":");
    // Swap in different ciphertext bytes - GCM's auth tag must reject
    // this, not silently decrypt to garbage.
    const tampered = `${iv}:${tag}:${Buffer.from("tampered garbage").toString("base64")}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  test("decrypting a malformed blob throws a clear error instead of crashing obscurely", () => {
    expect(() => decryptSecret("not-a-real-blob")).toThrow(/malformed ciphertext/);
  });

  test("respects an operator-set MAIPAI_SECRETS_KEY over the keystore-generated one", () => {
    const key = "11".repeat(32); // 64 hex chars = 32 bytes
    process.env.MAIPAI_SECRETS_KEY = key;
    __resetSecretsKeyCacheForTests();
    const blob = encryptSecret("keyed by env");
    expect(decryptSecret(blob)).toBe("keyed by env");
  });
});
