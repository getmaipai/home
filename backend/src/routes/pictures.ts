// IMGGEN-UI-01: the picture card's routes. Signed-in, per person: a job is readable and stoppable by its owner only
// (nobody sees another person's pictures, a parent included). Starting a variation passes the same age and surface
// gate as the chat tool and the same prompt check, so a route is never a way around either (IMGGEN-SAFE-01).
import { PERSISTED_HOLDS, answerableFitAsk, pendingFitAsk, type PersistedHold } from "@/lib/jobs/householdQueue";
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { routeAudience } from "@/lib/pictures/audience";
import { promptRefusalLineFor } from "@/lib/pictures/ageCheck";
import { adapterAudiencesFor, adultStylesAllowed, pictureDenial, PICTURE_DENIAL_LINE, PROMPT_REFUSAL_LINE, refusePrompt } from "@/lib/pictures/policy";
import { cancelPictureJob, fileUrl, getPictureJob, pictureJobsForTurn, plainFailure, startPictureJob, type PictureJob } from "@/lib/pictures/jobs";
import { adaptersFor } from "@/lib/pictures/adapters";
import { buildPromptPlan } from "@/lib/loras/promptPlan";
import { getLoraRecord } from "@/lib/loras/store";
import { pictureEngineStatus, pictureEngineReady, pictureNotReadyReason } from "@/lib/pictures/ready";
import { allowedQuality, jobTier, maxOffered, tierArgument } from "@/lib/tiers";
import { chooseQuality, detailedReady, isPictureQuality, QUICK_MODEL } from "@/lib/pictures/quality";
import { StackPicturesError } from "@/lib/pictures/stack";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { CHILD_LIMIT_LINE, CHILD_NEGATIVE_PROMPT, forceCartoon, kidsDailyPictures, laneOf, picturesMadeToday, releaseKid, reserveKid } from "@/lib/pictures/lane";
import { getLive, liveCardFields } from "@/lib/genLive";
import type { PersonRow } from "@/types";
import { JOB_QUEUE_COPY, jobQueueCopy, plainStageLabel } from "@/lib/jobQueueCopy";
import { likenessRefusal } from "@/lib/likeness";
import { lockedView } from "@/lib/adultLock";
import { pictureJobGroupLockState, pictureJobLockState } from "@/lib/pictures/lock";
import { setItemLock, NOT_READY_LINE, TEMPORARY_LINE } from "@/lib/adultMarks";
import { getCookie } from "hono/cookie";
import { sessionKeyOf } from "@/lib/adultLock";
import { isOwnerOrAdmin } from "@/lib/access";
import { pictureJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { db } from "@/db";

export const picturesRoutes = apiRouter();

const FileSchema = z.object({ id: z.string(), url: z.string(), width: z.number(), height: z.number(), seed: z.number().nullable(), model: z.string().nullable(), steps: z.number().nullable(), ms: z.number().nullable(), alt: z.string() });
const JobSchema = z.object({
  id: z.string(),
  state: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  percent: z.number(),
  label: z.string().describe("One plain line for the card: what is happening now."),
  position: z.number().nullable(),
  stage_label: z.string().nullable().describe("While running: the stage in words (\"Drawing, step 2 of 4\")."),
  eta_seconds: z.number().nullable().describe("While running: seconds left, from earlier pictures of this size."),
  step: z.number().nullable(), steps: z.number().nullable(),
  preview_url: z.string().nullable().describe("While running: the latest preview of where the picture is heading (a small JPEG); the `v` query changes with each new one."),
  preview_step: z.number().nullable().describe("The step the preview shows, out of `steps`."),
  elapsed_ms: z.number(),
  prompt: z.string(),
  kind: z.enum(["generate", "variation", "edit"]),
  conversation_id: z.string().nullable(),
  error: z.string().nullable(),
  files: z.array(FileSchema),
  can_vary: z.boolean(),
  quality: z.enum(["quick", "detailed"]).describe("Which kind made it: Quick (about 15 to 25 seconds) or Detailed (slower, finer, more styles)."),
  switch_to: z.enum(["quick", "detailed"]).nullable().describe("The other kind this picture can be made again as, or null (it uses a style made for one kind, or the other kind is not on this computer)."),
  max_offered: z.boolean().describe("Whether this person is shown Make it Max: they hold Max, the age band reaches it and a Max model is set for this kind."),
  size: z.string().describe("The size being made, like 1024x1024."),
  fit_ask: z.object({ job_id: z.string(), picked: z.string().nullable(), actual: z.string().nullable() }).nullable().describe("Set while this card is asking whether to make it now with the level it can run at (TIER-PRIO-07; `picked` and `actual` are the level names the buttons use) and this person may answer: POST /api/ai/jobs/{job_id}/fit-answer with allow or wait. Null otherwise."),
  stop_id: z.string().describe("The id to POST to /jobs/{id}/cancel to stop what is being made now."),
});
const CardOrLocked = z.union([JobSchema, z.object({ locked: z.literal(true), making: z.boolean() })]);

const adultMarkRoute = createRoute({
  method: "post", path: "/jobs/{id}/adult-mark", tags: ["Pictures"], summary: "Mark a picture NSFW again, or remove its Adult lock with a fresh passcode ticket", middleware: [requireAuth] as const,
  request: { params: z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) }), body: { content: { "application/json": { schema: z.object({ action: z.enum(["clear", "mark"]), ticket: z.string().min(1).max(200).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ made_audience: z.enum(["all-ages", "adult-only"]), lock: z.enum(["on", "off"]) }) } }, description: "The state now." }, ...errorResponses({ 403: "Not the adult owner screen, or missing passcode proof", 404: "No such picture", 409: "Not ready or temporary" }) },
});
picturesRoutes.openapi(adultMarkRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const { action, ticket } = c.req.valid("json");
  const own = getPictureJob(actor, id);
  let fileId: string | undefined;
  if (own) {
    if (own.temporary) return c.json({ error: TEMPORARY_LINE }, 409) as never;
    if (own.state !== "done" || !own.files[0]) return c.json({ error: NOT_READY_LINE }, 409) as never;
    fileId = own.files[0].id;
  } else if (action === "mark" && isOwnerOrAdmin(actor)) {
    const row = db.select({ files: pictureJobs.files, state: pictureJobs.state }).from(pictureJobs).where(eq(pictureJobs.id, id)).get();
    try { fileId = row?.state === "done" ? (JSON.parse(row.files) as Array<{ id?: string }>)[0]?.id : undefined; } catch { fileId = undefined; }
  }
  if (!fileId) return c.json({ error: "That picture isn't available any more." }, 404) as never;
  const result = setItemLock({ actor, fileId, action, ticket: ticket ?? null, ticketItem: id, sessionKey: sessionKeyOf(getCookie(c, "session")) });
  if (!result.ok) return c.json({ error: result.error }, result.status) as never;
  return c.json({ made_audience: result.made_audience, lock: result.lock }, 200);
});


