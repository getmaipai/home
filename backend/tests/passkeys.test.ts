import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { people, passkeyCredentials } from "@/db/schema";
import { newPersonId } from "@/lib/id";
import {
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  listPasskeys,
  deletePasskey,
  __resetPasskeyChallengesForTests,
} from "@/lib/passkeys";
import { resetDb } from "./reset-db";

// A full successful WebAuthn ceremony needs a real or virtual
// authenticator (a browser, or a simulated one signing a real
// attestation/assertion with an actual keypair) - @simplewebauthn/server
// ships no test double for this, and hand-rolling one (CBOR-encoding a
// synthetic authenticatorData, constructing clientDataJSON, signing it)
// would be re-testing the library's own well-tested crypto, not this
// file's integration of it. What IS this file's own logic - challenge
// storage and one-shot expiry, credential lookup and ownership,
// forwarding a verification failure into an honest error - is what these
// tests cover; verifyRegistrationResponse()/verifyAuthenticationResponse()
// themselves are trusted, not re-verified here.

function insertPerson(): string {
  const now = new Date().toISOString();
  const personId = newPersonId();
  db.insert(people)
    .values({ id: personId, displayName: "Iris", role: "adult", avatarSeed: personId, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:0:testfix" })
    .run();
  return personId;
}

beforeEach(() => {
  resetDb();
  __resetPasskeyChallengesForTests();
});

describe("registrationOptions()", () => {
  test("returns real WebAuthn creation options for this person", async () => {
    const personId = insertPerson();
    const options = await registrationOptions(personId, "Iris");
    expect(options.rp.id).toBe("maipai.local");
    expect(options.user.name).toBe("Iris");
    expect(typeof options.challenge).toBe("string");
    expect(options.excludeCredentials).toEqual([]);
  });

  test("excludes credentials this person already registered", async () => {
    const personId = insertPerson();
    const now = new Date().toISOString();
    db.insert(passkeyCredentials)
      .values({ id: "existing-cred-id", personId, publicKey: "fake", counter: 0, transports: '["internal"]', deviceType: "singleDevice", backedUp: false, name: "Old passkey", createdAt: now })
      .run();

    const options = await registrationOptions(personId, "Iris");
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual(["existing-cred-id"]);
  });
});

describe("verifyRegistration()", () => {
  test("refuses when no registration is in progress (no stored challenge)", async () => {
    const personId = insertPerson();
    const result = await verifyRegistration(personId, { id: "x" } as never, "My phone");
    expect(result.ok).toBe(false);
  });

  test("refuses a malformed response even with a valid pending challenge", async () => {
    const personId = insertPerson();
    await registrationOptions(personId, "Iris"); // stores a real pending challenge
    const result = await verifyRegistration(personId, { id: "not-a-real-response" } as never, "My phone");
    expect(result.ok).toBe(false);
  });

  test("a challenge is consumed by one attempt, whether it succeeds or fails", async () => {
    const personId = insertPerson();
    await registrationOptions(personId, "Iris");
    await verifyRegistration(personId, { id: "garbage" } as never, "My phone"); // fails, but consumes the challenge

    const second = await verifyRegistration(personId, { id: "garbage" } as never, "My phone");
    expect(second.ok).toBe(false);
    expect(second.error).toContain("expired");
  });
});

describe("authenticationOptions()", () => {
  test("allowCredentials lists only this person's own registered passkeys", async () => {
    const a = insertPerson();
    const b = insertPerson();
    const now = new Date().toISOString();
    db.insert(passkeyCredentials)
      .values({ id: "cred-a", personId: a, publicKey: "fake", counter: 0, transports: "[]", deviceType: "singleDevice", backedUp: false, name: "A's passkey", createdAt: now })
      .run();
    db.insert(passkeyCredentials)
      .values({ id: "cred-b", personId: b, publicKey: "fake", counter: 0, transports: "[]", deviceType: "singleDevice", backedUp: false, name: "B's passkey", createdAt: now })
      .run();

    const options = await authenticationOptions(a);
    expect(options.allowCredentials?.map((c) => c.id)).toEqual(["cred-a"]);
  });
});

describe("verifyAuthentication()", () => {
  test("refuses a credential id not registered to this person", async () => {
    const personId = insertPerson();
    await authenticationOptions(personId);
    const result = await verifyAuthentication(personId, { id: "never-registered" } as never);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("isn't registered");
  });

  test("refuses when no authentication attempt is in progress", async () => {
    const personId = insertPerson();
    const result = await verifyAuthentication(personId, { id: "whatever" } as never);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("expired");
  });
});

describe("listPasskeys()/deletePasskey()", () => {
  test("lists only what a person needs to recognize and revoke a passkey - never the public key", async () => {
    const personId = insertPerson();
    const now = new Date().toISOString();
    db.insert(passkeyCredentials)
      .values({ id: "cred-1", personId, publicKey: "shouldnotappear", counter: 0, transports: "[]", deviceType: "singleDevice", backedUp: false, name: "iPhone Face ID", createdAt: now })
      .run();

    const list = listPasskeys(personId);
    expect(list).toEqual([{ id: "cred-1", name: "iPhone Face ID", createdAt: now, lastUsedAt: null }]);
  });

  test("deletePasskey refuses to remove a passkey belonging to someone else", async () => {
    const owner = insertPerson();
    const attacker = insertPerson();
    const now = new Date().toISOString();
    db.insert(passkeyCredentials)
      .values({ id: "cred-1", personId: owner, publicKey: "x", counter: 0, transports: "[]", deviceType: "singleDevice", backedUp: false, name: "Owner's passkey", createdAt: now })
      .run();

    expect(deletePasskey("cred-1", attacker)).toBe(false);
    expect(listPasskeys(owner)).toHaveLength(1);

    expect(deletePasskey("cred-1", owner)).toBe(true);
    expect(listPasskeys(owner)).toHaveLength(0);
  });
});
