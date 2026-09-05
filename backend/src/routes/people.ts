import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { people, personCredentials } from "@/db/schema";
import { hashSecret } from "@/lib/secret";
import { newPersonId } from "@/lib/id";
import {
  requireAuth,
  requireRole,
  ROLE_LADDER,
  invalidateSessionCacheForPerson,
  type Role,
} from "@/middleware/auth";
import { toRoster, parsePersonCandidate, personToDbValues } from "@/lib/personShape";
import { validateDisplayName, validateSecret } from "@/lib/validation";
import {
  canManage,
  checkRoleChange,
  deletePerson,
  deletePeople,
  hasSecret,
  type PersonEdit,
} from "@/lib/personLifecycle";
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

  const displayName = validateDisplayName(body.displayName);
  if (!displayName.ok) return c.json({ error: displayName.error }, 400);

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
  let secret: string | undefined;
  if (body.secret !== undefined) {
    const validated = validateSecret(body.secret);
    if (!validated.ok) return c.json({ error: validated.error }, 400);
    secret = validated.value;
  }

  const now = new Date().toISOString();
  const id = newPersonId();

  // Validate the full candidate against the spec BEFORE writing: a code
  // review (2026-09-04) found this route inserting client-supplied
  // birthdate/avatarSeed straight into SQLite with only ad hoc length
  // checks, so an invalid birthdate corrupted the row and then crashed
  // every later GET /api/people (toRoster's Person.parse throwing inside
  // the .map()), not just the request that created it.
  const candidate = parsePersonCandidate({
    id,
    display_name: displayName.value,
    nickname: body.nickname ?? null,
    birthdate: body.birthdate ?? null,
    role,
    avatar_seed: body.avatarSeed ?? id,
    source: "hub",
    local_only: body.localOnly ?? false,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
  if (!candidate.success) {
    return c.json({ error: candidate.error.issues.map((i) => i.message).join("; ") }, 400);
  }

  db.insert(people).values(personToDbValues(candidate.data)).run();

  if (secret) {
    db.insert(personCredentials)
      .values({
        personId: id,
        secretHash: await hashSecret(secret),
        failedAttempts: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const { birthdate: _birthdate, ...roster } = candidate.data;
  return c.json(roster, 201);
});

// Editing and deleting a person (2026-09-05). Both were named in
// docs/BACKLOG.md as "no backend route exists for either, not just
// missing UI"; lib/personLifecycle.ts holds the rules and the erasure,
// with the reasoning for each.
peopleRoutes.patch("/:id", requireAuth, async (c) => {
  const actor = c.get("person");
  const id = c.req.param("id");
  const target = db
    .select()
    .from(people)
    .where(and(eq(people.id, id), isNull(people.deletedAt)))
    .get();
  if (!target) return c.json({ error: "no such person" }, 404);

  if (!canManage(actor, target)) {
    return c.json({ error: `${actor.role} cannot edit a ${target.role} profile` }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as PersonEdit;

  // The role is checked before anything is written, so a request that
  // changes a name AND an illegal role changes neither.
  let nextRole = target.role;
  if (body.role !== undefined && body.role !== target.role) {
    const check = checkRoleChange(actor, target, body.role, hasSecret(id));
    if (!check.ok) return c.json({ error: check.error }, check.status);
    nextRole = check.value;
  }

  let displayName = target.displayName;
  if (body.displayName !== undefined) {
    const validated = validateDisplayName(body.displayName);
    if (!validated.ok) return c.json({ error: validated.error }, 400);
    displayName = validated.value;
  }

  const now = new Date().toISOString();
  // Validated as a whole spec Person before the write, the same reason
  // POST does it: an invalid birthdate written straight to SQLite
  // corrupts the row and then crashes every later GET /api/people, not
  // just the request that caused it.
  const candidate = parsePersonCandidate({
    id: target.id,
    display_name: displayName,
    nickname: body.nickname !== undefined ? body.nickname : target.nickname,
    birthdate: body.birthdate !== undefined ? body.birthdate : target.birthdate,
    role: nextRole,
    avatar_seed: body.avatarSeed ?? target.avatarSeed,
    source: target.source,
    local_only: body.localOnly ?? target.localOnly,
    created_at: target.createdAt,
    updated_at: now,
    deleted_at: null,
  });
  if (!candidate.success) {
    return c.json({ error: candidate.error.issues.map((i) => i.message).join("; ") }, 400);
  }

  db.update(people).set(personToDbValues(candidate.data)).where(eq(people.id, id)).run();
  // A cached session carries the whole PersonRow, role included, so a
  // demotion would not take effect until the cache expired: the other
  // case auth.ts's invalidateSessionCacheForPerson was written for.
  if (nextRole !== target.role) invalidateSessionCacheForPerson(id);
  const { birthdate: _birthdate, ...roster } = candidate.data;
  return c.json(roster);
});

// Batch delete (docs/UI.md > Batch actions). Registered before the
// "/:id" DELETE below is irrelevant to Hono's matching here (different
// method and a literal path), but it is kept next to it deliberately:
// the two share every rule, and a change to one that is not made to the
// other is the bug this pairing exists to make obvious.
peopleRoutes.post("/batch-delete", requireRole("owner", "admin"), async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
  if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string")) {
    return c.json({ error: "ids must be a list of person ids" }, 400);
  }
  if (body.ids.length === 0) return c.json({ error: "no one was selected" }, 400);
  return c.json({ outcomes: deletePeople(actor, body.ids as string[]) });
});

peopleRoutes.delete("/:id", requireRole("owner", "admin"), async (c) => {
  const actor = c.get("person");
  const result = deletePerson(actor, c.req.param("id"));
  if (!result.ok) return c.json({ error: result.error }, result.status);
  // The counts come back so the UI can say what was actually removed
  // rather than "done": this is the one action in the product that
  // destroys a person's history, and a family deserves to see the size
  // of it.
  return c.json({ erased: result.value });
});