export function phaseLabel(job: PictureJob, audience: "adult" | "child" = "adult"): string {
  const hold = (job as PictureJob & { riseReason?: string }).riseReason ?? (job.phase?.startsWith("held:") ? job.phase.slice(5) : null);
  if (hold === "tier_ask" && audience === "adult") { const line = pendingFitAsk(job.id)?.line; if (line) return line; }
  if (hold && PERSISTED_HOLDS.includes(hold)) return jobQueueCopy("queued", hold as PersistedHold, job.position, null, audience);
  if (job.state === "queued") return job.position && job.position > 1 ? jobQueueCopy("queued", "picture_line", job.position, null, audience).replace("N", String(job.position)) : jobQueueCopy("queued", "picture_engine", null, null, audience);
  if (job.phase === "waiting for memory") return jobQueueCopy("waiting_memory", "picture_memory", null, null, audience);
  if (job.phase === "paused: low memory") return JOB_QUEUE_COPY.picture_paused_memory[audience];
  if (job.phase === "starting" || job.phase === "setting up" || job.phase === "loading") return JOB_QUEUE_COPY.picture_starting[audience];
  if (job.phase === "decoding") return "Finishing the picture";
  if (job.phase === "finding people") return "Finding the people in the picture";
  if (job.phase === "removing people") return "Removing them and filling in the background";
  if (job.phase === "enlarging") return "Making the picture bigger";
  if (job.phase === "removing background") return "Removing the background";
  if (job.phase === "starting") return "Getting ready";
  if (job.kind === "edit") return "Changing the picture";
  return "Drawing";
}

