// IMGGEN-UI-01: the picture card's routes. Signed-in, per person: a job is readable and stoppable by its owner only
// (nobody sees another person's pictures, a parent included). Starting a variation passes the same age and surface
// gate as the chat tool and the same prompt check, so a route is never a way around either (IMGGEN-SAFE-01).
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { routeAudience } from "@/lib/pictures/audience";
import { promptRefusalLineFor } from "@/lib/pictures/ageCheck";
import { adapterAudiencesFor, adultAdaptersAllowed, pictureDenial, PICTURE_DENIAL_LINE, PROMPT_REFUSAL_LINE, refusePrompt } from "@/lib/pictures/policy";
import { cancelPictureJob, fileUrl, getPictureJob, pictureJobsForTurn, plainFailure, startPictureJob, type PictureJob } from "@/lib/pictures/jobs";
import { adaptersFor, withTriggerWords } from "@/lib/pictures/adapters";
import { pictureEngineStatus, pictureEngineReady, pictureNotReadyReason } from "@/lib/pictures/ready";
import { allowedQuality } from "@/lib/tiers";
import { chooseQuality, detailedReady, isPictureQuality } from "@/lib/pictures/quality";
import { StackPicturesError } from "@/lib/pictures/stack";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { CHILD_LIMIT_LINE, CHILD_NEGATIVE_PROMPT, forceCartoon, kidsDailyPictures, laneOf, picturesMadeToday, releaseKid, reserveKid } from "@/lib/pictures/lane";
import { getLive, liveCardFields } from "@/lib/genLive";
import type { PersonRow } from "@/types";

export const picturesRoutes = apiRouter();

const FileSchema = z.object({ id: z.string(), url: z.string(), width: z.number(), height: z.number(), seed: z.number().nullable(), model: z.string().nullable(), steps: z.number().nullable(), ms: z.number().nullable(), alt: z.string() });
const JobSchema = z.object({
  id: z.string(),
  state: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  percent: z.number(),
  label: z.string().describe("One plain line for the card: what the engine is doing now."),
  position: z.number().nullable(),
  stage_label: z.string().nullable().describe("While running: the engine's stage in words (\"Drawing, step 2 of 4\")."),
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
  size: z.string().describe("The size being made, like 1024x1024."),
  stop_id: z.string().describe("The id to POST to /jobs/{id}/cancel to stop what is being made now."),
});


function phaseLabel(job: PictureJob): string {
  if (job.state === "queued") return job.position && job.position > 1 ? `Waiting in line, number ${job.position}` : "Waiting for the picture engine";
  if (job.phase === "waiting for memory") return "Waiting for memory to free up";
  if (job.phase === "paused: low memory") return "Paused: low memory";
  if (job.phase === "starting" || job.phase === "setting up" || job.phase === "loading") return "Getting the picture model ready";
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
    id: root.id, state, percent: active ? active.percent : state === "done" ? 100 : last.percent, label: active ? (active.state === "running" ? getLive(active.id)?.stageLabel : null) ?? phaseLabel(active) : "", position: active ? active.position : null,
    ...(active && active.state === "running" ? withheldFromYoung(actor, liveCardFields(active.id, (version) => `/api/pictures/jobs/${encodeURIComponent(active.id)}/preview?v=${version}`)) : { stage_label: null, eta_seconds: null, step: null, steps: null, preview_url: null, preview_step: null }),
    elapsed_ms: Math.max(0, Date.now() - new Date(shown.createdAt).getTime()), prompt: root.prompt, kind: root.kind, conversation_id: root.conversationId,
    error: active ? null : last.state === "failed" || last.state === "cancelled" ? last.error : null, files, size: shown.request.size, stop_id: (active ?? root).id,
    can_vary: canVary && root.kind !== "edit" && !active && files.length > 0 && files.length < 12,
    ...qualityFields(last, detailedReadyNow, canVary && root.kind !== "edit" && !active),
  };
}

const idParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });
const refusals = errorResponses({ 401: "Not signed in", 403: "Pictures are off for this profile", 404: "No such picture job", 409: "A picture is still being made", 422: "That request is not allowed", 502: "The picture engine refused it", 503: "The picture engine is not available" });

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
    adult_styles: denial === null && laneOf(routeAudience(actor)) === "adult" && adultAdaptersAllowed(),
    styles,
  }, 200);
});

const getRoute = createRoute({
  method: "get", path: "/jobs/{id}", tags: ["Pictures"], summary: "Progress, then the finished pictures, of one picture job", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "application/json": { schema: JobSchema } }, description: "The job as its owner sees it." }, ...refusals },
});
picturesRoutes.openapi(getRoute, async (c) => {
  const actor = c.get("person");
  const job = getPictureJob(actor, c.req.valid("param").id);
  if (!job) return c.json({ error: "That picture isn't available any more. Ask for it again." }, 404) as never;
  return c.json(cardView(actor, job, pictureDenial(routeAudience(actor)) === null, detailedReady(await pictureEngineStatus())), 200);
});

const previewRoute = createRoute({
  method: "get", path: "/jobs/{id}/preview", tags: ["Pictures"], summary: "The latest preview of a picture being drawn (a small JPEG)", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "image/jpeg": { schema: z.string() } }, description: "The preview, for the job's owner only." }, ...errorResponses({ 401: "Not signed in", 404: "No preview" }) },
});
picturesRoutes.openapi(previewRoute, (c) => {
  const actor = c.get("person");
  const job = getPictureJob(actor, c.req.valid("param").id);
  const preview = job && laneOfPerson(actor) === "adult" ? getLive(job.id)?.preview : null;
  if (!job || !preview) return c.json({ error: "There is no preview for that picture." }, 404) as never;
  return new Response(preview, { status: 200, headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } }) as never;
});

