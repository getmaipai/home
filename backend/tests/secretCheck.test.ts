import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people, personCredentials } from "@/db/schema";
import { newPersonId } from "@/lib/id";
import { hashSecret } from "@/lib/secret";
import { verifyAgainstRecord } from "@/lib/secretCheck";
import { __resetSigninAddressForTests } from "@/lib/credentialLockout";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { resetDb } from "./reset-db";

beforeEach(() => { resetDb(); __resetSigninAddressForTests(); __resetThrottleForTests(); });

describe("verifyAgainstRecord concurrency", () => {
  test("only one parallel wrong sign-in guess is checked and counted", async () => {
    const id = newPersonId();
    const now = new Date().toISOString();
    db.insert(people).values({ id, displayName: "Sage", role: "owner", avatarSeed: id, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:0:signin" }).run();
    const secretHash = await hashSecret("correcthorse");
    db.insert(personCredentials).values({ personId: id, secretHash, failedAttempts: 0, createdAt: now, updatedAt: now }).run();

    const results = await Promise.all([
      verifyAgainstRecord("192.0.2.1", id, { secretHash, lockedUntil: null }, "wrong", "Invalid PIN or password"),
      verifyAgainstRecord("192.0.2.1", id, { secretHash, lockedUntil: null }, "wrong", "Invalid PIN or password"),
    ]);
    expect(results.map((result) => result.ok ? 200 : result.status).sort()).toEqual([401, 429]);
    expect(db.select().from(personCredentials).get()?.failedAttempts).toBe(1);
  });
});