/** IMGGEN-QUALITY-01: the card's kind and the other kind it can be made again as. A picture made with a style is bound to the style's maker, so it offers no switch. */
function qualityFields(job: PictureJob, detailedReadyNow: boolean, can: boolean): { quality: "quick" | "detailed"; switch_to: "quick" | "detailed" | null } {
  const quality = job.request.quality ?? "quick";
  if (!can || job.request.loras.length > 0) return { quality, switch_to: null };
  if (quality === "detailed") return { quality, switch_to: "quick" };
  return { quality, switch_to: detailedReadyNow ? "detailed" : null };
}

/** The card for a job: the first picture and every variation made from it are one card. While any of them is
 * being made the card shows that one's progress; the pictures finished so far stay in view. `job` is the id to
 * stop (the one being made), or the card's own id when nothing is. */
/** A teen or child never gets a half-drawn frame: the finished-item check has not seen it (lane safety review, 2026-10-17). */
function withheldFromYoung<T extends { preview_url: string | null; preview_step: number | null }>(actor: PersonRow, fields: T): T {
  return laneOfPerson(actor) === "adult" ? fields : { ...fields, preview_url: null, preview_step: null };
}
export function cardView(actor: PersonRow, root: PictureJob, canVary: boolean, detailedReadyNow = false) {
  // A child never sees a maker's name or a Detailed or Quick choice (KIDS-CREATE-01): Quick is all they get.
  const kid = laneOfPerson(actor) === "child";
  if (kid) detailedReadyNow = false;
  const group = root.turnId ? pictureJobsForTurn(actor, root.turnId).filter((j) => j.kind !== "edit") : [root];
  const jobs = group.length > 0 ? group : [root];
  const active = jobs.find((j) => j.state === "queued" || j.state === "running") ?? null;
  const last = jobs[jobs.length - 1]!;
  const alt = root.prompt.replace(/\s+/g, " ").trim().slice(0, 200);
  const files = jobs.flatMap((j) => j.state === "done" ? j.files.map((f) => ({ id: f.id, url: fileUrl(j, f), width: f.width, height: f.height, seed: f.seed, model: kid ? null : f.model, steps: kid ? null : f.steps, ms: f.ms, alt })) : []);
  const shown = active ?? last;
  const state = active ? active.state : files.length > 0 ? "done" as const : last.state;
  return {
    id: root.id, state, percent: active ? active.percent : state === "done" ? 100 : last.percent, label: active ? (active.state === "running" ? plainStageLabel(getLive(active.id)?.stageLabel, kid ? "child" : "adult") : null) ?? phaseLabel(active, kid ? "child" : "adult") : "", position: active ? active.position : null,
    ...(active && active.state === "running" ? withheldFromYoung(actor, liveCardFields(active.id, (version) => `/api/pictures/jobs/${encodeURIComponent(active.id)}/preview?v=${version}`)) : { stage_label: null, eta_seconds: null, step: null, steps: null, preview_url: null, preview_step: null }),
    elapsed_ms: Math.max(0, Date.now() - new Date(shown.createdAt).getTime()), prompt: root.prompt, kind: root.kind, conversation_id: root.conversationId,
    error: active ? null : last.state === "failed" || last.state === "cancelled" ? last.error : null, files, size: shown.request.size, stop_id: (active ?? root).id, fit_ask: active && active.state === "queued" && !kid ? answerableFitAsk(actor, active.id) : null,
    can_vary: canVary && root.kind !== "edit" && !active && files.length > 0 && files.length < 12,
    ...qualityFields(last, detailedReadyNow, canVary && root.kind !== "edit" && !active),
    max_offered: canVary && root.kind !== "edit" && !active && !kid && maxOffered(actor, "image"),
  };
}

