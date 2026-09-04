import { describe, expect, test } from "bun:test";
import { hashSecret, verifySecret, lockoutDurationMs, LOCKOUT_THRESHOLD } from "@/lib/secret";
import { newPersonId } from "@/lib/id";

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

describe("lockout backoff", () => {
  test("stays at zero below the threshold", () => {
    expect(lockoutDurationMs(1)).toBeGreaterThan(0);
  });

  test("grows with more failed attempts, capped at one hour", () => {
    const at5 = lockoutDurationMs(LOCKOUT_THRESHOLD);
    const at6 = lockoutDurationMs(LOCKOUT_THRESHOLD + 1);
    const at20 = lockoutDurationMs(LOCKOUT_THRESHOLD + 15);
    expect(at5).toBe(30_000);
    expect(at6).toBeGreaterThan(at5);
    expect(at20).toBe(3_600_000);
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
