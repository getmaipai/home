// Whether a reverse proxy is actually in front of this process, gating
// every forwarded-header consumer the same way. Originally decided
// independently in three places (X-Forwarded-For in secretThrottle.ts,
// X-Forwarded-Host in middleware/auth.ts's CSRF check, X-Forwarded-Proto
// in session.ts's Secure-cookie flag); a code review of the identity
// slice (2026-09-04) found the second and third never actually checked
// this, so on the default direct-exposed deployment an attacker could
// forge X-Forwarded-Host to defeat the CSRF check, or X-Forwarded-Proto
// to strip the Secure flag from their own session cookie. One gate, one
// place, all three consumers.
export const TRUST_PROXY =
  process.env.TRUST_PROXY === "1" ||
  !!(process.env.APP_ORIGIN ?? process.env.PUBLIC_ORIGIN);