export function pictureCardOrLocked(actor: PersonRow, job: PictureJob, canVary: boolean, detailedReadyNow = false) {
  const group = job.turnId ? pictureJobsForTurn(actor, job.turnId).filter((item) => item.kind !== "edit") : [job];
  const jobs = group.length ? group : [job];
  if (pictureJobGroupLockState(actor, job) !== "open") return lockedView(jobs.some((item) => item.state === "queued" || item.state === "running"));
  return cardView(actor, job, canVary, detailedReadyNow);
}

const idParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });
const refusals = errorResponses({ 401: "Not signed in", 403: "Pictures are off for this profile", 404: "No such picture job", 409: "A picture is still being made", 422: "That request is not allowed", 502: "Pictures could not be made", 503: "Pictures are not ready" });

const statusRoute = createRoute({
  method: "get", path: "/status", tags: ["Pictures"], summary: "Whether this person can make pictures now, and why not", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ can_make: z.boolean(), reason: z.string().nullable(), engine_ready: z.boolean(), adult_styles: z.boolean(), styles: z.array(z.object({ id: z.string(), name: z.string() })) }) } }, description: "Additive." }, ...errorResponses({ 401: "Not signed in" }) },
});
picturesRoutes.openapi(statusRoute, async (c) => {
  const actor = c.get("person");
  const audience = routeAudience(actor);
  const denial = pictureDenial(audience);
  const ready = await pictureEngineReady();
  const styles = denial ? [] : (await adaptersFor(adapterAudiencesFor(audience))).map((a) => ({ id: a.id, name: a.name }));
  const engine = await pictureEngineStatus();
  return c.json({
    can_make: denial === null && ready,
    reason: denial ? PICTURE_DENIAL_LINE[denial] : ready ? null : pictureNotReadyReason(engine),
    engine_ready: ready,
    adult_styles: denial === null && laneOf(routeAudience(actor)) === "adult" && adultStylesAllowed(),
    styles,
  }, 200);
});

const getRoute = createRoute({
  method: "get", path: "/jobs/{id}", tags: ["Pictures"], summary: "Progress, then the finished pictures, of one picture job", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "application/json": { schema: CardOrLocked } }, description: "The job as its owner sees it, or the lock tile." }, ...refusals },
});
picturesRoutes.openapi(getRoute, async (c) => {
  const actor = c.get("person");
  const job = getPictureJob(actor, c.req.valid("param").id);
  if (!job) return c.json({ error: "That picture isn't available any more. Ask for it again." }, 404) as never;
  if (pictureJobGroupLockState(actor, job) === "hidden") return c.json({ error: "That picture isn't available any more. Ask for it again." }, 404) as never;
  return c.json(pictureCardOrLocked(actor, job, pictureDenial(routeAudience(actor)) === null, detailedReady(await pictureEngineStatus())), 200);
});

const previewRoute = createRoute({
  method: "get", path: "/jobs/{id}/preview", tags: ["Pictures"], summary: "The latest preview of a picture being drawn (a small JPEG)", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "image/jpeg": { schema: z.string() } }, description: "The preview, for the job's owner only." }, ...errorResponses({ 401: "Not signed in", 404: "No preview" }) },
});
picturesRoutes.openapi(previewRoute, (c) => {
  const actor = c.get("person");
  const job = getPictureJob(actor, c.req.valid("param").id);
  const preview = job && laneOfPerson(actor) === "adult" && pictureJobLockState(actor, job) === "open" ? getLive(job.id)?.preview : null;
  if (!job || !preview) return c.json({ error: "There is no preview for that picture." }, 404, { "cache-control": "private, no-store" }) as never;
  return new Response(preview, { status: 200, headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } }) as never;
});

