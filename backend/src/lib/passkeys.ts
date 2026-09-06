// WebAuthn (@simplewebauthn/server, session-f-platform-and-trust.md step
// 6): a passkey as an alternative strong credential to a PIN/password,
// per person, with the same shared lockout rules (lib/credentialLockout.ts)
// a PIN/password ceremony gets. Registration is self-service on an
// already-signed-in profile (add a passkey to my own account) - there is
// no passkey-only account-creation flow this wave; POST /api/auth/setup
// still mints the owner with a PIN/password, and a passkey is offered as
// an enhancement afterward, matching this wave's actual UI scope.
//
// WebAuthn is origin-bound and refuses a plain-HTTP context except
// localhost, so this only works once step 5's household CA has a person
// on real TLS - a natural dependency, not a new requirement invented
// here. rpID is fixed at `maipai.local` (the household CA leaf's own
// primary SAN entry, session-f-platform-and-trust.md step 5) rather than
// a raw LAN IP: WebAuthn requires rpID to be a valid domain string, and
// browser support for IP-address rpIDs is inconsistent. Every detected
// LAN IP is still accepted as a valid ORIGIN for the ceremony (a browser
// reaching the hub by IP, not by name, can still complete WebAuthn as
// long as the credential's rpID matches what was registered) -
// `@simplewebauthn/server`'s expectedOrigin/expectedRPID both accept an
// array for exactly this "reachable by more than one address" case.
import { eq, and } from "drizzle-orm";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { db } from "@/db";
import { passkeyCredentials } from "@/db/schema";
import { detectLanIps } from "@/lib/hubEndpoints";
import { ensureCredentialRowExists } from "@/lib/credentialLockout";

const RP_ID = "maipai.local";
const RP_NAME = "MaiPai Home";
const port = Number(process.env.PORT ?? 8787);

function acceptedOrigins(): string[] {
  const origins = [`https://${RP_ID}:${port}`, ...detectLanIps().map((ip) => `https://${ip}:${port}`)];
  // A dev instance without a household CA leaf yet still needs to be
  // able to exercise this locally over plain HTTP - WebAuthn treats
  // localhost as a secure context regardless of scheme.
  origins.push(`http://localhost:${port}`, `https://localhost:${port}`);
  return origins;
}

// Ceremony challenges: in-memory, like lib/quickConnect.ts's pending
// requests - a challenge is worthless after a restart and expires in
// minutes anyway, so there is no reason to persist it. Keyed by personId:
// only one in-flight ceremony per person at a time, which is exactly
// what a real sign-in/enrollment flow ever needs.
interface PendingChallenge {
  challenge: string;
  expiresAt: number;
}
const pendingChallenges = new Map<string, PendingChallenge>();
const CHALLENGE_TTL_MS = 5 * 60_000;

function storeChallenge(personId: string, challenge: string): void {
  pendingChallenges.set(personId, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}

function takeChallenge(personId: string): string | null {
  const entry = pendingChallenges.get(personId);
  pendingChallenges.delete(personId); // one-shot: a challenge is consumed whether verification succeeds or fails
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.challenge;
}

export function __resetPasskeyChallengesForTests(): void {
  pendingChallenges.clear();
}

function credentialsForPerson(personId: string) {
  return db.select().from(passkeyCredentials).where(eq(passkeyCredentials.personId, personId)).all();
}

export async function registrationOptions(personId: string, personDisplayName: string) {
  const existing = credentialsForPerson(personId);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: personDisplayName,
    userID: new TextEncoder().encode(personId),
    userDisplayName: personDisplayName,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: JSON.parse(c.transports) as string[] })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  storeChallenge(personId, options.challenge);
  return options;
}

export interface RegistrationVerifyResult {
  ok: boolean;
  error?: string;
}

export async function verifyRegistration(personId: string, response: RegistrationResponseJSON, label: string): Promise<RegistrationVerifyResult> {
  const expectedChallenge = takeChallenge(personId);
  if (!expectedChallenge) return { ok: false, error: "This registration attempt has expired. Try again." };

  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: acceptedOrigins(),
      expectedRPID: RP_ID,
    });
  } catch {
    return { ok: false, error: "Could not verify this passkey." };
  }
  if (!result.verified) return { ok: false, error: "Could not verify this passkey." };

  const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
  ensureCredentialRowExists(personId); // the shared lockout counter (lib/credentialLockout.ts) needs a row to live on
  const now = new Date().toISOString();
  db.insert(passkeyCredentials)
    .values({
      id: credential.id,
      personId,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: JSON.stringify(credential.transports ?? []),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: label.trim().slice(0, 60) || "A passkey",
      createdAt: now,
      lastUsedAt: null,
    })
    .run();
  return { ok: true };
}

export async function authenticationOptions(personId: string) {
  const existing = credentialsForPerson(personId);
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: existing.map((c) => ({ id: c.id, transports: JSON.parse(c.transports) as string[] })),
    userVerification: "preferred",
  });
  storeChallenge(personId, options.challenge);
  return options;
}

export interface AuthenticationVerifyResult {
  ok: boolean;
  error?: string;
}

export async function verifyAuthentication(personId: string, response: AuthenticationResponseJSON): Promise<AuthenticationVerifyResult> {
  const expectedChallenge = takeChallenge(personId);
  if (!expectedChallenge) return { ok: false, error: "This sign-in attempt has expired. Try again." };

  const stored = db
    .select()
    .from(passkeyCredentials)
    .where(and(eq(passkeyCredentials.id, response.id), eq(passkeyCredentials.personId, personId)))
    .get();
  if (!stored) return { ok: false, error: "This passkey isn't registered to this profile." };

  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: acceptedOrigins(),
      expectedRPID: RP_ID,
      credential: {
        id: stored.id,
        publicKey: Buffer.from(stored.publicKey, "base64url"),
        counter: stored.counter,
        transports: JSON.parse(stored.transports) as string[],
      },
    });
  } catch {
    return { ok: false, error: "Could not verify this passkey." };
  }
  if (!result.verified) return { ok: false, error: "Could not verify this passkey." };

  // The updated counter guards against a cloned authenticator replaying
  // an old assertion - persisted immediately, not just returned, or the
  // next real sign-in would compare against a stale value.
  db.update(passkeyCredentials)
    .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() })
    .where(eq(passkeyCredentials.id, stored.id))
    .run();
  return { ok: true };
}

export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function listPasskeys(personId: string): PasskeySummary[] {
  return credentialsForPerson(personId).map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt }));
}

export function deletePasskey(id: string, personId: string): boolean {
  const row = db.select({ id: passkeyCredentials.id }).from(passkeyCredentials).where(and(eq(passkeyCredentials.id, id), eq(passkeyCredentials.personId, personId))).get();
  if (!row) return false;
  db.delete(passkeyCredentials).where(eq(passkeyCredentials.id, id)).run();
  return true;
}
