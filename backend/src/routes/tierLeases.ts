// TIER-LEASE-03: the shared sticky-tier lease API (docs/design/tier-lease-2026-11-22.md section 4). One view, and the holder's own choices: touch, yield, pause,
// resume, release, use a lower tier. Only an owner or admin sets or clears a pin. Everything the view says is counts and kinds per lease key (rule 6a): no person,
// title or id of anyone else's activity. "Holder" means: for touch, yield, release and lower on the chat key, the person who holds the lease; for pause, resume and
// lower on the coding key, the owner of the session (a paused session holds no lease, so Resume could not ask for one).
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { getChatLease } from "@/lib/chatLeaseRuntime";
import { isLeaseKey, type LeaseKey } from "@/lib/tierLease/policy";
import { CodingSessionError, getSessionRow, setSessionTier } from "@/lib/codingSessions";
import { pauseSession, pauseMaxMs, resumeSession } from "@/lib/codingTurns";
import type { Tier } from "@/lib/tiers";
import { bandOfPerson } from "@/lib/ageBand";
import { holderNotice, pausedNotice, releasedNotice, waiterNotice, type TierLeaseNotice } from "@/lib/tierLeaseCopy";
import type { PersonRow } from "@/types";

export const tierLeasesRoutes = apiRouter();

const refusals = errorResponses({ 400: "Not a valid request", 401: "Not signed in", 403: "Only the person who holds it can do that", 404: "Not found", 409: "It cannot be done right now (the message says why)" });
const keyParam = z.object({ key: z.string().openapi({ param: { name: "key", in: "path" }, description: "chat or coding" }) });
const NOT_HOLDER = { error: "This is not yours to change. Only the person using Max can.", code: "not_holder" } as const;
const BAD_KEY = { error: "That is not a lease this home knows.", code: "not_found" } as const;
const NOT_SESSION = { error: "That session was not found. It may have been deleted.", code: "not_found" } as const;

const noticeShape = z.object({
  code: z.enum(["holder_idle", "holder_waiting", "paused", "released", "waiter", "waiter_pinned"]),
  text: z.string(), more: z.string(),
  actions: z.array(z.enum(["keep", "lower", "pause", "resume", "standard_now"])),
});
const forBand = (n: TierLeaseNotice, person: Pick<PersonRow, "id" | "role" | "controls">) => ({ code: n.code, text: bandOfPerson(person) === "child" ? n.child : n.adult, more: n.more, actions: n.actions });
const viewShape = z.object({
  key: z.enum(["chat", "coding"]),
  state: z.enum(["off", "starting", "held", "releasing"]),
  held_by_you: z.boolean(),
  pinned: z.boolean(),
  releases_in_seconds: z.number().int().nullable(),
  /** Jobs waiting for this lease: a count and the kinds only. */
  waiters: z.object({ count: z.number().int(), kinds: z.array(z.string()) }),
  holder_jobs: z.number().int(),
  /** Why the lease is held or would go, from the one policy; only for the holder. */
  decision: z.string().nullable(),
  pause_max_minutes: z.number().int(),
  /** TIER-LEASE-04: the words of the notice line for this person (their age band's form), one short sentence each; null when the line has nothing to say now. */
  notice: noticeShape.nullable(),
  /** The line to show if the lease is released while this person is idle, and for a paused session, so the page needs no words of its own. */
  released_notice: noticeShape,
  paused_notice: noticeShape,
});
const view = (key: LeaseKey, person: Pick<PersonRow, "id" | "role" | "controls">) => {
  const lease = getChatLease(); const snap = lease.snapshot();
  const here = snap.key === key && snap.state !== "off";
  const mine = here && snap.holderId === person.id;
  const d = mine && snap.state === "held" ? lease.decision() : null;
  const waiters = snap.waiters;
  const notice = here && snap.state === "held"
    ? (mine ? forBand(holderNotice({ key, waiters }), person) : waiters.count > 0 ? forBand(waiterNotice({ blocker: snap.key }), person) : null)
    : null;
  return {
    notice, released_notice: forBand(releasedNotice(waiters), person), paused_notice: forBand(pausedNotice(waiters), person),
    key, state: here ? snap.state : "off" as const, held_by_you: mine, pinned: mine && snap.pinned,
    releases_in_seconds: mine ? snap.releasesInSeconds : null,
    waiters: snap.waiters, holder_jobs: snap.holderJobs,
    decision: d ? `${d.action}:${d.reason}` : null,
    pause_max_minutes: Math.round(pauseMaxMs() / 60_000),
  };
};
const holds = (key: LeaseKey, person: Pick<PersonRow, "id">): boolean => { const snap = getChatLease().snapshot(); return snap.state === "held" && snap.key === key && snap.holderId === person.id; };
const viewResponse = { 200: { content: { "application/json": { schema: viewShape } }, description: "The lease as you may see it." }, ...refusals };