const cancelRoute = createRoute({
  method: "post", path: "/jobs/{id}/cancel", tags: ["Pictures"], summary: "Stop a picture that is waiting or being drawn", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "application/json": { schema: CardOrLocked } }, description: "The job, now stopped, or the lock tile." }, ...refusals },
});
picturesRoutes.openapi(cancelRoute, async (c) => {
  const actor = c.get("person");
  const wanted = getPictureJob(actor, c.req.valid("param").id);
  if (!wanted) return c.json({ error: "That picture isn't available any more." }, 404) as never;
  if (pictureJobGroupLockState(actor, wanted) === "hidden") return c.json({ error: "That picture isn't available any more." }, 404) as never;
  if (pictureJobGroupLockState(actor, wanted) !== "open") return c.json(pictureCardOrLocked(actor, wanted, false), 200);
  const job = await cancelPictureJob(actor, wanted.id);
  if (!job) return c.json({ error: "That picture isn't available any more." }, 404) as never;
  return c.json(pictureCardOrLocked(actor, job, pictureDenial(routeAudience(actor)) === null, detailedReady(await pictureEngineStatus())), 200);
});

const variationRoute = createRoute({
  method: "post", path: "/jobs/{id}/variation", tags: ["Pictures"], summary: "Make another version of a picture with a new seed, or try a failed or stopped one again", middleware: [requireAuth] as const,
  request: { params: idParams, body: { required: false, content: { "application/json": { schema: z.object({ quality: z.enum(["quick", "detailed"]).optional().describe("Make it again as this kind. Left out, the picture keeps its own kind."), tier: z.enum(["standard", "boost", "max"]).optional().describe("Make it again at this level. Max needs an admin's OK and a Max model; a level the person may not use is lowered."), prompt: z.string().trim().min(1).max(2000).optional().describe("Remix: new words describing the changes. Left out, the picture is made again from its own words.") }) } } } },
  responses: { 200: { content: { "application/json": { schema: JobSchema } }, description: "A new job in the same chat." }, ...refusals },
});
picturesRoutes.openapi(variationRoute, async (c) => {
  const actor = c.get("person");
  const source = getPictureJob(actor, c.req.valid("param").id);
  if (!source) return c.json({ error: "That picture isn't available any more. Ask for it again." }, 404) as never;
  const lock = pictureJobGroupLockState(actor, source);
  if (lock === "hidden") return c.json({ error: "That picture isn't available any more. Ask for it again." }, 404) as never;
  if (lock === "locked") return c.json({ error: "That is locked. Unlock it with your passcode first, then try again." }, 423) as never;
  const denial = pictureDenial(routeAudience(actor));
  if (denial) return c.json({ error: PICTURE_DENIAL_LINE[denial], code: denial }, 403) as never;
  if (source.state === "queued" || source.state === "running") return c.json({ error: "That picture isn't available any more. Ask for it again." }, 404) as never;
  // One at a time: a card with a picture still being made takes no second one.
  const group = source.turnId ? pictureJobsForTurn(actor, source.turnId) : [source];
  if (group.some((j) => j.state === "queued" || j.state === "running")) return c.json({ error: "A picture is still being made. Wait for it or stop it first.", code: "busy" }, 409) as never;
  const asked = (await c.req.json().catch(() => ({}))) as { quality?: unknown; tier?: unknown; prompt?: unknown };
  const words = typeof asked.prompt === "string" && asked.prompt.trim() ? asked.prompt.trim().slice(0, 2000) : source.prompt;
  const adapters = await adaptersFor(adapterAudiencesFor(routeAudience(actor)));
  // Only styles this person may still use ride along (one turned off since is dropped); their trigger words go with them.
  const used = source.request.loras.flatMap((id) => { const a = adapters.find((x) => x.id === id); return a ? [a] : []; });
  // Old saved picture jobs may contain four adapters; the current plan uses the first two in their saved order.
  const plan = buildPromptPlan({ words, styles: used.slice(0, 2).flatMap((adapter) => { const record = getLoraRecord(adapter.id); return record ? [record] : []; }), strength: undefined, negativePrompt: "none", media: "picture" });
  if (!plan.ok) return c.json({ error: plan.line, code: plan.code }, 422) as never;
  const prompt = plan.prompt;
  const lane = laneOf(routeAudience(actor));
  const kid = lane === "child";
  const refused = refusePrompt(`${prompt} ${used.map((a) => a.name).join(" ")}`, { lane });
  if (refused) return c.json({ error: promptRefusalLineFor(refused, "picture", actor, routeAudience(actor).band, prompt, PROMPT_REFUSAL_LINE[refused]), code: refused }, 422) as never;
  { const likeness = likenessRefusal(actor, prompt); if (likeness) return c.json({ error: likeness, code: "household_likeness_off" }, 422) as never; }
  // KIDS-CREATE-01: a child's another-one is also a cartoon, Quick, within the daily limit, and never with a style.
  if (kid && picturesMadeToday(actor) + 1 > kidsDailyPictures()) return c.json({ error: CHILD_LIMIT_LINE, code: "daily_limit" }, 422) as never;
  if (!(await pictureEngineReady())) return c.json({ error: pictureNotReadyReason(await pictureEngineStatus()), code: "not_installed" }, 503) as never;
  // IMGGEN-QUALITY-01: Quick or Detailed again. Left out, the picture keeps its own kind; a style made for one maker decides.
  const choice = kid ? { quality: "quick" as const, model: QUICK_MODEL, note: null, announce: false } : chooseQuality({ requested: allowedQuality(actor, "image", isPictureQuality(asked.quality) ? asked.quality : tierArgument({ person: actor, category: "image", arg: asked.tier, band: routeAudience(actor).band }).quality ?? source.request.quality ?? "quick", routeAudience(actor).band), style: used[0] ?? null, engine: await pictureEngineStatus() });
  const loras = plan.loras.map((lora) => ({ id: lora.id, scale: lora.strength }));
  const slot = kid ? reserveKid(actor, "picture", 1, words) : null;
  if (kid && !slot) return c.json({ error: CHILD_LIMIT_LINE, code: "daily_limit" }, 422) as never;
  try {
    const job = await startPictureJob({
      actor, conversationId: source.conversationId, turnId: source.turnId, temporary: source.temporary, kind: group.some((j) => j.state === "done") ? "variation" : "generate", prompt: words,
      tier: jobTier("image", tierArgument({ person: actor, category: "image", arg: asked.tier, band: routeAudience(actor).band }).tier, choice.quality),
      body: { prompt: kid ? forceCartoon(prompt) : prompt, size: source.request.size, n: 1, ...(choice.model ? { model: choice.model } : {}), audience: lane === "adult" && adultStylesAllowed() ? "adult" : "all-ages", ...(kid ? { negative_prompt: CHILD_NEGATIVE_PROMPT } : {}), ...(loras.length ? { loras } : {}) }, sourceFileId: source.files[0]?.id ?? null,
    });
    void job;
    return c.json(cardView(actor, source, true, detailedReady(await pictureEngineStatus())), 200);
  } catch (error) {
    releaseKid(slot);
    const status = error instanceof StackPicturesError && (error.status === 422 || error.status === 409) ? error.status : 503;
    return c.json({ error: plainFailure(error), code: error instanceof StackPicturesError ? error.code : "failed" }, status) as never;
  }
});
