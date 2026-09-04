import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { eq, gt, and, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sessions, people } from "@/db/schema";
import { hashSessionToken } from "@/lib/session";
import { TRUST_PROXY } from "@/lib/trustProxy";
import { Person } from "@maipai/spec/gen/ts/person.js";
import type { AppEnv, PersonRow } from "@/types";

// Adapted from the legacy hub's middleware/auth.ts (principle 8): the
// session cache, the CSRF origin check on top of SameSite=Strict, and the
// role-gated middleware shape all carry over. `role` replaces the legacy
// `admin`-boolean check with the full role ladder (4.2).

const SESSION_CACHE_TTL_MS = 10_000;
const SESSION_CACHE_MAX = 500;
interface CachedAuth {
  person: PersonRow;
  sessionExpiresAt: number;
  cachedAt: number;
}
const sessionCache = new Map<string, CachedAuth>();

export function invalidateSessionCache(token: string): void {
  sessionCache.delete(hashSessionToken(token));
}

/** Test-only: sessionCache is module-local state with no other reset
 * hook, same pattern as secretThrottle.ts's __resetThrottleForTests. */
export function __clearSessionCacheForTests(): void {
  sessionCache.clear();
}

// No caller yet: nothing in this slice deletes or changes a person's role
// after creation (see docs/dev.md's deferred list). Kept ready for when a
// delete-person or role-change route lands, so that route doesn't also
// have to invent cache invalidation from scratch.
export function invalidateSessionCacheForPerson(personId: string): void {
  for (const [key, entry] of sessionCache) {
    if (entry.person.id === personId) sessionCache.delete(key);
  }
}

// A code review (2026-09-04) found this never excluded a soft-deleted
// person, unlike /api/auth/profiles and GET /api/people, which both
// filter deletedAt: a deleted person's existing session would keep
// authenticating for up to 7 days, and a deleted person's PIN/password
// would keep signing them in fresh via /verify-secret. No route in this
// slice sets deletedAt yet (delete-person is deferred), but the read path
// is fixed now so the invariant holds the moment one does. The 10s cache
// TTL still bounds how fast a DB-side deletion propagates to an
// already-cached session, the same staleness window profile edits have.
export function resolveSession(token: string): PersonRow | null {
  const tokenHash = hashSessionToken(token);

  const cached = sessionCache.get(tokenHash);
  if (cached && Date.now() - cached.cachedAt <= SESSION_CACHE_TTL_MS) {
    if (cached.sessionExpiresAt < Date.now()) {
      sessionCache.delete(tokenHash);
      return null;
    }
    return cached.person;
  }
  if (cached) sessionCache.delete(tokenHash);

  const now = new Date().toISOString();
  const session = db
    .select({ personId: sessions.personId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .get();

  if (!session) return null;

  const person = db
    .select()
    .from(people)
    .where(and(eq(people.id, session.personId), isNull(people.deletedAt)))
    .get();

  if (person) {
    if (sessionCache.size >= SESSION_CACHE_MAX) {
      const oldest = sessionCache.keys().next().value;
      if (oldest !== undefined) sessionCache.delete(oldest);
    }
    sessionCache.set(tokenHash, {
      person,
      sessionExpiresAt: new Date(session.expiresAt).getTime(),
      cachedAt: Date.now(),
    });
  }

  return person ?? null;
}

// CSRF defense-in-depth on top of the SameSite=Strict cookie: for
// state-changing methods, reject a request whose Origin host is not one we
// serve. Behind a TLS-terminating reverse proxy the browser's Origin
// carries the public host while our Host header carries the internal one,
// so a bare Host comparison would 403 every mutating request; accept the
// Origin if it matches Host, X-Forwarded-Host, or a configured
// APP_ORIGIN/PUBLIC_ORIGIN instead. X-Forwarded-Host is only trusted
// behind an actual reverse proxy (lib/trustProxy.ts): a code review
// (2026-09-04) found this used to accept it unconditionally, so on the
// default direct-exposed deployment an attacker could send a forged
// X-Forwarded-Host matching their own forged Origin and sail through.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
function crossSiteRejected(c: Context<AppEnv>): boolean {
  if (process.env.NODE_ENV === "development") return false;
  if (SAFE_METHODS.has(c.req.method)) return false;
  const origin = c.req.header("origin");
  if (!origin) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }

  const allowed = new Set<string>();
  const host = c.req.header("host");
  if (host) allowed.add(host);
  if (TRUST_PROXY) {
    const forwarded = c.req.header("x-forwarded-host");
    if (forwarded) forwarded.split(",").forEach((h) => allowed.add(h.trim()));
  }
  const configured = process.env.APP_ORIGIN ?? process.env.PUBLIC_ORIGIN;
  if (configured) {
    try {
      allowed.add(new URL(configured).host);
    } catch {
      /* ignore malformed env */
    }
  }

  return !allowed.has(originHost);
}

/** The role ladder, high to low (4.2): owner, admin, adult, teen, child,
 * guest. Derived from the generated Person schema (one definition, one
 * place, CLAUDE.md principle 4) rather than re-literaled: a code review
 * (2026-09-04) found this file and spec/gen/ts/person.ts hand-maintaining
 * the identical enum in two places with nothing to catch drift. */
export const ROLE_LADDER = Person.shape.role.options;
export type Role = (typeof ROLE_LADDER)[number];

// requireAuth and requireRole used to duplicate this whole sequence
// (found by a code review, 2026-09-04): now both call it once.
function authenticate(c: Context<AppEnv>): PersonRow | Response {
  if (crossSiteRejected(c)) return c.json({ error: "Cross-site request blocked" }, 403);
  const token = getCookie(c, "session");
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const person = resolveSession(token);
  if (!person) return c.json({ error: "Unauthorized" }, 401);
  return person;
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const result = authenticate(c);
  if (result instanceof Response) return result;
  c.set("person", result);
  await next();
});

/** Require the signed-in person to hold one of `roles` exactly (not a rank
 * comparison: 4.2's grants are per-capability, not "admin implies adult"). */
export function requireRole(...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = authenticate(c);
    if (result instanceof Response) return result;
    if (!roles.includes(result.role as Role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    c.set("person", result);
    await next();
  });
}
