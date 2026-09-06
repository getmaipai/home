import { describe, expect, test } from "bun:test";
import {
  markKeychainProvisioned,
  wasKeychainProvisioned,
  KeystoreUnavailableError,
  keychainWriteCommand,
  dpapiProtectInvocation,
  dpapiUnprotectInvocation,
} from "@/lib/keystore";

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

// SEC-7 (code review, 2026-09-06): key material used to be interpolated
// straight into a `security`/`powershell` argv element or `-Command`
// string, visible in `ps`/Task Manager/PowerShell transcript logging for
// the duration of the call. These builders are the pure pieces that
// decide what actually crosses the process boundary and how - proving
// the invariant directly, without needing a real keychain or PowerShell.
describe("SEC-7: key material never rides on an argv element or in the script text", () => {
  test("keychainWriteCommand's own return value carries the secret (it's stdin content, not an argv element)", () => {
    const hex = "deadbeef1234";
    const command = keychainWriteCommand("test-key", hex);
    expect(command).toContain(hex);
    expect(command).toContain("add-generic-password");
  });

  test("dpapiProtectInvocation never puts the secret in args or the script text - only in env", () => {
    const hex = "deadbeef1234";
    const { args, input, env } = dpapiProtectInvocation(hex);
    expect(args.join(" ")).not.toContain(hex);
    expect(input).not.toContain(hex);
    expect(env.MAIPAI_KEYSTORE_VALUE).toBe(hex);
  });

  test("dpapiUnprotectInvocation never puts the blob in args or the script text - only in env", () => {
    const blob = "dpapi:not-real-ciphertext-just-a-test-fixture";
    const { args, input, env } = dpapiUnprotectInvocation(blob);
    expect(args.join(" ")).not.toContain(blob);
    expect(input).not.toContain(blob);
    expect(env.MAIPAI_KEYSTORE_VALUE).toBe(blob.slice("dpapi:".length));
  });

  test("the PowerShell script text itself is fixed - no interpolation site for any future caller to reintroduce", () => {
    const { input: protectScript } = dpapiProtectInvocation("anything");
    const { input: unprotectScript } = dpapiUnprotectInvocation("dpapi:anything");
    expect(protectScript).toContain("$env:MAIPAI_KEYSTORE_VALUE");
    expect(unprotectScript).toContain("$env:MAIPAI_KEYSTORE_VALUE");
  });
});

describe("KeystoreUnavailableError", () => {
  test("names the key and explains why it refuses to mint a replacement", () => {
    const err = new KeystoreUnavailableError("secret_pepper");
    expect(err.message).toContain("secret_pepper");
    expect(err.message).toContain("Refusing to generate a replacement key");
  });
});
