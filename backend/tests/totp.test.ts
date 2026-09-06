import { describe, expect, test, beforeEach } from "bun:test";
import { TOTP, Secret } from "otpauth";
import { beginEnrollment, verifyEnrollment, verifyTotp, isTotpEnabled, disableTotp } from "@/lib/totp";
import { newPersonId } from "@/lib/id";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";

const PERIOD_MS = 30_000;

beforeEach(() => resetDb());

function insertPerson(): string {
  const now = new Date().toISOString();
  const personId = newPersonId();
  db.insert(people)
    .values({ id: personId, displayName: "Sage", role: "owner", avatarSeed: personId, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:0:testfix" })
    .run();
  return personId;
}

// stepOffset lets a test get a code for a DIFFERENT 30s step than "now" -
// needed once verifyEnrollment()/verifyTotp() both consume the step they
// accept (anti-replay, see totp.ts's own comment): two calls in the same
// test that both need a fresh, still-valid code can't reuse the exact
// same one.
function realCodeFor(uri: string, stepOffset = 0): string {
  const totp = URIToTotp(uri);
  return totp.generate({ timestamp: Date.now() + stepOffset * PERIOD_MS });
}

// otpauth's own URI class is a static import elsewhere in this file's
// real dependency (lib/totp.ts) - re-parsing the URI here (rather than
// hand-extracting the secret with a regex) proves the URI beginEnrollment()
// returns is genuinely a valid otpauth:// URI an authenticator app could
// scan, not just a string that happens to contain the right substrings.
function URIToTotp(uri: string): TOTP {
  const url = new URL(uri);
  const secret = url.searchParams.get("secret");
  if (!secret) throw new Error("no secret in otpauth URI");
  return new TOTP({ secret: Secret.fromBase32(secret) });
}

describe("beginEnrollment()", () => {
  test("returns a real otpauth:// URI with a usable secret", () => {
    const personId = insertPerson();
    const { uri } = beginEnrollment(personId, "Sage");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(isTotpEnabled(personId)).toBe(false); // not enabled until verified
  });

  test("re-enrolling replaces the previous secret and resets enabled to false", () => {
    const personId = insertPerson();
    const first = beginEnrollment(personId, "Sage");
    verifyEnrollment(personId, realCodeFor(first.uri));
    expect(isTotpEnabled(personId)).toBe(true);

    const second = beginEnrollment(personId, "Sage");
    expect(second.uri).not.toBe(first.uri);
    expect(isTotpEnabled(personId)).toBe(false);
  });
});

describe("verifyEnrollment()", () => {
  test("a real generated code confirms enrollment", () => {
    const personId = insertPerson();
    const { uri } = beginEnrollment(personId, "Sage");
    expect(verifyEnrollment(personId, realCodeFor(uri))).toBe(true);
    expect(isTotpEnabled(personId)).toBe(true);
  });

  test("a wrong code does not confirm enrollment", () => {
    const personId = insertPerson();
    beginEnrollment(personId, "Sage");
    expect(verifyEnrollment(personId, "000000")).toBe(false);
    expect(isTotpEnabled(personId)).toBe(false);
  });

  test("false with no enrollment in progress", () => {
    expect(verifyEnrollment(insertPerson(), "123456")).toBe(false);
  });
});

describe("verifyTotp() (the sign-in-time check)", () => {
  test("accepts a real code once enrollment is confirmed", () => {
    const personId = insertPerson();
    const { uri } = beginEnrollment(personId, "Sage");
    verifyEnrollment(personId, realCodeFor(uri, -1));

    expect(verifyTotp(personId, realCodeFor(uri))).toBe(true);
  });

  test("refuses a code for a person whose enrollment was never confirmed", () => {
    const personId = insertPerson();
    const { uri } = beginEnrollment(personId, "Sage");
    // Never called verifyEnrollment() - enabled stays false.
    expect(verifyTotp(personId, realCodeFor(uri))).toBe(false);
  });

  test("refuses a wrong code", () => {
    const personId = insertPerson();
    const { uri } = beginEnrollment(personId, "Sage");
    verifyEnrollment(personId, realCodeFor(uri, -1));
    expect(verifyTotp(personId, "000000")).toBe(false);
  });

  test("false for a person with no TOTP secret at all", () => {
    expect(verifyTotp(insertPerson(), "123456")).toBe(false);
  });
});

// A code review (2026-09-06) found the sign-in check stateless: a code
// stays valid for its whole ~90s window (window: 1 either side of the
// current 30s step) and could be resubmitted any number of times within
// it. RFC 6238 section 5.2's own anti-replay recommendation - track the
// last used step, refuse anything at or before it - is what lib/totp.ts
// now does.
describe("replay protection", () => {
  test("the exact same code cannot be used twice", () => {
    const personId = insertPerson();
    const { uri } = beginEnrollment(personId, "Sage");
    verifyEnrollment(personId, realCodeFor(uri, -1));

    const code = realCodeFor(uri);
    expect(verifyTotp(personId, code)).toBe(true);
    expect(verifyTotp(personId, code)).toBe(false); // the same code again: refused
  });

  test("verifyEnrollment() itself consumes the step - the same code cannot also sign in", () => {
    const personId = insertPerson();
    const { uri } = beginEnrollment(personId, "Sage");
    const code = realCodeFor(uri);
    expect(verifyEnrollment(personId, code)).toBe(true);
    expect(verifyTotp(personId, code)).toBe(false);
  });

  test("a later code (a fresh step) still works", () => {
    const personId = insertPerson();
    const { uri } = beginEnrollment(personId, "Sage");
    verifyEnrollment(personId, realCodeFor(uri, -1));

    expect(verifyTotp(personId, realCodeFor(uri))).toBe(true);
    expect(verifyTotp(personId, realCodeFor(uri, 1))).toBe(true);
  });
});

describe("disableTotp()", () => {
  test("removes the secret entirely", () => {
    const personId = insertPerson();
    const { uri } = beginEnrollment(personId, "Sage");
    verifyEnrollment(personId, realCodeFor(uri));
    expect(isTotpEnabled(personId)).toBe(true);

    disableTotp(personId);

    expect(isTotpEnabled(personId)).toBe(false);
    expect(verifyTotp(personId, realCodeFor(uri, 1))).toBe(false);
  });
});
