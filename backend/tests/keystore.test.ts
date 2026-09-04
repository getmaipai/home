import { describe, expect, test } from "bun:test";
import { markKeychainProvisioned, wasKeychainProvisioned, KeystoreUnavailableError } from "@/lib/keystore";

// The real Keychain calls (keychainRead/keychainWrite) are never exercised
// here: MAIPAI_KEYSTORE_BACKEND=file (tests/preload.ts) means the actual
// darwin path never runs in a test. This proves the marker mechanics a
// code review (2026-09-04) added, which those calls now depend on.
describe("keychain provisioning marker", () => {
  test("a key that was never marked reports as not provisioned", () => {
    expect(wasKeychainProvisioned(`never-marked-${Date.now()}`)).toBe(false);
  });

  test("marking a key makes it report as provisioned", () => {
    const name = `test-key-${Date.now()}`;
    expect(wasKeychainProvisioned(name)).toBe(false);
    markKeychainProvisioned(name);
    expect(wasKeychainProvisioned(name)).toBe(true);
  });
});

describe("KeystoreUnavailableError", () => {
  test("names the key and explains why it refuses to mint a replacement", () => {
    const err = new KeystoreUnavailableError("secret_pepper");
    expect(err.message).toContain("secret_pepper");
    expect(err.message).toContain("Refusing to generate a replacement key");
  });
});