const viewRoute = createRoute({ method: "get", path: "/{key}", tags: ["AI"], summary: "The shared tier lease for one key: who it is held by (you or not), what waits for it (counts and kinds) and why it holds (TIER-LEASE-03)", middleware: [requireAuth] as const, request: { params: keyParam }, responses: viewResponse });
tierLeasesRoutes.openapi(viewRoute, (c) => {
  const key = c.req.valid("param").key;
  if (!isLeaseKey(key)) return c.json(BAD_KEY, 404) as never;
  return c.json(view(key, c.get("person")), 200);
});

const touchRoute = createRoute({ method: "post", path: "/{key}/touch", tags: ["AI"], summary: "The holder is typing or attaching: renews the grace. The composer calls it at most once every 10 seconds (TIER-LEASE-03)", middleware: [requireAuth] as const, request: { params: keyParam }, responses: viewResponse });
tierLeasesRoutes.openapi(touchRoute, (c) => {
  const key = c.req.valid("param").key; const person = c.get("person");
  if (!isLeaseKey(key)) return c.json(BAD_KEY, 404) as never;
  if (!holds(key, person) || !getChatLease().touch(person.id)) return c.json(NOT_HOLDER, 403) as never;
  return c.json(view(key, person), 200);
});

const yieldRoute = createRoute({ method: "post", path: "/{key}/yield", tags: ["AI"], summary: "Hand the lease over: now when nothing is running, else at the next step. A running request is never cut off (TIER-LEASE-03)", middleware: [requireAuth] as const, request: { params: keyParam }, responses: viewResponse });
tierLeasesRoutes.openapi(yieldRoute, async (c) => {
  const key = c.req.valid("param").key; const person = c.get("person");
  if (!isLeaseKey(key)) return c.json(BAD_KEY, 404) as never;
  if (!holds(key, person) || (await getChatLease().yieldLease(person.id)) === false) return c.json(NOT_HOLDER, 403) as never;
  return c.json(view(key, person), 200);
});

const releaseRoute = createRoute({ method: "post", path: "/{key}/release", tags: ["AI"], summary: "Give the lease back; the standard model returns between requests (TIER-LEASE-03)", middleware: [requireAuth] as const, request: { params: keyParam }, responses: viewResponse });
tierLeasesRoutes.openapi(releaseRoute, async (c) => {
  const key = c.req.valid("param").key; const person = c.get("person");
  if (!isLeaseKey(key)) return c.json(BAD_KEY, 404) as never;
  if (!holds(key, person)) return c.json(NOT_HOLDER, 403) as never;
  await getChatLease().release();
  return c.json(view(key, person), 200);
});

const sessionBody = z.object({ session_id: z.string().min(1).max(100) });
const pauseShape = z.object({ state: z.enum(["pausing", "paused"]), pause_max_minutes: z.number().int() });
const pauseRoute = createRoute({
  method: "post", path: "/{key}/pause", tags: ["AI"], summary: "Pause a coding session: the running step finishes, the session keeps all its state (also across a restart) and holds nothing. It ends by itself after the household's pause limit (TIER-LEASE-03)",
  middleware: [requireAuth] as const, request: { params: keyParam, body: { content: { "application/json": { schema: sessionBody } }, required: true } },
  responses: { 200: { content: { "application/json": { schema: pauseShape } }, description: "Paused now, or pausing when the running step ends." }, ...refusals },
});
tierLeasesRoutes.openapi(pauseRoute, (c) => {
  const key = c.req.valid("param").key; const person = c.get("person");
  if (!isLeaseKey(key)) return c.json(BAD_KEY, 404) as never;
  if (key !== "coding") return c.json({ error: "Only coding sessions can be paused.", code: "bad_request" }, 400) as never;
  const state = pauseSession(person, c.req.valid("json").session_id);
  if (!state) return c.json(getSessionRow(person.id, c.req.valid("json").session_id) ? NOT_HOLDER : NOT_SESSION, 404) as never;
  return c.json({ state, pause_max_minutes: Math.round(pauseMaxMs() / 60_000) }, 200);
});

