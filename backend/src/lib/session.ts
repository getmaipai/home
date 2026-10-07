import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { lt } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { requestUsesHttps } from "@/lib/trustProxy";
import type { AppEnv } from "@/types";

// Adapted from the legacy hub's lib/session.ts (principle 8).

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, 4.1

export function sessionExpiresAt(): Date {
  return new Date(Date.now() + SESSION_LIFETIME_MS);
}

/** Sessions past expiry just stop authenticating; sweep them so the table
 * doesn't grow unbounded. Call from a boot/scheduled sweep. */
export function pruneExpiredSessions() {
  return db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString()));
}

export function issueSession(c: Context<AppEnv>, personId: string, deviceId?: string | null): void {
  const token = generateSessionToken();
  const expiresAt = sessionExpiresAt();

  db.insert(sessions)
    .values({
      id: crypto.randomUUID(),
      personId,
      tokenHash: hashSessionToken(token),
      userAgent: c.req.header("user-agent") ?? null,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      // FACE-03: set only when this session came from a device-token
      // redeem (routes/deviceAuth.ts) - null for a plain PIN/password/
      // passkey sign-in, same as the column's own default.
      deviceId: deviceId ?? null,
    })
    .run();

  // Secure automatically when the request arrived over HTTPS (directly or
  // via a TLS-terminating reverse proxy), without breaking plain-HTTP-on-LAN
  // deployments where a Secure cookie would simply never be sent.
  // X-Forwarded-Proto is only trusted behind an actual reverse proxy
  // (lib/trustProxy.ts): a code review (2026-09-04) found this trusted the
  // header unconditionally, letting a direct client flip its own cookie's
  // Secure flag by forging the header.
  setCookie(c, "session", token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: requestUsesHttps(c.req.url, c.req.header("x-forwarded-proto")),
    expires: expiresAt,
    path: "/",
  });
}
