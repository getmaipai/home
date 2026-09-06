import { describe, expect, test } from "bun:test";
import { Person } from "@maipai/spec/gen/ts/person.js";
import { hashSecret, verifySecret } from "@/lib/secret";
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
