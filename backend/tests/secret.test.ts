import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Person } from "@maipai/spec/gen/ts/person.js";
import { hashSecret, verifySecret, ensureSecretPepperReady, __resetPepperCacheForTests } from "@/lib/secret";
import { KeystoreProtectionFailedError } from "@/lib/keystore";
import { dataDir } from "@/lib/paths";
import { newPersonId } from "@/lib/id";
import { ROLE_LADDER } from "@/middleware/auth";

describe("secret hashing", () => {
  test("a correct secret verifies against its own hash", async () => {
    const hash = await hashSecret("correcthorse");
    expect(await verifySecret("correcthorse", hash)).toBe(true);
  });

  test("a wrong secret does not verify", async () => {
    const hash = await hashSecret("correcthorse");
    expect(await verifySecret("wrong", hash)).toBe(false);
  });

  test("the same secret hashes differently each time (random salt)", async () => {
    const a = await hashSecret("correcthorse");
    const b = await hashSecret("correcthorse");
    expect(a).not.toBe(b);
  });

  test("hashes never contain the plaintext secret", async () => {
    const hash = await hashSecret("correcthorse");
    expect(hash).not.toContain("correcthorse");
  });
});

describe("ensureSecretPepperReady", () => {
  afterEach(() => {
    __resetPepperCacheForTests();
  });

  test("resolves without throwing on this test machine's real keystore backend", () => {
    __resetPepperCacheForTests();
    expect(() => ensureSecretPepperReady()).not.toThrow();
  });

  // core-v0.1.0's keystore refuses to silently write an unprotected
  // plaintext key when Windows DPAPI fails - boot must refuse instead of
  // continuing (index.ts). powershell isn't on this (real, non-Windows)
  // test machine's PATH, so faking win32 makes the real DPAPI call fail
  // exactly the way it would on a Windows box with PowerShell blocked.
  test("surfaces KeystoreProtectionFailedError when DPAPI protection fails, rather than silently succeeding", () => {
    __resetPepperCacheForTests();
    // Force a genuinely fresh key: an earlier test in this same process
    // may have already written secret_pepper.key under the real
    // platform's backend, and getOrCreateHexKey only ever WRITES (the
    // path that would invoke DPAPI) when nothing is there to read yet.
    // Backed up and restored below - other tests in this run share the
    // same MAIPAI_DATA_DIR and may expect the pepper to stay stable.
    const keyPath = join(dataDir, "keys", "secret_pepper.key");
    const backup = existsSync(keyPath) ? readFileSync(keyPath) : null;
    rmSync(keyPath, { force: true });
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(() => ensureSecretPepperReady()).toThrow(KeystoreProtectionFailedError);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      __resetPepperCacheForTests();
      if (backup) writeFileSync(keyPath, backup, { mode: 0o600 });
    }
  });
});

describe("ROLE_LADDER", () => {
  test("is derived from the spec's Person role enum, not a second copy", () => {
    expect(ROLE_LADDER).toEqual(Person.shape.role.options);
  });
});

describe("person id generation", () => {
  test("matches the spec's person id pattern", () => {
    for (let i = 0; i < 50; i++) {
      expect(newPersonId()).toMatch(/^person-[a-z0-9]{6,}$/);
    }
  });

  test("is not predictable across calls", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newPersonId()));
    expect(ids.size).toBe(200);
  });
});
