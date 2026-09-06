import { createRoute, z } from "@hono/zod-openapi";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { people, personCredentials } from "@/db/schema";
import { hashSecret } from "@/lib/secret";
import { newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { requireAuth, requireRoleOrGrant, ROLE_LADDER, invalidateSessionCacheForPerson, type Role } from "@/middleware/auth";
import { toRoster, parsePersonCandidate, personToDbValues, guestExpiryProblem } from "@/lib/personShape";
import { listActivePeople } from "@/lib/access";
import { validateDisplayName, validateSecret } from "@/lib/validation";
import { canManage, checkRoleChange, deletePerson, deletePeople, memorializePerson, type PersonEdit } from "@/lib/personLifecycle";
import { requiresCredential } from "@/lib/personAuthMethods";
import { effectivePermissions } from "@/lib/permissions";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { Person } from "@maipai/spec/gen/ts/person.js";

export const peopleRoutes = apiRouter();

// The household roster shape every route below returns: a Person with
// birthdate left out (4.2: birthdate is core-only). Derived from the
// real generated spec schema with `.omit()` rather than redescribed by
// hand, the same "one definition" reasoning lib/personShape.ts's own
// toRoster() already applies at the lib layer.
const RosterSchema = Person.omit({ birthdate: true });

// Every signed-in person can see the household roster (who's who, not
// management). Full admin views (birthdate, credential status per person)
// are a follow-up once the People page exists (6, 12).
const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["People"],
  summary: "The household roster",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(RosterSchema) } }, description: "Every active person." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
peopleRoutes.openapi(listRoute, (c) => c.json(listActivePeople().map(toRoster), 200));

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

const createRoute_ = createRoute({
  method: "post",
  path: "/",
  tags: ["People"],
  summary: "Create a new household profile",
  middleware: [requireRoleOrGrant(["owner", "admin"], "people.manage")] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            displayName: z.string().optional(),
            nickname: z.string().nullable().optional(),
            birthdate: z.string().nullable().optional(),
            role: z.string().optional(),
            avatarSeed: z.string().optional(),
            secret: z.string().optional(),
            localOnly: z.boolean().optional(),
            guestExpiresAt: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { content: { "application/json": { schema: RosterSchema } }, description: "Created." },
    ...errorResponses({ 400: "Invalid displayName/role/secret", 401: "Not signed in", 403: "Not allowed to create this role" }),
  },
});
peopleRoutes.openapi(createRoute_, async (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");

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

  const guestExpiresAt = body.guestExpiresAt ?? null;
  const guestProblem = guestExpiryProblem(role, guestExpiresAt);
  if (guestProblem) return c.json({ error: guestProblem }, 400);

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
    hlc: nextHlc(),
    enabled: true,
    guest_expires_at: guestExpiresAt,
    memorialized_at: null,
  });
  if (!candidate.success) {
    return c.json({ error: candidate.error.issues.map((i) => i.message).join("; ") }, 400);
  }

  db.insert(people).values(personToDbValues(candidate.data)).run();

  if (secret) {
    db.insert(personCredentials)
      .values({ personId: id, secretHash: await hashSecret(secret), failedAttempts: 0, createdAt: now, updatedAt: now })
      .run();
  }

  const { birthdate: _birthdate, ...roster } = candidate.data;
  return c.json(roster, 201);
});

