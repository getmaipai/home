import { Hono } from "hono";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { people, personCredentials } from "@/db/schema";
import { hashSecret } from "@/lib/secret";
import { newPersonId } from "@/lib/id";
import { requireAuth, requireRole, ROLE_LADDER, type Role } from "@/middleware/auth";
import { toRoster } from "@/lib/personShape";
import type { AppEnv } from "@/types";

export const peopleRoutes = new Hono<AppEnv>();

// Every signed-in person can see the household roster (who's who, not
// management). Full admin views (birthdate, credential status per person)
// are a follow-up once the People page exists (6, 12).
peopleRoutes.get("/", requireAuth, async (c) => {
  const rows = db.select().from(people).where(isNull(people.deletedAt)).all();
  return c.json(rows.map(toRoster));
});

// Who may create which role. Not spelled out verbatim in platform plan 4.2
// (capability grants for "manage people" land with a later release); this
// is a documented judgment call (see home/docs/dev.md) narrower than
// "any admin can mint any role": only the owner can create another owner
// or an admin, so an admin account can never unilaterally create a peer.
const CREATABLE_BY: Record<Role, Role[]> = {
  owner: [...ROLE_LADDER],
  admin: ["adult", "teen", "child", "guest"],
  adult: [],
  teen: [],
  child: [],
  guest: [],
};

peopleRoutes.post("/", requireRole("owner", "admin"), async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as {
    displayName?: string;
    nickname?: string | null;
    birthdate?: string | null;
    role?: string;
    avatarSeed?: string;
    secret?: string;
    localOnly?: boolean;
  };

  const displayName = body.displayName?.trim();
  if (!displayName || displayName.length < 1 || displayName.length > 80) {
    return c.json({ error: "displayName is required (1-80 characters)" }, 400);
  }

  const role = body.role as Role;
  if (!ROLE_LADDER.includes(role)) {
    return c.json({ error: `role must be one of ${ROLE_LADDER.join(", ")}` }, 400);
  }
  const allowed = CREATABLE_BY[actor.role as Role] ?? [];
  if (!allowed.includes(role)) {
    return c.json({ error: `${actor.role} cannot create a ${role} profile` }, 403);
  }

  // 4.1: "Admins must authenticate with a PIN" generalizes here to owner
  // and admin both, since either can manage the household. A PIN-free
  // owner or admin profile is a one-request takeover for anyone who can
  // reach the API.
  if ((role === "owner" || role === "admin") && !body.secret) {
    return c.json({ error: `a ${role} profile requires a secret` }, 400);
  }
  if (body.secret && (body.secret.length < 4 || body.secret.length > 128)) {
    return c.json({ error: "secret must be 4-128 characters" }, 400);
  }

  const now = new Date().toISOString();
  const id = newPersonId();
  db.insert(people)
    .values({
      id,
      displayName,
      nickname: body.nickname ?? null,
      birthdate: body.birthdate ?? null,
      role,
      avatarSeed: body.avatarSeed ?? id,
      source: "hub",
      localOnly: body.localOnly ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  if (body.secret) {
    db.insert(personCredentials)
      .values({
        personId: id,
        secretHash: await hashSecret(body.secret),
        failedAttempts: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const created = db.select().from(people).where(eq(people.id, id)).get()!;
  return c.json(toRoster(created), 201);
});
