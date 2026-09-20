import { describe, expect, test } from "bun:test";
import { getOrCreateHexKey, markKeychainProvisioned, wasKeychainProvisioned } from "@/lib/keystore";

// The deep keychain/DPAPI/file logic is @maipai/core's own
// (core/src/keystore.test.ts, core-v0.1.0); this only proves Home's own
// instance is wired to the test's own throwaway MAIPAI_DATA_DIR (tests/
// preload.ts) and MAIPAI_KEYSTORE_BACKEND=file, not a real login
// keychain.
describe("Home's keystore instance", () => {
  test("creates a key on first call and returns the same one afterward", () => {
    const name = `test-key-${Date.now()}`;
    const first = getOrCreateHexKey(name);
    const second = getOrCreateHexKey(name);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-fA-F]{64}$/);
  });

  test("a key that was never marked reports as not provisioned; marking it flips that", () => {
    const name = `test-marker-${Date.now()}`;
    expect(wasKeychainProvisioned(name)).toBe(false);
    markKeychainProvisioned(name);
    expect(wasKeychainProvisioned(name)).toBe(true);
  });
});
