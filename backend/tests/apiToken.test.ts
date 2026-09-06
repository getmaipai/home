import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { people, personApiTokens } from "@/db/schema";
import { newPersonId } from "@/lib/id";
import { issueApiToken, resolveApiToken, revokeApiToken, hashApiToken, pruneExpiredApiTokens } from "@/lib/apiToken";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";

function insertPerson(): string {
  const now = new Date().toISOString();
  const personId = newPersonId();
  db.insert(people)
    .values({ id: personId, displayName: "Willow", role: "owner", avatarSeed: personId, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:0:testfix" })
    .run();
  return personId;
}

beforeEach(() => resetDb());

describe("issueApiToken()", () => {
  test("stamps an expiry roughly a year out", () => {
    const personId = insertPerson();
    const token = issueApiToken(personId);
    const row = db.select().from(personApiTokens).where(eq(personApiTokens.personId, personId)).get();
    const daysOut = (new Date(row!.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysOut).toBeGreaterThan(364);
    expect(daysOut).toBeLessThan(366);
    expect(resolveApiToken(token)).not.toBeNull();
  });

  test("replaces the existing token, invalidating the old one", () => {
    const personId = insertPerson();
    const first = issueApiToken(personId);
    const second = issueApiToken(personId);
    expect(resolveApiToken(first)).toBeNull();
    expect(resolveApiToken(second)?.id).toBe(personId);
  });
});

describe("resolveApiToken()", () => {
  test("null for an expired token, and deletes it", () => {
    const personId = insertPerson();
    const token = issueApiToken(personId);
    // Backdate the row's expiry directly - the only way to construct a
    // real expired token without waiting 365 days (same pattern
    // deviceTokens.test.ts uses for its own TTL).
    db.update(personApiTokens).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(personApiTokens.tokenHash, hashApiToken(token))).run();

    expect(resolveApiToken(token)).toBeNull();
    expect(db.select().from(personApiTokens).where(eq(personApiTokens.personId, personId)).get()).toBeUndefined();
  });

  test("null for a revoked token", () => {
    const personId = insertPerson();
    const token = issueApiToken(personId);
    revokeApiToken(personId);
    expect(resolveApiToken(token)).toBeNull();
  });
});

describe("pruneExpiredApiTokens()", () => {
  test("removes only expired rows", () => {
    const alive = insertPerson();
    const dead = insertPerson();
    const liveToken = issueApiToken(alive);
    const deadToken = issueApiToken(dead);
    db.update(personApiTokens).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(personApiTokens.tokenHash, hashApiToken(deadToken))).run();

    pruneExpiredApiTokens();

    expect(resolveApiToken(deadToken)).toBeNull();
    expect(resolveApiToken(liveToken)?.id).toBe(alive);
  });
});
