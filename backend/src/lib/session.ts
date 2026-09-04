import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { lt } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import { db } from "@/db";
import { sessions } from "@/db/schema";
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

export function issueSession(c: Context<AppEnv>, personId: string): void {
  const token = generateSessionToken();
  const expiresAt = sessionExpiresAt();

  db.insert(sessions)
    .values({
      id: crypto.randomUUID(),
      personId,
      tokenHash: hashSessionToken(token),
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    })
    .run();

  // Secure automatically when the request arrived over HTTPS (directly or
  // via a TLS-terminating reverse proxy), without breaking plain-HTTP-on-LAN
  // deployments where a Secure cookie would simply never be sent.
  const proto =
    c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() ??
    new URL(c.req.url).protocol.replace(":", "");

  setCookie(c, "session", token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: proto === "https",
    expires: expiresAt,
    path: "/",
  });
}
