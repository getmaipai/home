// What a person can sign in with, spanning personCredentials (PIN/
// password) and passkeyCredentials (step 6) - two tables, one question
// ("does this profile need more than a bare tap to sign in?") that
// routes/auth.ts's /profiles, /me and /select all need answered
// consistently. A person with a passkey but no PIN/password must be
// refused the same bare-tap /select a PIN-free child profile gets - a
// passkey-only owner is not a credential-free profile.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { personCredentials, passkeyCredentials } from "@/db/schema";

export interface AuthMethods {
  hasSecret: boolean;
  hasPasskeys: boolean;
}

export function getAuthMethods(personId: string): AuthMethods {
  const cred = db
    .select({ secretHash: personCredentials.secretHash })
    .from(personCredentials)
    .where(eq(personCredentials.personId, personId))
    .get();
  const passkeyCount = db
    .select({ id: passkeyCredentials.id })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.personId, personId))
    .all().length;
  return { hasSecret: cred?.secretHash != null, hasPasskeys: passkeyCount > 0 };
}

/** True if a bare-tap /select must be refused for this person - either
 * kind of credential requires proving it first. */
export function requiresCredential(personId: string): boolean {
  const methods = getAuthMethods(personId);
  return methods.hasSecret || methods.hasPasskeys;
}
