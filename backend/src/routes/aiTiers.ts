// TIER-HOME-03 and TIER-HOME-05: the Max window and the Max chat lease, and a job's "run it lower now?" answer (TIER-PRIO-07). What is left of the old
// `/api/ai` card routes after the Stack took every model choice (STACK-MODELS-HOME-01: the shared page's forwarder is routes/aiStack.ts). These three
// are Home's own: they are about who holds the computer right now, not about which model a level uses.
import { maxEstimates } from "@/lib/chatTransitions";
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { getChatLease } from "@/lib/chatLeaseRuntime";
import { holdsMax } from "@/lib/tiers";
import { activeProfileLine, answerFitAsk, currentMaxWindow, endMaxWindow, pendingFitAsk } from "@/lib/jobs/householdQueue";
import { closedAppsLines } from "@/lib/jobs/closeApps";
import { codingModeReadiness } from "@/lib/codingMode";
import { isOwnerOrAdmin } from "@/lib/access";
import { ensureSelfTest } from "@/lib/maxAutoSelfTest";

export const aiTiersRoutes = apiRouter();

const refusals = errorResponses({ 401: "Not signed in", 403: "Admins only", 404: "Not found", 409: "It cannot be done right now (the message says why)", 503: "The engine is not answering" });

const MAX_RUNNING_LINE = "A Max job is running and other jobs wait. Stop it and chat returns to normal.";
const windowRoute = createRoute({
  method: "get", path: "/tier-window", tags: ["AI"], summary: "Whether a Max job holds the computer, what each category does meanwhile and which apps were closed, for admins only (TIER-HOME-03, TIER-PRIO-05)",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ open: z.boolean(), minutes_left: z.number().int().nullable(), line: z.string().nullable(), profile: z.string().nullable(), closed_apps: z.array(z.string()) }) } }, description: "The open Max window, if any." }, ...refusals },
});
aiTiersRoutes.openapi(windowRoute, async (c) => {
  const open = await currentMaxWindow();
  return c.json({ open: open !== null, minutes_left: open?.minutesLeft ?? null, line: open ? MAX_RUNNING_LINE : null, profile: await activeProfileLine(), closed_apps: closedAppsLines() }, 200);
});
const stopWindowRoute = createRoute({
  method: "post", path: "/tier-window/stop", tags: ["AI"], summary: "Stop the running Max job so the room and chat come back (TIER-HOME-03)",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ stopped: z.boolean() }) } }, description: "True when a Max job was running and has been stopped." }, ...refusals },
});
aiTiersRoutes.openapi(stopWindowRoute, async (c) => c.json({ stopped: await endMaxWindow() }, 200));

const jobAskRoute = createRoute({
  method: "post", path: "/jobs/{id}/fit-answer", tags: ["AI"], summary: "Answer a job's question: run it at the lower tier now (allow) or keep waiting for the tier that was picked (wait) (TIER-PRIO-07)",
  middleware: [requireAuth] as const,
  request: { params: z.object({ id: z.string().openapi({ param: { name: "id", in: "path" } }) }), body: { content: { "application/json": { schema: z.object({ answer: z.enum(["allow", "wait"]) }) } }, required: true } },
  responses: { 200: { content: { "application/json": { schema: z.object({ answered: z.boolean() }) } }, description: "True when the question was open and is now answered; false when there is nothing to answer (it already started, was answered, or timed out into waiting)." }, ...refusals },
});
aiTiersRoutes.openapi(jobAskRoute, (c) => {
  const person = c.get("person");
  const id = c.req.valid("param").id;
  const ask = pendingFitAsk(id);
  // Only the person who made the job, or an admin, can answer for it.
  if (ask && ask.personId !== person.id && !isOwnerOrAdmin(person)) return c.json({ error: "Only the person who made this, or an admin, can answer.", code: "forbidden" }, 403) as never;
  return c.json({ answered: ask ? answerFitAsk(id, c.req.valid("json").answer) : false }, 200);
});