const resumeRoute = createRoute({
  method: "post", path: "/{key}/resume", tags: ["AI"], summary: "Resume a paused coding session. It is a job in the household queue: it waits its turn and never preempts anyone (TIER-LEASE-03)",
  middleware: [requireAuth] as const, request: { params: keyParam, body: { content: { "application/json": { schema: sessionBody } }, required: true } },
  responses: { 200: { content: { "application/json": { schema: z.object({ turn_id: z.string(), tier: z.enum(["standard", "boost", "max"]) }) } }, description: "The queued turn." }, ...refusals },
});
tierLeasesRoutes.openapi(resumeRoute, (c) => {
  const key = c.req.valid("param").key; const person = c.get("person");
  if (!isLeaseKey(key)) return c.json(BAD_KEY, 404) as never;
  try {
    const sent = key === "coding" ? resumeSession(person, c.req.valid("json").session_id) : null;
    if (!sent) return c.json({ error: "That session is not paused.", code: "not_paused" }, 409) as never;
    return c.json(sent, 200);
  } catch (e) { if (e instanceof CodingSessionError) return c.json({ error: e.message, code: e.code }, e.code === "not_found" ? 404 : e.code === "busy" ? 409 : 403) as never; throw e; }
});

const TIER_RANK: Record<Tier, number> = { standard: 0, boost: 1, max: 2 };
const lowerRoute = createRoute({
  method: "post", path: "/{key}/lower", tags: ["AI"], summary: "Use a lower tier: a coding session goes down to the chosen tier, or the chat lease is released. It can only lower, through the existing tier grants (TIER-LEASE-03)",
  middleware: [requireAuth] as const, request: { params: keyParam, body: { content: { "application/json": { schema: z.object({ session_id: z.string().min(1).max(100).optional(), to: z.enum(["standard", "boost"]) }) } }, required: true } },
  responses: { 200: { content: { "application/json": { schema: z.object({ tier: z.enum(["standard", "boost", "max"]) }) } }, description: "The tier now in use." }, ...refusals },
});
tierLeasesRoutes.openapi(lowerRoute, async (c) => {
  const key = c.req.valid("param").key; const person = c.get("person"); const body = c.req.valid("json");
  if (!isLeaseKey(key)) return c.json(BAD_KEY, 404) as never;
  if (key === "chat") {
    if (body.to !== "standard") return c.json({ error: "Chat goes down to Standard.", code: "bad_request" }, 400) as never;
    if (!holds(key, person)) return c.json(NOT_HOLDER, 403) as never;
    await getChatLease().release();
    return c.json({ tier: "standard" as const }, 200);
  }
  const row = body.session_id ? getSessionRow(person.id, body.session_id) : null;
  if (!row) return c.json(NOT_SESSION, 404) as never;
  if (TIER_RANK[body.to] >= TIER_RANK[row.tier as Tier]) return c.json({ error: "This only goes to a lower level than the session uses now.", code: "bad_request" }, 400) as never;
  try { return c.json({ tier: setSessionTier(person, row.id, body.to).tier }, 200); }
  catch (e) { if (e instanceof CodingSessionError) return c.json({ error: e.message, code: e.code }, 403) as never; throw e; }
});

const pinRoute = createRoute({
  method: "put", path: "/{key}/pin", tags: ["AI"], summary: "Pin or unpin the held lease (admin waiver; ends after the key's pin cap of quiet). Admins only (TIER-LEASE-03)",
  middleware: [requireRole("owner", "admin")] as const, request: { params: keyParam, body: { content: { "application/json": { schema: z.object({ pinned: z.boolean() }) } }, required: true } },
  responses: viewResponse,
});
tierLeasesRoutes.openapi(pinRoute, (c) => {
  const key = c.req.valid("param").key; const person = c.get("person");
  if (!isLeaseKey(key)) return c.json(BAD_KEY, 404) as never;
  const snap = getChatLease().snapshot();
  if (snap.key !== key || !getChatLease().setPin(person, c.req.valid("json").pinned)) return c.json({ error: "Nothing is held to pin right now.", code: "not_held" }, 409) as never;
  return c.json(view(key, person), 200);
});