const cancelRoute = createRoute({
  method: "post", path: "/jobs/{id}/cancel", tags: ["Pictures"], summary: "Stop a picture that is waiting or being drawn", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "application/json": { schema: JobSchema } }, description: "The job, now stopped (a finished job stays finished)." }, ...refusals },
});
picturesRoutes.openapi(cancelRoute, async (c) => {
  const actor = c.get("person");
  const job = await cancelPictureJob(actor, c.req.valid("param").id);
  if (!job) return c.json({ error: "That picture isn't available any more." }, 404) as never;
  return c.json(cardView(actor, job, pictureDenial(routeAudience(actor)) === null, detailedReady(await pictureEngineStatus())), 200);
});

const variationRoute = createRoute({
  method: "post", path: "/jobs/{id}/variation", tags: ["Pictures"], summary: "Make another version of a picture with a new seed, or try a failed or stopped one again", middleware: [requireAuth] as const,
  request: { params: idParams, body: { required: false, content: { "application/json": { schema: z.object({ quality: z.enum(["quick", "detailed"]).optional().describe("Make it again as this kind. Left out, the picture keeps its own kind."), prompt: z.string().trim().min(1).max(2000).optional().describe("Remix: new words describing the changes. Left out, the picture is made again from its own words.") }) } } } },
  responses: { 200: { content: { "application/json": { schema: JobSchema } }, description: "A new job in the same chat." }, ...refusals },
});
picturesRoutes.openapi(variationRoute, async (c) => {
  const actor = c.get("person");
  const denial = pictureDenial(routeAudience(actor));
  if (denial) return c.json({ error: PICTURE_DENIAL_LINE[denial], code: denial }, 403) as never;
  const source = getPictureJob(actor, c.req.valid("param").id);
  if (!source || source.state === "queued" || source.state === "running") return c.json({ error: "That picture isn't available any more. Ask for it again." }, 404) as never;
  // One at a time: a card with a picture still being made takes no second one.
  const group = source.turnId ? pictureJobsForTurn(actor, source.turnId) : [source];
  if (group.some((j) => j.state === "queued" || j.state === "running")) return c.json({ error: "A picture is still being made. Wait for it or stop it first.", code: "busy" }, 409) as never;
  const asked = (await c.req.json().catch(() => ({}))) as { quality?: unknown; prompt?: unknown };
  const words = typeof asked.prompt === "string" && asked.prompt.trim() ? asked.prompt.trim().slice(0, 2000) : source.prompt;
  const adapters = await adaptersFor(adapterAudiencesFor(routeAudience(actor)));
  // Only styles this person may still use ride along (one turned off since is dropped); their trigger words go with them.
  const used = source.request.loras.flatMap((id) => { const a = adapters.find((x) => x.id === id); return a ? [a] : []; });
  const prompt = used.reduce((text, a) => withTriggerWords(text, a), words);
  const lane = laneOf(routeAudience(actor));
  const kid = lane === "child";
  const refused = refusePrompt(`${prompt} ${used.map((a) => a.name).join(" ")}`, { lane });
  if (refused) return c.json({ error: promptRefusalLineFor(refused, "picture", actor, routeAudience(actor).band, prompt, PROMPT_REFUSAL_LINE[refused]), code: refused }, 422) as never;
  // KIDS-CREATE-01: a child's another-one is also a cartoon, Quick, within the daily limit, and never with a style.
  if (kid && picturesMadeToday(actor) + 1 > kidsDailyPictures()) return c.json({ error: CHILD_LIMIT_LINE, code: "daily_limit" }, 422) as never;
  if (!(await pictureEngineReady())) return c.json({ error: pictureNotReadyReason(await pictureEngineStatus()), code: "not_installed" }, 503) as never;
  // IMGGEN-QUALITY-01: Quick or Detailed again. Left out, the picture keeps its own kind; a style made for one maker decides.
  const choice = kid ? { quality: "quick" as const, model: "flux2-klein-4b", note: null, announce: false } : chooseQuality({ requested: allowedQuality(actor, "image", isPictureQuality(asked.quality) ? asked.quality : source.request.quality ?? "quick", routeAudience(actor).band), style: used[0] ?? null, engine: await pictureEngineStatus() });
  const loras = used.map((a) => ({ id: a.id, scale: a.strength_default }));
  const slot = kid ? reserveKid(actor, "picture", 1, words) : null;
  if (kid && !slot) return c.json({ error: CHILD_LIMIT_LINE, code: "daily_limit" }, 422) as never;
  try {
    const job = await startPictureJob({
      actor, conversationId: source.conversationId, turnId: source.turnId, temporary: source.temporary, kind: group.some((j) => j.state === "done") ? "variation" : "generate", prompt: words,
      body: { prompt: kid ? forceCartoon(prompt) : prompt, size: source.request.size, n: 1, ...(choice.model ? { model: choice.model } : {}), audience: lane === "adult" && adultAdaptersAllowed() ? "adult" : "all-ages", ...(kid ? { negative_prompt: CHILD_NEGATIVE_PROMPT } : {}), ...(loras.length ? { loras } : {}) }, sourceFileId: source.files[0]?.id ?? null,
    });
    void job;
    return c.json(cardView(actor, source, true, detailedReady(await pictureEngineStatus())), 200);
  } catch (error) {
    releaseKid(slot);
    const status = error instanceof StackPicturesError && (error.status === 422 || error.status === 409) ? error.status : 503;
    return c.json({ error: plainFailure(error), code: error instanceof StackPicturesError ? error.code : "failed" }, status) as never;
  }
});