const leaseShape = z.object({ state: z.enum(["off", "starting", "held", "releasing"]), held_by_you: z.boolean(), pinned: z.boolean(), can_use: z.boolean(), releases_in_seconds: z.number().int().nullable(), estimates: z.object({ max_load_s: z.number().int(), self_test_s: z.number().int() }) });
const leaseView = (person: { id: string; role: string }) => {
  const snap = getChatLease().snapshot();
  const mine = snap.holderId === person.id;
  return { state: snap.state, held_by_you: mine, pinned: mine && snap.pinned, can_use: person.role !== "teen" && holdsMax(person as never, "chat"), releases_in_seconds: mine ? snap.releasesInSeconds : null, estimates: maxEstimates() };
};
const leaseGetRoute = createRoute({
  method: "get", path: "/chat-lease", tags: ["AI"], summary: "Whether the big chat model is leased, whether you hold it and whether you may (TIER-HOME-05)",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: leaseShape } }, description: "Your view of the Max chat lease." }, ...refusals },
});
aiTiersRoutes.openapi(leaseGetRoute, (c) => c.json(leaseView(c.get("person")), 200));
const leaseTakeRoute = createRoute({
  method: "post", path: "/chat-lease", tags: ["AI"], summary: "Take the Max chat lease: Home loads the big chat model and gives it back by itself when you go quiet (TIER-HOME-05)",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ pinned: z.boolean().optional() }) } }, required: false } },
  responses: { 200: { content: { "application/json": { schema: leaseShape } }, description: "The lease is yours." }, ...refusals },
});
const LEASE_REFUSAL: Record<string, { status: 403 | 409 | 503; line: string }> = {
  not_a_holder: { status: 403, line: "Max is not on for you. Ask an admin." },
  not_ready: { status: 409, line: "Max is not set up. Finish Coding setup." },
  swap_failed: { status: 503, line: "Max did not load. Try again in a minute." },
  stack_busy: { status: 409, line: "Someone else is using Max. Try later." },
  max_window: { status: 409, line: "A Max job is running. Try when it ends." },
};
aiTiersRoutes.openapi(leaseTakeRoute, async (c) => {
  const person = c.get("person");
  const body = await c.req.json().catch(() => ({})) as { pinned?: boolean };
  let result = await getChatLease().acquire(person, { pinned: body.pinned === true });
  // A stale self-test is the one step Home can do for the person: run it now, then try once more.
  if (!result.ok && result.refusal === "not_ready" && (await ensureSelfTest())) result = await getChatLease().acquire(person, { pinned: body.pinned === true });
  if (!result.ok) {
    const refusal = LEASE_REFUSAL[result.refusal]!;
    // not_ready names the step that is missing so the composer can offer it (a stale self-test is the common one, and an admin can run it).
    const firstUnmet = result.refusal === "not_ready" ? (await codingModeReadiness().catch(() => null))?.first_unmet ?? null : null;
    const line = firstUnmet === "self_test" ? "Max needs a quick test first." : refusal.line;
    return c.json({ error: line, code: result.refusal, ...(result.refusal === "not_ready" ? { first_unmet: firstUnmet } : {}) }, refusal.status) as never;
  }
  return c.json(leaseView(person), 200);
});
const leaseReleaseRoute = createRoute({
  method: "delete", path: "/chat-lease", tags: ["AI"], summary: "Give the Max chat lease back; chat returns to the standard model between requests (TIER-HOME-05)",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: leaseShape } }, description: "The lease after release." }, ...refusals },
});
aiTiersRoutes.openapi(leaseReleaseRoute, async (c) => {
  const person = c.get("person");
  const snap = getChatLease().snapshot();
  const admin = isOwnerOrAdmin(person);
  if (snap.state === "held" && (snap.holderId === person.id || admin)) await getChatLease().release();
  return c.json(leaseView(person), 200);
});
