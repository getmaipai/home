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

/** True if a bare-tap /select must be refused for this person because
 * they currently HOLD a credential - either kind requires proving it
 * first. Says nothing about whether they're SUPPOSED to have one; see
 * ROLE_REQUIRES_CREDENTIAL below for that. */
export function requiresCredential(personId: string): boolean {
  const methods = getAuthMethods(personId);
  return methods.hasSecret || methods.hasPasskeys;
}

/** Roles a bare-tap /select must refuse regardless of whether a
 * credential happens to exist yet - owner/admin (a one-request takeover
 * otherwise) and adult (issues #35/#47: CONTENT_CEILINGS' adult band
 * already answers with profanity/sexual/violence unrestricted, and the
 * role alone gates real authorization - routes/approvals.ts, lib/
 * commands.ts - regardless of any ceiling/grant question).
 *
 * One definition, checked at the one place that actually decides whether
 * a bare tap works (routes/auth.ts's /select), rather than only at every
 * ROUTE that can assign one of these roles (routes/people.ts's create,
 * personLifecycle.ts's checkRoleChange) - a code review (2026-09-06)
 * found the birthday age-band sweep (personLifecycle.ts's
 * applyAgeBandChanges()) writes role: "adult" directly with no such
 * check at all, a THIRD path those two route-level guards never covered
 * and, being automatic, never will reliably be remembered for the next
 * one either. Checking it here closes every current and future path at
 * once. */
export const ROLE_REQUIRES_CREDENTIAL = new Set(["owner", "admin", "adult"]);

export function roleRequiresCredential(role: string): boolean {
  return ROLE_REQUIRES_CREDENTIAL.has(role);
}
