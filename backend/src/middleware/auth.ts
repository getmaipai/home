import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { eq, gt, and } from "drizzle-orm";
import { db } from "@/db";
import { sessions, people } from "@/db/schema";
import { hashSessionToken } from "@/lib/session";
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

export function invalidateSessionCacheForPerson(personId: string): void {
  for (const [key, entry] of sessionCache) {
    if (entry.person.id === personId) sessionCache.delete(key);
  }
}

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
    .where(eq(people.id, session.personId))
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
// APP_ORIGIN/PUBLIC_ORIGIN instead.
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
  const forwarded = c.req.header("x-forwarded-host");
  if (forwarded) forwarded.split(",").forEach((h) => allowed.add(h.trim()));
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

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (crossSiteRejected(c)) return c.json({ error: "Cross-site request blocked" }, 403);
  const token = getCookie(c, "session");
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const person = resolveSession(token);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  c.set("person", person);
  await next();
});

/** The role ladder, high to low (4.2): owner, admin, adult, teen, child, guest. */
export const ROLE_LADDER = ["owner", "admin", "adult", "teen", "child", "guest"] as const;
export type Role = (typeof ROLE_LADDER)[number];

/** Require the signed-in person to hold one of `roles` exactly (not a rank
 * comparison: 4.2's grants are per-capability, not "admin implies adult"). */
export function requireRole(...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (crossSiteRejected(c)) return c.json({ error: "Cross-site request blocked" }, 403);
    const token = getCookie(c, "session");
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    const person = resolveSession(token);
    if (!person) return c.json({ error: "Unauthorized" }, 401);
    if (!roles.includes(person.role as Role)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    c.set("person", person);
    await next();
  });
}