// Editing and deleting a person (2026-09-05). Both were named in
// docs/BACKLOG.md as "no backend route exists for either, not just
// missing UI"; lib/personLifecycle.ts holds the rules and the erasure,
// with the reasoning for each.
const patchRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["People"],
  summary: "Edit a person's profile",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id"),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            displayName: z.string().optional(),
            nickname: z.string().nullable().optional(),
            birthdate: z.string().nullable().optional(),
            role: z.string().optional(),
            avatarSeed: z.string().optional(),
            localOnly: z.boolean().optional(),
            enabled: z.boolean().optional(),
            guestExpiresAt: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: RosterSchema } }, description: "Updated." },
    ...errorResponses({ 400: "Invalid role/displayName/birthdate/guestExpiresAt", 401: "Not signed in", 403: "Not allowed to edit this person", 404: "No such person" }),
  },
});
peopleRoutes.openapi(patchRoute, async (c) => {
  const actor = c.get("person");
  const id = c.req.valid("param").id;
  const target = db
    .select()
    .from(people)
    .where(and(eq(people.id, id), isNull(people.deletedAt)))
    .get();
  if (!target) return c.json({ error: "no such person" }, 404);

  if (!canManage(actor, target)) {
    return c.json({ error: `${actor.role} cannot edit a ${target.role} profile` }, 403);
  }

  const body = c.req.valid("json") as PersonEdit;

  // The role is checked before anything is written, so a request that
  // changes a name AND an illegal role changes neither.
  let nextRole = target.role;
  if (body.role !== undefined && body.role !== target.role) {
    const check = checkRoleChange(actor, target, body.role, requiresCredential(id));
    if (!check.ok) return c.json({ error: check.error }, check.status);
    nextRole = check.value;
  }

  let displayName = target.displayName;
  if (body.displayName !== undefined) {
    const validated = validateDisplayName(body.displayName);
    if (!validated.ok) return c.json({ error: validated.error }, 400);
    displayName = validated.value;
  }

  // Disabling yourself has the same "locks the household out" shape
  // deleting or demoting your own profile already refuses - blocked for
  // the same reason.
  if (body.enabled === false && actor.id === id) {
    return c.json({ error: "you cannot disable your own profile" }, 403);
  }

  const guestExpiresAt = body.guestExpiresAt !== undefined ? body.guestExpiresAt : target.guestExpiresAt;
  const guestProblem = guestExpiryProblem(nextRole, guestExpiresAt);
  if (guestProblem) return c.json({ error: guestProblem }, 400);

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
    hlc: nextHlc(),
    // enabled/guestExpiresAt carried forward explicitly - both have Zod
    // defaults (true / null), so leaving them out of this object would
    // silently RESET them on every edit that doesn't touch them, not
    // preserve the existing value. memorialized_at is never settable
    // here at all: only lib/personLifecycle.ts's memorializePerson()
    // (POST /api/people/:id/memorialize) may set it.
    enabled: body.enabled ?? target.enabled,
    guest_expires_at: guestExpiresAt,
    memorialized_at: target.memorializedAt,
  });
  if (!candidate.success) {
    return c.json({ error: candidate.error.issues.map((i) => i.message).join("; ") }, 400);
  }

  db.update(people).set(personToDbValues(candidate.data)).where(eq(people.id, id)).run();
  // A cached session carries the whole PersonRow, role included, so a
  // demotion would not take effect until the cache expired: the other
  // case auth.ts's invalidateSessionCacheForPerson was written for.
  // Step 7: a flip to enabled: false needs the exact same treatment -
  // resolveSession()'s query excludes disabled people, but the 10s cache
  // in front of it doesn't re-run that query, so without this an
  // already-cached session would keep authenticating a disabled person
  // for up to 10 more seconds after the admin who disabled them believes
  // it already took effect.
  const candidateEnabled = candidate.data.enabled;
  if (nextRole !== target.role || candidateEnabled !== target.enabled) invalidateSessionCacheForPerson(id);
  const { birthdate: _birthdate, ...roster } = candidate.data;
  return c.json(roster, 200);
});

