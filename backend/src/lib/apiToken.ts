// Per-person API tokens (session-c-brain-and-voice.md step 8): the
// interim bearer credential `routes/openai.ts`'s `/v1/chat/completions`
// and the Wyoming satellite server both authenticate against, standing
// in for F's real device tokens (session-f-platform-and-trust.md step
// 6, not yet shipped). See db/schema.ts's `personApiTokens` comment for
// why this is its own table (a one-way hash, `lib/session.ts`'s own
// shape) rather than a `secret: true` settings value (round-trippable,
// the wrong contract for a bearer credential).
//
// One token per person at a time: issuing a new one replaces whatever
// existed (an UPSERT on the primary key), the same "generate again to
// rotate, no separate revoke-then-generate dance" a personal-access-token
// page usually offers. The raw token is returned exactly once, at
// issuance - `resolveApiToken()` below can only ever verify a hash
// match, never recover or display the original value again, matching
// GitHub/most services' own personal-access-token UX and the org's
// "never logged, never returned" credentials rule.
import { randomBytes, createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { personApiTokens, people } from "@/db/schema";
import type { PersonRow } from "@/types";

const TOKEN_PREFIX = "maipai_";
// Matches lib/deviceTokens.ts's own TTL (365 days): a per-person API
// token is a bearer credential same as a device token, so it gets the
// same expiry rather than living forever.
const TTL_MS = 365 * 24 * 60 * 60 * 1000;

export function generateApiToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Generates a fresh token, stores only its hash (replacing any existing
 * token for this person), and returns the raw value - the one and only
 * time it's ever available in plaintext. */
export function issueApiToken(personId: string): string {
  pruneExpiredApiTokens();
  const token = generateApiToken();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  db.insert(personApiTokens)
    .values({ personId, tokenHash: hashApiToken(token), createdAt, expiresAt, lastUsedAt: null })
    .onConflictDoUpdate({
      target: personApiTokens.personId,
      set: { tokenHash: hashApiToken(token), createdAt, expiresAt, lastUsedAt: null },
    })
    .run();
  return token;
}

export function revokeApiToken(personId: string): void {
  db.delete(personApiTokens).where(eq(personApiTokens.personId, personId)).run();
}

/** Verifies a bearer token and returns its owner, or null. Bumps
 * `lastUsedAt` on every successful verification (best-effort visibility
 * into whether a token is actually in use, the same reason a personal-
 * access-token page shows "last used" - not load-bearing for
 * authentication itself). A soft-deleted person's token never resolves,
 * the same rule `resolveSession()` already enforces for cookie sessions
 * (auth.ts's own code-review-fixed gap). */
export function resolveApiToken(token: string): PersonRow | null {
  const tokenHash = hashApiToken(token);
  const row = db.select().from(personApiTokens).where(eq(personApiTokens.tokenHash, tokenHash)).get();
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.delete(personApiTokens).where(eq(personApiTokens.personId, row.personId)).run();
    return null;
  }

  const person = db.select().from(people).where(eq(people.id, row.personId)).get();
  if (!person || person.deletedAt) return null;

  db.update(personApiTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(personApiTokens.personId, row.personId)).run();
  return person as PersonRow;
}

/** Sweeps expired tokens. Matches lib/deviceTokens.ts's own
 * pruneExpiredDeviceTokens(): called lazily on issuance (below) rather
 * than on a schedule, since there's no dedicated cron for either table -
 * a token only lingers past expiry until the next issueApiToken() call
 * for ANY person, or until someone tries to use it (resolveApiToken()
 * above deletes it on the spot either way). */
export function pruneExpiredApiTokens(): void {
  db.delete(personApiTokens).where(lt(personApiTokens.expiresAt, new Date().toISOString())).run();
}
