import { Hono } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { people, personCredentials, sessions } from "@/db/schema";
import { hashSessionToken, issueSession } from "@/lib/session";
import { hashSecret, verifySecret, lockoutDurationMs, LOCKOUT_THRESHOLD } from "@/lib/secret";
import {
  getClientIp,
  throttleCheck,
  throttleFail,
  throttleReset,
} from "@/lib/secretThrottle";
import { newPersonId } from "@/lib/id";
import { requireAuth, invalidateSessionCache } from "@/middleware/auth";
import { toPerson, toRoster } from "@/lib/personShape";
import type { AppEnv } from "@/types";

export const auth = new Hono<AppEnv>();

// The profile picker: every non-deleted person, never a secret hash, and
// never a birthdate (3.1: core-only). Public (unauthenticated) by design,
// same as the legacy hub's /profiles: the picker has to render before
// anyone is signed in.
auth.get("/profiles", async (c) => {
  const rows = db.select().from(people).where(isNull(people.deletedAt)).all();

  const creds = db
    .select({ personId: personCredentials.personId })
    .from(personCredentials)
    .all();
  const withSecret = new Set(creds.map((r) => r.personId));

  return c.json(
    rows.map((r) => ({ ...toRoster(r), hasSecret: withSecret.has(r.id) })),
  );
});

// First-run only: creates the household owner. Refuses once any person
// exists, so this can never be used to mint a second owner over the
// network (routes/people.ts is the ongoing way to add people).
auth.post("/setup", async (c) => {
  const anyone = db.select({ id: people.id }).from(people).limit(1).get();
  if (anyone) return c.json({ error: "Setup already completed" }, 409);

  const body = (await c.req.json().catch(() => ({}))) as {
    displayName?: string;
    secret?: string;
  };
  const displayName = body.displayName?.trim();
  const secret = body.secret;
  if (!displayName || displayName.length < 1 || displayName.length > 80) {
    return c.json({ error: "displayName is required (1-80 characters)" }, 400);
  }
  if (!secret || secret.length < 4 || secret.length > 128) {
    return c.json({ error: "secret must be 4-128 characters" }, 400);
  }

  const now = new Date().toISOString();
  const id = newPersonId();
  db.insert(people)
    .values({
      id,
      displayName,
      role: "owner",
      avatarSeed: id,
      source: "hub",
      localOnly: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(personCredentials)
    .values({
      personId: id,
      secretHash: await hashSecret(secret),
      failedAttempts: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  issueSession(c, id);
  const row = db.select().from(people).where(eq(people.id, id)).get()!;
  return c.json({ person: toPerson(row) }, 201);
});

// Select a secret-free profile (4.1: a child's picker entry can be a bare
// tap). Refused for anyone who has a credential on record; use
// /verify-secret for those.
auth.post("/select", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { personId?: string };
  const personId = body.personId;
  if (!personId) return c.json({ error: "personId is required" }, 400);

  const person = db.select().from(people).where(eq(people.id, personId)).get();
  if (!person || person.deletedAt) return c.json({ error: "Profile not found" }, 404);

  const cred = db
    .select({ personId: personCredentials.personId })
    .from(personCredentials)
    .where(eq(personCredentials.personId, personId))
    .get();
  if (cred) return c.json({ error: "This profile needs its PIN or password" }, 400);

  issueSession(c, personId);
  return c.json({ success: true });
});

// Select a secret-protected profile.
auth.post("/verify-secret", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    personId?: string;
    secret?: string;
  };
  const { personId, secret } = body;
  if (!personId || !secret) {
    return c.json({ error: "personId and secret are required" }, 400);
  }

  const ip = getClientIp(c);
  const throttled = throttleCheck(ip);
  if (throttled.blocked) {
    return c.json({ error: "Too many attempts", retryAfter: throttled.retryAfter }, 429);
  }

  const record = db
    .select()
    .from(personCredentials)
    .where(eq(personCredentials.personId, personId))
    .get();
  if (!record) return c.json({ error: "No PIN or password set for this profile" }, 400);

  if (record.lockedUntil && new Date(record.lockedUntil).getTime() > Date.now()) {
    const retryAfter = Math.ceil(
      (new Date(record.lockedUntil).getTime() - Date.now()) / 1000,
    );
    return c.json({ error: "Too many attempts", retryAfter }, 429);
  }

  const valid = await verifySecret(secret, record.secretHash);
  const now = new Date().toISOString();

  if (!valid) {
    throttleFail(ip);
    const newAttempts = record.failedAttempts + 1;
    const lockedUntil =
      newAttempts >= LOCKOUT_THRESHOLD
        ? new Date(Date.now() + lockoutDurationMs(newAttempts)).toISOString()
        : null;
    db.update(personCredentials)
      .set({ failedAttempts: newAttempts, lockedUntil, updatedAt: now })
      .where(eq(personCredentials.personId, personId))
      .run();
    return c.json(
      { error: "Invalid PIN or password", attemptsLeft: Math.max(0, LOCKOUT_THRESHOLD - newAttempts) },
      401,
    );
  }

  throttleReset(ip);
  db.update(personCredentials)
    .set({ failedAttempts: 0, lockedUntil: null, updatedAt: now })
    .where(eq(personCredentials.personId, personId))
    .run();

  issueSession(c, personId);
  return c.json({ success: true });
});

auth.get("/me", requireAuth, async (c) => {
  const person = c.get("person");
  const cred = db
    .select({ personId: personCredentials.personId })
    .from(personCredentials)
    .where(eq(personCredentials.personId, person.id))
    .get();
  return c.json({ ...toRoster(person), hasSecret: !!cred });
});

auth.post("/logout", requireAuth, async (c) => {
  const token = getCookie(c, "session");
  if (token) {
    db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token))).run();
    invalidateSessionCache(token);
  }
  deleteCookie(c, "session", { path: "/" });
  return c.json({ success: true });
});