// Batch delete (docs/UI.md > Batch actions). Registered before the
// "/:id" DELETE below is irrelevant to Hono's matching here (different
// method and a literal path), but it is kept next to it deliberately:
// the two share every rule, and a change to one that is not made to the
// other is the bug this pairing exists to make obvious.
const batchDeleteRoute = createRoute({
  method: "post",
  path: "/batch-delete",
  tags: ["People"],
  summary: "Delete several people at once",
  middleware: [requireRoleOrGrant(["owner", "admin"], "people.manage")] as const,
  request: {
    body: { content: { "application/json": { schema: z.object({ ids: z.array(z.string()) }) } } },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            outcomes: z.array(z.object({ id: z.string(), deleted: z.boolean(), reason: z.string().optional() })),
          }),
        },
      },
      description: "One outcome per requested id, in the same words the single-delete route would have used for a failure.",
    },
    ...errorResponses({ 400: "ids is missing, empty, or not a list of strings", 401: "Not signed in", 403: "Not owner/admin" }),
  },
});
peopleRoutes.openapi(batchDeleteRoute, (c) => {
  const actor = c.get("person");
  const { ids } = c.req.valid("json");
  if (ids.length === 0) return c.json({ error: "no one was selected" }, 400);
  return c.json({ outcomes: deletePeople(actor, ids) }, 200);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["People"],
  summary: "Delete a person and erase what the household holds about them",
  middleware: [requireRoleOrGrant(["owner", "admin"], "people.manage")] as const,
  request: { params: idParamSchema("id") },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            erased: z.object({
              memories: z.number(),
              conversations: z.number(),
              conversationThreads: z.number(),
              settings: z.number(),
              clonedVoices: z.number(),
              scheduledJobs: z.number(),
              sessions: z.number(),
              entities: z.number(),
              relationships: z.number(),
              grants: z.number(),
              approvals: z.number(),
            }),
          }),
        },
      },
      description: "What was actually removed, so the household can see the size of the erasure.",
    },
    ...errorResponses({ 400: "Cannot delete this person", 401: "Not signed in", 403: "You cannot delete your own profile, or you cannot manage this role", 404: "No such person" }),
  },
});
peopleRoutes.openapi(deleteRoute, (c) => {
  const actor = c.get("person");
  const result = deletePerson(actor, c.req.valid("param").id);
  if (!result.ok) {
    if (result.status === 400) return c.json({ error: result.error }, 400);
    if (result.status === 403) return c.json({ error: result.error }, 403);
    return c.json({ error: result.error }, 404);
  }
  // The counts come back so the UI can say what was actually removed
  // rather than "done": this is the one action in the product that
  // destroys a person's history, and a family deserves to see the size
  // of it.
  return c.json({ erased: result.value }, 200);
});

// Step 7: BACKLOG.md's "memorialise (read-only profile, PIN cleared,
// sessions revoked, export offered)". A dedicated action, not a PATCH
// field: this has real, irreversible side effects (every credential and
// session is revoked), which a generic field-by-field edit endpoint
// should never trigger as a side effect of setting one flag. "Export
// offered" is a client-side prompt after this succeeds, not something
// this route does itself.
const memorializeRoute = createRoute({
  method: "post",
  path: "/{id}/memorialize",
  tags: ["People"],
  summary: "Memorialise a profile: read-only, every credential and session revoked",
  middleware: [requireRoleOrGrant(["owner", "admin"], "people.manage")] as const,
  request: { params: idParamSchema("id") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Memorialised." },
    ...errorResponses({ 403: "You cannot memorialize your own profile, or you cannot manage this role", 404: "No such person" }),
  },
});
peopleRoutes.openapi(memorializeRoute, (c) => {
  const actor = c.get("person");
  const result = memorializePerson(actor, c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, result.status as 403 | 404);
  return c.json(result.value, 200);
});

// Step 7: the effective grant set (denies win) - lib/permissions.ts's own
// header has the full reasoning, including why "safety_stop undeniable"
// needs no special case here. Self, or owner/admin/anyone who can manage
// this person (canManage already covers "self" too) - the same reach
// PATCH already has, since a grant is exactly the kind of thing about a
// person that editing their profile already requires being able to see.
const permissionsRoute = createRoute({
  method: "get",
  path: "/{id}/permissions",
  tags: ["People"],
  summary: "This person's effective, resolved grant set",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id") },
  responses: {
    200: {
      content: { "application/json": { schema: z.array(z.object({ action: z.string(), effect: z.enum(["allow", "deny"]) })) } },
      description: "One entry per action this person has at least one active grant on.",
    },
    ...errorResponses({ 401: "Not signed in", 403: "Not allowed to see this person's permissions", 404: "No such person" }),
  },
});
peopleRoutes.openapi(permissionsRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const target = db.select().from(people).where(and(eq(people.id, id), isNull(people.deletedAt))).get();
  if (!target) return c.json({ error: "no such person" }, 404);
  if (!canManage(actor, target)) {
    return c.json({ error: `${actor.role} cannot see a ${target.role} profile's permissions` }, 403);
  }
  return c.json(effectivePermissions(id), 200);
});
