// VIDEO-GEN-04/06: the video card's routes and the Settings page's library routes. Signed-in, per person: a job is
// readable and stoppable by its owner only (nobody sees another person's videos, a parent included). Starting a
// clip from a route (Make another, Animate this picture) passes the same age and surface gate as the chat tool and
// the same prompt check, so a route is never a way around either. A child, a teen, a guest and a spoken or shared
// surface are refused here exactly as in the tool.
import { answerableFitAsk } from "@/lib/jobs/householdQueue";
import { phaseLabel } from "@/lib/videos/phaseLabel";
import { MIX_LEVEL_IDS } from "@/lib/videos/editPlan";
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, refuseWith } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { speakerAgeBand } from "@/lib/ageBand";
import { videoAdaptersFor, dropVideoAdapterCache, adapterOfLora } from "@/lib/videos/adapters";
import { cancelVideoJob, clipUrl, getVideoJobFor, getVideoJobByFileFor, plainVideoFailure, posterUrl, readVideoFile, startVideoJob, videoJobsForTurn, type VideoJob } from "@/lib/videos/jobs";
import { plainStageLabel } from "@/lib/jobQueueCopy";
import { promptRefusalLineFor } from "@/lib/pictures/ageCheck";
import { CHILD_NEGATIVE_PROMPT, CHILD_VIDEO_LIMIT_LINE, forceCartoon, kidsDailyVideos, laneOf, releaseKid, reserveKid, videoModelForLane, videosMadeToday } from "@/lib/pictures/lane";
import { checkClipFrames } from "@/lib/videos/frameCheck";
import { extractKeyframes } from "@/lib/pictures/keyframes";
import { cancelLongTake, resumeLongTake, startLongTake, takeProgress } from "@/lib/videos/longTake";
import { estimateVideoMinutes } from "@/lib/videos/estimate";
import { checkVideoPrompt } from "@/lib/videos/promptCheck";
import { householdAllowsVideo, refuseVideoPrompt, stackAudienceFor, videoDenial, VIDEO_DENIAL_LINE, VIDEO_REFUSAL_LINE, type VideoAudience } from "@/lib/videos/policy";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { getLive, liveCardFields } from "@/lib/genLive";
import { videoEngineStatus, videoStatusReady, videoNotReadyReason, videoMaxNotReadyReason } from "@/lib/videos/ready";
import { animatedCopyOf, animatedFileName, hasAudioTrack, messagesCopyOf, videoFileName, videoTitle } from "@/lib/videos/messagesCopy";
import { addVideoLora, StackVideoError } from "@/lib/videos/stack";
import { loraAccess, readLora, readLoras } from "@/lib/loras/access";
import { confirmLora, markAdultOnly, markAllAges, patchLora, removeLora } from "@/lib/loras/admin";
import { LoraWriteError, getLoraRecord, saveLora, type Lora } from "@/lib/loras/store";
import { recordFromStack, syncLoras } from "@/lib/loras/sync";
import { latestGeneratedPictureId } from "@/lib/videos/tool";
import { prepareVideoRerun } from "@/lib/videos/rerun";
import { anotherTakeFor, makeVideoFor } from "@/lib/videos/make";
import { anotherReferenceTake, FIRST_FRAME_STEP_NAMES, REFERENCE_STEP_NAMES } from "@/lib/videos/referenceVideo";
import type { ReferenceProgress } from "@/lib/videos/jobs";
import { getStudioVoice } from "@/lib/videos/studioVoices";
import { appRouteAllowed } from "@/lib/apps";
import { allowedQuality, jobTier, maxOffered, tierArgument } from "@/lib/tiers";
import { LTX25_MAX_MODEL, LTX25_MODEL, chooseVideoQuality, ltx25MaxReady, isVideoQuality, ltx25VideoReady, maxSecondsFor, quickVideoReady, videoSizeFor, VIDEO_SIZES_BY_QUALITY } from "@/lib/videos/quality";
import { videoJobLockItem, videoJobLockState, LOCKED_START_LINE } from "@/lib/videos/lock";
import { lockedView, sessionKeyOf } from "@/lib/adultLock";
import { adultStateOf } from "@/lib/adultMarks";
import { adultMarkJobBody } from "@/lib/adultMarkRoute";
import { getCookie } from "hono/cookie";
import { householdVideoQuality } from "@/lib/videos/policy";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, videoJobs } from "@/db/schema";
import { isOwnerOrAdmin } from "@/lib/access";
import type { PersonRow } from "@/types";
import { likenessRefusal } from "@/lib/likeness";
import { serveBytes } from "@/lib/media/serve";
import { adultStylesAllowed } from "@/lib/pictures/policy";
import { refusalLineOf, runEditVideo } from "@/lib/videos/editTool";
import { editRefusal } from "@/lib/videos/editGate";
import { startSpatialSound } from "@/lib/videos/spatialStart";
import { editVideoArgs, type RunEditVideoInput } from "@/lib/videos/editTool";

export const videosRoutes = apiRouter();
/** A locked item's media routes never let a cache keep a 404 or a body (ADULT-LOCK-02). */
const NO_STORE = { "cache-control": "private, no-store" } as const;

/** The audience of a route call: the signed-in person on the web chat screen. */
export function videoRouteAudience(actor: PersonRow): VideoAudience {
  return { actor, band: speakerAgeBand(actor, new Date()), surface: "chat", surfaceClass: "written", spoken: false };
}

/** The plain words for the video limits, shown on the card and on the settings page. */
/** The most clips one request's card holds (the first and each Make another). */
export const MAX_CLIPS_PER_CARD = 8;

export const VIDEO_LIMITS_LINE = "Quick videos are 5 seconds with no sound. Detailed videos have sound and speech for up to 5 seconds when the newer video model is ready.";

const ItemSchema = z.object({
  id: z.string(),
  state: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  percent: z.number(),
  label: z.string().describe("One plain line for the card: what is happening now."),
  position: z.number().nullable(),
  eta_seconds: z.number().nullable().describe("While running: seconds left, from earlier clips of this size and length."),
  step: z.number().nullable(), steps: z.number().nullable(),
  preview_url: z.string().nullable().describe("While running, once the motion is done: the clip's first frame (a JPEG); the `v` query changes with each new one."),
  started_at: z.number().describe("Epoch milliseconds the job started, for the card's elapsed clock."),
  prompt: z.string(),
  kind: z.enum(["generate", "animate", "edit"]),
  sheets: z.array(z.string()).optional().describe("REFVIDEO-01: the reference sheet pictures a video made from pictures was built from (file addresses), shown above the clip; absent for any other video."),
  phases: z.array(z.object({ id: z.enum(["sheet", "clip"]), name: z.string(), state: z.enum(["waiting", "running", "done"]), percent: z.number().describe("This step's own progress, 0 to 100."), line: z.string().nullable().describe("The plain sentence for what this step is doing now."), waiting: z.boolean().describe("The step is held (the computer is busy), not working yet.") })).optional().describe("REFVIDEO-STEPS-01: while a video made from pictures is made, its two steps with their own progress; absent for any other video and once it has finished."),
  note: z.string().nullable().describe("SPATIAL-04: one plain line kept with a spatial-sound clip (what the sound did, or why it is unchanged), shown as the card's muted notice; null for any other clip."),
  error: z.string().nullable(),
  quality: z.enum(["quick", "detailed"]).describe("Which kind made it: Quick (silent) or Detailed (with sound and speech)."),
  switch_to: z.enum(["quick", "detailed"]).nullable().describe("The other kind this video can be made again as, or null (it uses a style made for one kind, or the other kind is not on this computer)."),
  fit_ask: z.object({ job_id: z.string(), picked: z.string().nullable(), actual: z.string().nullable() }).nullable().describe("Set while this card is asking whether to make it now with the level it can run at (TIER-PRIO-07; `picked` and `actual` are the level names the buttons use) and this person may answer: POST /api/ai/jobs/{job_id}/fit-answer with allow or wait. Null otherwise."),
  max_offered: z.boolean().describe("Whether this person is shown Make it Max: they hold Max, the age band reaches it and a Max model is set for this kind."),
  clip: z.object({ url: z.string(), poster_url: z.string(), width: z.number(), height: z.number(), seconds: z.number().nullable(), seed: z.number().nullable(), file_id: z.string(), poster_file_id: z.string(), has_sound: z.boolean().describe("The clip has a sound track the model made (speech included).") }).nullable(),
  adult: z.object({
    made_audience: z.enum(["all-ages", "adult-only"]).describe("The machine fact and the minor ceiling; never lowered."),
    lock: z.enum(["on", "off"]).describe("Whether the Adult lock applies; the creator can clear it."),
    can_clear: z.boolean().describe("Show 'Remove lock': the creator, the item is adult-only and locked. Needs the confirm dialog and a fresh passcode (POST /api/adult-lock/confirm, then adult-mark)."),
    can_mark: z.boolean().describe("Show 'Lock': the creator, the item is not locked."),
    line: z.string().nullable().describe("The state in plain words, for an adult-only item."),
    history: z.array(z.object({ action: z.enum(["clear", "mark"]), via: z.enum(["creator_passcode", "creator", "admin", "auto"]), at: z.string() })).describe("The creator's own audit rows for this item (no content)."),
  }).nullable().describe("ADULT-LOCK-06: the item's Adult lock state for its creator, once it is shown (null for a clip still being made, a minor or a temporary chat)."),
});
const CardSchema = z.object({ id: z.string(), conversation_id: z.string().nullable(), items: z.array(ItemSchema), can_make_another: z.boolean(), can_edit: z.boolean().describe("SPATIAL-05: this person may edit a finished clip (adults on their own screen), so the clip's More menu offers Spatial sound."), limits: z.string() });
/** ADULT-LOCK-02: a card with an adult-only clip in it, while the person holds no unlock proof: the one tile and nothing else (no id, words, picture or count). */
const LockedCardSchema = z.object({ locked: z.literal(true), making: z.boolean() }).describe("An adult-only item that is locked: draw the lock tile; `making` adds its spinner.");
const CardOrLocked = z.union([CardSchema, LockedCardSchema]);

export { phaseLabel };

/** VIDEO-LTX-01: the card's kind and the other kind it can be made again as. A video made with a style is bound to the style's model, so it offers no switch. */
function qualityFields(job: VideoJob, ready: { quick: boolean; detailed: boolean; max?: boolean }): { quality: "quick" | "detailed"; switch_to: "quick" | "detailed" | null } {
  const quality = job.request.quality ?? "quick";
  // A video made with a style is bound to the style's model; one that started from a picture can only be Quick (Detailed starts from words).
  if (job.request.loras.length > 0 || job.request.source_file_id) return { quality, switch_to: null };
  if (quality === "detailed") return { quality, switch_to: ready.quick ? "quick" : null };
  return { quality, switch_to: ready.detailed ? "detailed" : null };
}

/** REFVIDEO-STEPS-01: the two steps of a video made from pictures, as the chat card draws them. */
export function referenceSteps(progress: ReferenceProgress) {
  const sheetPercent = progress.step === 2 ? 100 : Math.round(100 * Math.max(0, Math.min(1, progress.sheet.done / Math.max(1, progress.sheet.total))));
  const names = progress.route === "first_frame" ? FIRST_FRAME_STEP_NAMES : REFERENCE_STEP_NAMES;
  return [
    { id: "sheet" as const, name: names[0], state: progress.step === 2 ? "done" as const : "running" as const, percent: sheetPercent, line: progress.step === 2 ? null : `${progress.sheet.line}.`, waiting: false },
    { id: "clip" as const, name: names[1], state: progress.step === 1 ? "waiting" as const : "running" as const, percent: progress.step === 1 ? 0 : Math.round(progress.clip.percent), line: progress.step === 1 ? null : progress.clip.line.replace(/[.\s]*$/, "."), waiting: progress.step === 2 && progress.clip.waiting },
  ];
}

function itemView(job: VideoJob, actor: PersonRow, ready: { quick: boolean; detailed: boolean; max?: boolean }) {
  const file = job.state === "done" ? job.files[0] : undefined;
  return {
    id: job.id, state: job.state, percent: job.state === "done" ? 100 : job.percent,
    label: job.state === "queued" ? phaseLabel(job, laneOfPerson(actor) === "child" ? "child" : "adult") : job.state === "running" ? plainStageLabel(getLive(job.id)?.stageLabel, laneOfPerson(actor) === "child" ? "child" : "adult") ?? phaseLabel(job, laneOfPerson(actor) === "child" ? "child" : "adult") : "",
    position: job.position,
    ...(job.state === "running" ? (({ eta_seconds, step, steps, preview_url }) => ({ eta_seconds, step, steps, preview_url: laneOfPerson(actor) === "adult" ? preview_url : null }))(liveCardFields(job.id, (version) => `/api/videos/jobs/${encodeURIComponent(job.id)}/preview?v=${version}`)) : { eta_seconds: null, step: null, steps: null, preview_url: null }), started_at: new Date(job.createdAt).getTime(), prompt: job.request.reference?.request ?? job.prompt, kind: job.kind,
    error: job.state === "failed" ? job.error : null,
    note: job.state === "done" ? job.request.edit?.note ?? null : null,
    ...(job.request.refProgress && (job.state === "queued" || job.state === "running") ? { phases: referenceSteps(job.request.refProgress) } : {}),
    ...(job.request.reference?.sheetFileIds.length ? { sheets: job.request.reference.sheetFileIds.map((id) => `/api/files/${encodeURIComponent(id)}/content`) } : {}),
    ...qualityFields(job, ready),
    fit_ask: job.state === "queued" && laneOfPerson(actor) === "adult" ? answerableFitAsk(actor, job.id) : null,
    max_offered: job.state === "done" && laneOfPerson(actor) === "adult" && maxOffered(actor, "video", undefined, ready.max === true),
    adult: file && !job.temporary ? adultStateOf(actor, file.id) : null,
    clip: file ? { url: clipUrl(job, file), poster_url: posterUrl(job, file), width: file.width, height: file.height, seconds: file.seconds, seed: file.seed, file_id: file.id, poster_file_id: file.poster_id, has_sound: file.audio === true } : null,
  };
}

/** ADULT-LOCK-02: the card a route sends. Any adult-only clip in the card without an unlock proof turns the whole card into the one lock tile (no id, words, picture or count). */
export function videoCardOrLocked(actor: PersonRow, root: VideoJob, canMake: boolean, ready?: { quick: boolean; detailed: boolean; max?: boolean }) {
  const group = root.turnId ? videoJobsForTurn(actor, root.turnId) : [root];
  const jobs = group.length > 0 ? group : [root];
  if (jobs.some((j) => videoJobLockState(actor, j) !== "open")) return lockedView(jobs.some((j) => j.state === "queued" || j.state === "running"));
  return videoCardView(actor, root, canMake, ready);
}

/** The card for a job: every clip made in the same turn (the first and each Make another), oldest first. */
export function videoCardView(actor: PersonRow, root: VideoJob, canMake: boolean, ready: { quick: boolean; detailed: boolean; max?: boolean } = { quick: false, detailed: false }) {
  const group = root.turnId ? videoJobsForTurn(actor, root.turnId) : [root];
  const jobs = group.length > 0 ? group : [root];

  const active = jobs.some((j) => j.state === "queued" || j.state === "running");
  return {
    id: root.id, conversation_id: root.conversationId, items: jobs.map((j) => itemView(j, actor, ready)),
    can_make_another: canMake && !active && jobs.length < MAX_CLIPS_PER_CARD, can_edit: laneOfPerson(actor) === "adult", limits: VIDEO_LIMITS_LINE,
  };
}

/** Which kinds can run now (read from the Stack's status, cached for a few seconds). */
async function readyFlags(actor: PersonRow): Promise<{ quick: boolean; detailed: boolean; max: boolean }> {
  const engine = await videoEngineStatus();
  // A teen or a child is only ever on Quick (lane review): the card never offers them Detailed, and the job starter would override it anyway.
  // VIDEO-TIERS-01: an adult's LTX-2.5 serves both levels, so either switch is ready when the Stack says it is.
  const adult = laneOfPerson(actor) === "adult";
  return { quick: quickVideoReady(engine) || (adult && ltx25VideoReady(engine)), detailed: adult && ltx25VideoReady(engine), max: adult && ltx25MaxReady(engine) };
}

const idParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });
const refusals = errorResponses({ 401: "Not signed in", 403: "Videos are off for this profile", 404: "No such video job", 422: "That request is not allowed", 502: "Videos could not be made", 503: "Videos are not ready" });

const TierStatusSchema = z.object({ ready: z.boolean(), max_seconds: z.number(), sound: z.boolean(), model: z.enum(["wan", "ltx25", "ltx25max"]).nullable() });
/** VIDEO-TIERS-01: what each level makes on this computer now (the one answer the Create page, the tools and the settings read). A teen or a child: Standard on Wan, silent. Max is the LTX-2.5 Max model when the Stack reports it ready. */
export function videoTiersStatus(engine: Awaited<ReturnType<typeof videoEngineStatus>>, adult: boolean) {
  const ltx25 = adult && ltx25VideoReady(engine);
  return {
    standard: ltx25 ? { ready: true, max_seconds: maxSecondsFor("quick", "ltx25", engine), sound: true, model: "ltx25" as const } : { ready: quickVideoReady(engine), max_seconds: maxSecondsFor("quick", "wan"), sound: false, model: quickVideoReady(engine) ? "wan" as const : null },
    boost: ltx25 ? { ready: true, max_seconds: maxSecondsFor("detailed", "ltx25", engine), sound: true, model: "ltx25" as const } : { ready: false, max_seconds: 0, sound: false, model: null },
    max: adult && ltx25MaxReady(engine) ? { ready: true, max_seconds: maxSecondsFor("detailed", "ltx25max", engine), sound: true, model: "ltx25max" as const } : { ready: false, max_seconds: 0, sound: false, model: null },
  };
}

const statusRoute = createRoute({
  method: "get", path: "/status", tags: ["Videos"], summary: "Whether this person can make videos now, and why not", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ can_make: z.boolean(), reason: z.string().nullable(), engine_ready: z.boolean(), tiers: z.object({ standard: TierStatusSchema, boost: TierStatusSchema, max: TierStatusSchema }).describe("Which levels this person can use now and how long a clip each makes (Max is ready only when the Stack has its model installed; the person must also hold Max)."), adult_styles: z.boolean(), limits: z.string(), styles: z.array(z.object({ id: z.string(), name: z.string() })) }) } }, description: "Additive." }, ...errorResponses({ 401: "Not signed in" }) },
});
videosRoutes.openapi(statusRoute, async (c) => {
  const actor = c.get("person");
  const audience = videoRouteAudience(actor);
  const denial = videoDenial(audience);
  const engine = await videoEngineStatus();
  const ready = videoStatusReady(engine, laneOf(audience) === "adult");
  const styles = denial ? [] : (await videoAdaptersFor(audience)).map((a) => ({ id: a.id, name: a.name }));
  return c.json({
    can_make: denial === null && ready,
    reason: denial ? VIDEO_DENIAL_LINE[denial] : ready ? null : videoNotReadyReason(engine),
    engine_ready: ready,
    tiers: videoTiersStatus(engine, denial === null && laneOf(audience) === "adult"),
    adult_styles: denial === null && laneOf(audience) === "adult" && adultStylesAllowed(),
    limits: VIDEO_LIMITS_LINE,
    styles,
  }, 200);
});

const getRoute = createRoute({
  method: "get", path: "/jobs/{id}", tags: ["Videos"], summary: "Progress, then the finished clip, of one video job", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "application/json": { schema: CardOrLocked } }, description: "The card as its owner sees it, or the lock tile." }, ...refusals },
});
videosRoutes.openapi(getRoute, async (c) => {
  const actor = c.get("person");
  const job = getVideoJobFor(actor, c.req.valid("param").id);
  if (!job) return c.json({ error: "That video isn't available any more. Ask for it again." }, 404) as never;
  return c.json(videoCardOrLocked(actor, job, videoDenial(videoRouteAudience(actor)) === null, await readyFlags(actor)), 200);
});

const previewRoute = createRoute({
  method: "get", path: "/jobs/{id}/preview", tags: ["Videos"], summary: "The first frame of a clip being made (a JPEG), once the motion is done", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "image/jpeg": { schema: z.string() } }, description: "The preview, for the job's owner only." }, ...errorResponses({ 401: "Not signed in", 404: "No preview" }) },
});
videosRoutes.openapi(previewRoute, (c) => {
  const actor = c.get("person");
  const job = getVideoJobFor(actor, c.req.valid("param").id);
  // ADULT-LOCK-02: a locked job's first frame is a picture of the item: 404 like a missing one, never cached, until a proof is held.
  const preview = job && laneOfPerson(actor) === "adult" && videoJobLockState(actor, job) === "open" ? getLive(job.id)?.preview : null;
  if (!job || !preview) return c.json({ error: "There is no preview for that video." }, 404, NO_STORE) as never;
  return new Response(preview, { status: 200, headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } }) as never;
});

const fileParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }), fileId: z.string().min(1).max(80).openapi({ param: { name: "fileId", in: "path" } }) });
const fileRoute = createRoute({
  method: "get", path: "/jobs/{id}/files/{fileId}", tags: ["Videos"], summary: "A finished clip or its poster, with Range support for seeking", middleware: [requireAuth] as const,
  request: { params: fileParams },
  responses: { 200: { content: { "video/mp4": { schema: z.string() } }, description: "The file's bytes." }, 206: { content: { "video/mp4": { schema: z.string() } }, description: "A Range slice." }, ...errorResponses({ 401: "Not signed in", 404: "No such file" }) },
});
videosRoutes.openapi(fileRoute, (c) => {
  const actor = c.get("person");
  const { id, fileId } = c.req.valid("param");
  const job = getVideoJobFor(actor, id);
  // ADULT-LOCK-02: a locked clip or poster answers exactly like a missing one (404, same body, no-store) until a proof is held.
  const file = job && videoJobLockState(actor, job) === "open" ? readVideoFile(actor, job, fileId) : null;
  if (!job || !file) return c.json({ error: "That video isn't available any more." }, 404, NO_STORE) as never;
  return serveBytes(file.bytes, file.mediaType, c.req.header("Range")) as never;
});

const voiceParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });
const voiceRoute = createRoute({
  method: "get", path: "/studio/voices/{id}", tags: ["Videos"], summary: "A spoken line made in the Studio this session, with Range support", middleware: [requireAuth] as const,
  request: { params: voiceParams },
  responses: { 200: { content: { "audio/wav": { schema: z.string() } }, description: "The line's sound." }, 206: { content: { "audio/wav": { schema: z.string() } }, description: "A Range slice." }, ...errorResponses({ 401: "Not signed in", 404: "No such line" }) },
});
videosRoutes.openapi(voiceRoute, (c) => {
  const actor = c.get("person");
  // The Studio is adult-only; a line is kept in memory for two hours and only its maker reads it.
  const voice = laneOfPerson(actor) === "adult" && appRouteAllowed(actor, "video", "actions", "add") ? getStudioVoice(actor.id, c.req.valid("param").id) : null;
  if (!voice) return c.json({ error: "That voice line isn't available any more. Add it again." }, 404, NO_STORE) as never;
  const total = voice.bytes.byteLength;
  const headers: Record<string, string> = { "content-type": voice.mediaType, "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header("Range") ?? "");
  if (range) {
    const hasStart = range[1] !== "";
    const start = hasStart ? Number(range[1]) : Math.max(total - Number(range[2] || 0), 0);
    const end = hasStart && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end < total) {
      const slice = voice.bytes.subarray(start, end + 1);
      headers["content-range"] = `bytes ${start}-${end}/${total}`;
      headers["content-length"] = String(slice.byteLength);
      return new Response(slice, { status: 206, headers }) as never;
    }
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}`, "cache-control": "private, no-store" } }) as never;
  }
  headers["content-length"] = String(total);
  return new Response(voice.bytes, { status: 200, headers }) as never;
});

const messagesRoute = createRoute({
  method: "get", path: "/jobs/{id}/messages.mp4", tags: ["Videos"], summary: "The clip prepared for texting: a sound track so a phone treats it as a video, a name from the prompt", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "video/mp4": { schema: z.string() } }, description: "The mp4 as a download named after the prompt (paper-boat-in-the-rain.mp4). A clip made before the Stack added a silent AAC track is converted by the Stack on first request." }, ...errorResponses({ 401: "Not signed in", 404: "No such video" }) },
});
videosRoutes.openapi(messagesRoute, async (c) => {
  const actor = c.get("person");
  const job = getVideoJobFor(actor, c.req.valid("param").id);
  const first = job?.state === "done" ? job.files[0] : undefined;
  const file = job && first && videoJobLockState(actor, job) === "open" ? readVideoFile(actor, job, first.id) : null;
  if (!job || !first || !file) return c.json({ error: "That video isn't available any more. Ask for it again." }, 404, NO_STORE) as never;
  // ADULT-LOCK-02: an adult-only clip is texted and downloaded under a generic name, never one made from its words.
  const generic = videoJobLockItem(job)?.madeAudience === "adult-only";
  let bytes: Uint8Array;
  try { bytes = await messagesCopyOf(first.id, file.bytes, generic ? "Video" : videoTitle(job.prompt)); } catch (error) {
    if (error instanceof StackVideoError) return c.json({ error: `I couldn't prepare the video for texting. ${error.message}`, code: error.code }, error.status >= 500 ? 503 : 422) as never;
    throw error;
  }
  const name = generic ? "video.mp4" : videoFileName(job.prompt);
  return new Response(bytes, { status: 200, headers: { "content-type": "video/mp4", "content-length": String(bytes.byteLength), "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } }) as never;
});

const animatedRoute = createRoute({
  method: "get", path: "/jobs/{id}/animated", tags: ["Videos"], summary: "Save a finished clip as a GIF or animated WebP", middleware: [requireAuth] as const,
  request: { params: idParams, query: z.object({ format: z.enum(["gif", "webp"]).default("gif") }) },
  responses: { 200: { content: { "image/gif": { schema: z.string() }, "image/webp": { schema: z.string() } }, description: "The converted animation, downloaded with a prompt based filename." }, ...errorResponses({ 400: "Choose GIF or WebP", 401: "Not signed in", 404: "No such video", 422: "The animation could not be made", 503: "Video conversion is unavailable" }) },
});
videosRoutes.openapi(animatedRoute, async (c) => {
  const actor = c.get("person");
  const { format } = c.req.valid("query");
  const job = getVideoJobFor(actor, c.req.valid("param").id);
  const first = job?.state === "done" ? job.files[0] : undefined;
  const file = job && first && videoJobLockState(actor, job) === "open" ? readVideoFile(actor, job, first.id) : null;
  if (!job || !first || !file) return c.json({ error: "That video isn't available any more. Ask for it again." }, 404, NO_STORE) as never;
  let bytes: Uint8Array;
  try { bytes = await animatedCopyOf(first.id, format, file.bytes); } catch (error) {
    if (error instanceof StackVideoError) return c.json({ error: `I couldn't save this clip as ${format === "gif" ? "a GIF" : "an animated WebP"}. ${error.message}`, code: error.code }, error.status >= 500 ? 503 : 422) as never;
    throw error;
  }
  // ADULT-LOCK-02: never derive a download name from adult-only prompt words.
  const generic = videoJobLockItem(job)?.madeAudience === "adult-only";
  const name = generic ? `video.${format}` : animatedFileName(job.prompt, format);
  return new Response(bytes, { status: 200, headers: { "content-type": format === "gif" ? "image/gif" : "image/webp", "content-length": String(bytes.byteLength), "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } }) as never;
});

// IVY-QC-01: what a quick measured look at the finished clip's frames found (black, nothing moves, a much softer stretch). Local only; says nothing about the words.
const checkClipRoute = createRoute({
  method: "get", path: "/jobs/{id}/check", tags: ["Videos"], summary: "A quick measured check of a finished clip", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "application/json": { schema: z.object({ checked: z.boolean().describe("False when the frames could not be read on this computer; then there are no findings and nothing is claimed."), frames: z.number(), findings: z.array(z.object({ code: z.enum(["black", "frozen", "soft"]), level: z.enum(["serious", "warning"]), message: z.string() })) }) } }, description: "The check" }, ...errorResponses({ 401: "Not signed in", 404: "No such finished video" }) },
});
videosRoutes.openapi(checkClipRoute, async (c) => {
  const actor = c.get("person");
  const job = getVideoJobFor(actor, c.req.valid("param").id);
  const first = job?.state === "done" ? job.files[0] : undefined;
  const file = job && first && videoJobLockState(actor, job) === "open" ? readVideoFile(actor, job, first.id) : null;
  if (!job || !first || !file) return c.json({ error: "That video isn't available any more." }, 404, NO_STORE) as never;
  const seconds = job.request.seconds ?? null;
  return c.json(await checkClipFrames(await extractKeyframes(file.bytes, seconds), seconds), 200, NO_STORE);
});

const cancelRoute = createRoute({
  method: "post", path: "/jobs/{id}/cancel", tags: ["Videos"], summary: "Stop a video that is waiting or being made", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "application/json": { schema: CardOrLocked } }, description: "The card, with the clip stopped (a finished clip stays finished)." }, ...refusals },
});
videosRoutes.openapi(cancelRoute, async (c) => {
  const actor = c.get("person");
  const wanted = getVideoJobFor(actor, c.req.valid("param").id);
  if (!wanted) return c.json({ error: "That video isn't available any more." }, 404) as never;
  // ADULT-LOCK-02: a locked clip is not stopped, and its state not read, without an unlock (the media-app cancel answers the same 404).
  if (videoJobLockState(actor, wanted) !== "open") return c.json({ error: "That video isn't available any more." }, 404) as never;
  // The card's Stop is for the clip being made now, which may be a later one of the same turn.
  const live = (wanted.turnId ? videoJobsForTurn(actor, wanted.turnId) : [wanted]).filter((j) => j.state === "queued" || j.state === "running");
  for (const job of live) await cancelVideoJob(actor, job.id);
  const fresh = getVideoJobFor(actor, wanted.id) ?? wanted;
  return c.json(videoCardOrLocked(actor, fresh, videoDenial(videoRouteAudience(actor)) === null, await readyFlags(actor)), 200);
});

// ADULT-LOCK-06 (design 3.10): the creator clears the Adult lock after the confirm dialog and a FRESH passcode (the single-use ticket of
// POST /api/adult-lock/confirm, named for this job); the creator or an admin marks it again with no passcode. Nothing of the item is in an answer.
const adultMarkRoute = createRoute({
  method: "post", path: "/jobs/{id}/adult-mark", tags: ["Videos"], summary: "Lock a clip again, or (the creator only, with a fresh passcode ticket) remove its Adult lock", middleware: [requireAuth] as const,
  request: { params: idParams, body: { content: { "application/json": { schema: z.object({ action: z.enum(["clear", "mark"]), ticket: z.string().min(1).max(200).optional() }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ made_audience: z.enum(["all-ages", "adult-only"]), lock: z.enum(["on", "off"]) }) } }, description: "The state now." },
    ...errorResponses({ 403: "Not an adult's own screen, or the passcode ticket is missing, spent or for another item", 404: "No such clip", 409: "Not ready, or nothing to change" }),
  },
});
videosRoutes.openapi(adultMarkRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const { action, ticket } = c.req.valid("json");
  const done = adultMarkJobBody(c, actor, { id, action, ticket });
  if (!done.ok) return refuseWith(c, done) as never;
  return c.json({ made_audience: done.made_audience, lock: done.lock }, 200);
});

async function gateRoute(actor: PersonRow, prompt: string): Promise<{ status: 403 | 422 | 503; body: { error: string; code: string } } | null> {
  const audience = videoRouteAudience(actor);
  const denial = videoDenial(audience);
  if (denial) return { status: 403, body: { error: VIDEO_DENIAL_LINE[denial], code: denial } };
  const refused = refuseVideoPrompt(prompt, { lane: laneOf(audience) });
  if (refused) return { status: 422, body: { error: promptRefusalLineFor(refused, "video", actor, audience.band, prompt, VIDEO_REFUSAL_LINE[refused]), code: refused } };
  { const likeness = likenessRefusal(actor, prompt); if (likeness) return { status: 422, body: { error: likeness, code: "household_likeness_off" } }; }
  if (laneOf(audience) === "child" && videosMadeToday(actor) + 1 > kidsDailyVideos()) return { status: 422, body: { error: CHILD_VIDEO_LIMIT_LINE, code: "daily_limit" } };
  { const engine = await videoEngineStatus(); if (!videoStatusReady(engine, laneOf(audience) === "adult")) return { status: 503, body: { error: videoNotReadyReason(engine), code: "not_installed" } }; }
  return null;
}

const anotherRoute = createRoute({
  method: "post", path: "/jobs/{id}/another", tags: ["Videos"], summary: "Make another clip from the same words with a new seed (also Try again after a failed or stopped one, and Make it Detailed or Quick)", middleware: [requireAuth] as const,
  request: { params: idParams, body: { required: false, content: { "application/json": { schema: z.object({ quality: z.enum(["quick", "detailed"]).optional().describe("Make it again as this kind. Left out, the video keeps its own kind."), tier: z.enum(["standard", "boost", "max"]).optional().describe("Make it again at this level. Max needs an admin's OK and a Max model; a level the person may not use is lowered."), prompt: z.string().trim().min(1).max(2000).optional().describe("Remix: new words describing the changes. Left out, the clip is made again from its own words.") }) } } } },
  responses: { 200: { content: { "application/json": { schema: CardOrLocked } }, description: "The card, with a new clip queued (or the lock tile)." }, ...refusals },
});
videosRoutes.openapi(anotherRoute, async (c) => {
  const actor = c.get("person");
  const source = getVideoJobFor(actor, c.req.valid("param").id);
  if (!source || source.state === "queued" || source.state === "running") return c.json({ error: "That video isn't available any more. Ask for it again." }, 404) as never;
  // ADULT-LOCK-02: another take, remix and the like of a locked clip need an unlock first; nothing starts.
  if (videoJobLockState(actor, source) !== "open") return c.json({ error: LOCKED_START_LINE, code: "locked", locked: true }, 423) as never;
  // REFVIDEO-01: a video made from reference sheets makes another take from the SAME saved sheets and prompt with a new seed (no new cut-outs); it needs Max like the first.
  if (source.request.reference) {
    if (source.turnId && videoJobsForTurn(actor, source.turnId).length >= MAX_CLIPS_PER_CARD) return c.json({ error: "That chat already has eight videos from this request. Ask for a new one in a new message.", code: "too_many" }, 422) as never;
    const audience = videoRouteAudience(actor);
    if (laneOf(audience) !== "adult") return c.json({ error: "Videos from pictures are for adults on their own screen. Ask an adult in your home to help.", code: "minor" }, 403) as never;
    const engine = await videoEngineStatus();
    // The first-picture route (a real person's face) is an ordinary picture-to-video clip: any ready video level will do; the sheet route needs Max.
    if (source.request.reference.route === "first_frame") { if (!videoStatusReady(engine, true)) return c.json({ error: videoNotReadyReason(engine), code: "not_installed" }, 503) as never; }
    else if (!ltx25MaxReady(engine)) return c.json({ error: videoMaxNotReadyReason(engine), code: "max_not_ready" }, 503) as never;
    const again = anotherReferenceTake(actor, source);
    if (!again.ok) return c.json({ error: again.line, code: again.status === 409 ? "already_making" : "gone" }, again.status) as never;
    return c.json(videoCardOrLocked(actor, again.job, true, await readyFlags(actor)), 200);
  }
  // A clip made on the Create page has no chat behind it: Another take runs the same make again with a new seed.
  if (!source.conversationId) {
    const again = await anotherTakeFor(actor, source);
    if (!again.ok) return c.json({ error: again.error, code: again.code }, again.status) as never;
    return c.json(videoCardOrLocked(actor, again.job, true, await readyFlags(actor)), 200);
  }
  const asked = (await c.req.json().catch(() => ({}))) as { quality?: unknown; tier?: unknown; prompt?: unknown };
  const words = typeof asked.prompt === "string" && asked.prompt.trim() ? asked.prompt.trim().slice(0, 2000) : source.prompt;
  const blocked = await gateRoute(actor, words);
  if (blocked) return c.json(blocked.body, blocked.status) as never;
  if (!source.conversationId) return c.json({ error: "That video isn't available any more." }, 404) as never;
  if (source.turnId && videoJobsForTurn(actor, source.turnId).length >= MAX_CLIPS_PER_CARD) return c.json({ error: "That chat already has eight videos from this request. Ask for a new one in a new message.", code: "too_many" }, 422) as never;
  const audience = videoRouteAudience(actor);
  const adapters = await videoAdaptersFor(audience);
  // VIDEO-LTX-01: Quick or Detailed again. Left out, the video keeps its own kind; a style made for one model decides.
  const engine = await videoEngineStatus();
  const used = source.request.loras.flatMap((id) => { const found = adapters.find((a) => a.id === id); return found ? [found] : []; });
  const tierAsked = tierArgument({ person: actor, category: "video", arg: asked.tier, band: audience.band, maxAvailable: laneOf(audience) === "adult" && ltx25MaxReady(engine) });
  const choice = chooseVideoQuality({ requested: allowedQuality(actor, "video", isVideoQuality(asked.quality) ? asked.quality : tierAsked.quality ?? source.request.quality ?? "quick", audience.band), style: used[0] ?? null, seconds: source.request.seconds, engine, hasPicture: source.request.source_file_id !== null, quickOnly: laneOf(audience) !== "adult" || allowedQuality(actor, "video", "detailed", audience.band) === "quick", adultLane: laneOf(audience) === "adult", max: tierAsked.tier === "max" && laneOf(audience) === "adult" && ltx25MaxReady(engine) });
  const portrait = (() => { const [w, h] = source.request.size.split("x").map(Number); return Boolean(w && h && h > w); })();
  const size = videoSizeFor(choice.maker, choice.quality, portrait, engine);
  // Only LoRAs this person may still use ride along; one turned off since is dropped.
  const prep = await prepareVideoRerun({
    actor, audience, conversationId: source.conversationId, temporary: source.temporary, prompt: words, sourceFileId: source.request.source_file_id,
    adapters, styleIds: source.request.loras,
  });
  if (!prep.ok) return c.json({ error: prep.line, code: prep.code }, 422) as never;
  const slot = laneOf(audience) === "child" ? reserveKid(actor, "video", 1, words) : null;
  if (laneOf(audience) === "child" && !slot) return c.json({ error: CHILD_VIDEO_LIMIT_LINE, code: "daily_limit" }, 422) as never;
  try {
    const started = await startVideoJob({
      actor, conversationId: source.conversationId, turnId: source.turnId, temporary: source.temporary, kind: source.kind, prompt: words, sourceFileId: source.request.source_file_id,
      tier: choice.maker === "ltx25max" ? "max" : jobTier("video", tierAsked.tier, choice.quality),
      body: {
        prompt: laneOf(audience) === "child" ? forceCartoon(words) : words, size, seconds: laneOf(audience) === "child" ? Math.min(choice.seconds, 3) : choice.seconds, ...(choice.maker === "ltx25max" ? { model: LTX25_MAX_MODEL } : choice.maker === "ltx25" ? { model: LTX25_MODEL } : {}), audience: stackAudienceFor(audience),
        ...(laneOf(audience) === "adult" ? {} : { model: videoModelForLane(laneOf(audience)) }),
        ...(laneOf(audience) === "child" ? { negative_prompt: CHILD_NEGATIVE_PROMPT } : {}),
        ...(prep.image ? { image: prep.image, image_source: prep.imageSource ?? "generated" } : {}),
        ...(prep.loras.length && laneOf(audience) !== "child" ? { loras: prep.loras } : {}),
      },
    });
    return c.json(videoCardOrLocked(actor, started, true, await readyFlags(actor)), 200);
  } catch (error) {
    releaseKid(slot);
    const status = error instanceof StackVideoError && error.status === 422 ? 422 : 503;
    return c.json({ error: plainVideoFailure(error), code: error instanceof StackVideoError ? error.code : "failed" }, status) as never;
  }
});

// VIDEO-CREATE-01: Make a video, from words alone, on the Create page. The same definition the chat tool runs (lib/videos/make.ts).
const makeRoute = createRoute({
  method: "post", path: "/make", tags: ["Videos"], summary: "Make a video from words (the Create page); adults on their own screen only", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({
    prompt: z.string().trim().min(3).max(1200).describe("What the video shows."),
    orientation: z.enum(["landscape", "portrait"]).optional(),
    seconds: z.number().int().min(1).max(30).optional().describe("Length in seconds; the most this level makes is used when it is longer."),
    tier: z.enum(["standard", "boost", "max"]).optional().describe("The level to make it at. Max needs an admin's OK; without it the request is refused."),
    recipe: z.string().trim().min(1).max(40).optional().describe("A recipe id from the package's `recipes` data (a camera move or style); its wording goes to the model after the prompt."),
    look: z.string().trim().min(1).max(40).optional().describe("A look id (natural, classic-cartoon, anime, 3d-animated, film); its wording goes to the model before the prompt."),
    voices: z.string().trim().min(1).max(40).optional().describe("clean (the default: no laugh track, no music, one speaker at a time) or full (music and effects)."),
    start_frame: z.string().trim().min(1).max(200).optional().describe("The id of a picture in your own Library; the video starts from it (404 when it is not yours)."),
    styles: z.array(z.string().trim().min(1).max(80)).max(2).optional().describe("The ids of up to two styles from `/api/loras/available`, at most one character. Each is checked against what you may use; a style that is locked, gone or not yours stops the clip with one plain line."),
    strength: z.enum(["less", "normal", "more"]).optional().describe("How strongly the styles apply (0.75, 1 or 1.25 of each style's own default, held to its range)."),
  }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.union([CardSchema, LockedCardSchema]).and(z.object({ prompt_notes: z.array(z.string()).describe("IVY-CHECK-01: what the prompt check found in the words (errors and warnings only), one plain line each; the clip was still made. Empty when nothing is wrong."), notice: z.string().nullable().describe("One plain line when the length was cut to fit the level, else null.") })) } }, description: "The card for the new clip." }, ...refusals },
});
videosRoutes.openapi(makeRoute, async (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  const result = await makeVideoFor(actor, body);
  if (!result.ok) return c.json({ error: result.error, code: result.code }, result.status) as never;
  return c.json({ ...videoCardOrLocked(actor, result.job, true, await readyFlags(actor)), notice: result.notice, prompt_notes: checkVideoPrompt(body.prompt, { seconds: body.seconds }).filter((f) => f.level !== "info").map((f) => f.message) } as never, 200);
});

// IVY-CHECK-01: the prompt check the Create page shows under the words, before any render. Pure code; it reads and gates nothing.
const checkPromptRoute = createRoute({
  method: "post", path: "/check-prompt", tags: ["Videos"], summary: "Check a video prompt for mistakes before making it", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({
    prompt: z.string().max(4000).describe("The words as typed."),
    seconds: z.number().int().min(1).max(30).optional().describe("The length asked for, so spoken lines can be measured against it."),
  }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ findings: z.array(z.object({
    code: z.string(), level: z.enum(["error", "warn", "info"]), message: z.string().describe("What is wrong, in plain words."),
    fix: z.string().nullable().describe("The whole prompt with the one safe edit applied, or null when it needs a person's choice."),
  })) }) } }, description: "Findings, errors first; an empty list means nothing to fix" }, ...errorResponses({ 401: "Not signed in" }) },
});
videosRoutes.openapi(checkPromptRoute, (c) => {
  const body = c.req.valid("json");
  return c.json({ findings: checkVideoPrompt(body.prompt, { seconds: body.seconds }) }, 200);
});

// VIDEO-ESTIMATE-01: the "about N min" under the Length and Level choices; this home's own finished clips only.
const estimateRoute = createRoute({
  method: "get", path: "/estimate", tags: ["Videos"], summary: "About how long a clip like this takes in this home", middleware: [requireAuth] as const,
  request: { query: z.object({ seconds: z.coerce.number().int().min(1).max(30), tier: z.enum(["standard", "boost", "max"]).default("standard") }) },
  responses: { 200: { content: { "application/json": { schema: z.object({ minutes: z.number().nullable().describe("Rounded minutes, or null when too few clips like this have been made here."), samples: z.number(), note: z.string() }) } }, description: "The estimate" }, ...errorResponses({ 401: "Not signed in" }) },
});
videosRoutes.openapi(estimateRoute, (c) => c.json(estimateVideoMinutes(c.req.valid("query")), 200));

// LONGTAKE-01: a clip longer than one part's ceiling, made as a chain of parts (design: docs/design/long-clips-2026-11-09.md).
const takeProgressSchema = z.object({ id: z.string(), state: z.enum(["running", "done", "stopped", "failed"]), parts_done: z.number(), parts_total: z.number(), file_id: z.string().nullable().describe("The finished take's file once it is done."), error_line: z.string().nullable() });
const takeIdParams = z.object({ id: z.string().min(1).max(80) });
const longRoute = createRoute({
  method: "post", path: "/long", tags: ["Videos"], summary: "Start a long take: a clip longer than one part's ceiling, made as parts that continue from each other (adults on their own screen)", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({
    prompt: z.string().trim().min(3).max(1200).describe("What the video shows."),
    seconds: z.number().int().min(2).max(240).describe("The whole length, longer than one part's ceiling and at most 40 seconds; longer than that is a film or a scene with cuts."),
    beats: z.array(z.string().trim().min(1).max(400)).max(12).optional().describe("Optional: what happens in each part, in order."),
    tier: z.enum(["standard", "boost", "max"]).optional(),
    orientation: z.enum(["landscape", "portrait"]).optional(),
    styles: z.array(z.string().trim().min(1).max(80)).max(2).optional().describe("Up to two style ids (a character style holds a face across parts); each is read again through your own access."),
  }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ id: z.string(), parts: z.number(), per_part: z.number().describe("Seconds asked for each part.") }) } }, description: "The take has started; poll GET /long/{id}" }, ...errorResponses({ 401: "Not signed in", 403: "Not for this person", 409: "A long take is already being made", 422: "The words or the length cannot be used" }) },
});
videosRoutes.openapi(longRoute, (c) => {
  const started = startLongTake(c.get("person"), c.req.valid("json"));
  if (!started.ok) return c.json({ error: started.line }, started.status) as never;
  return c.json({ id: started.id, parts: started.parts, per_part: started.per_part }, 200);
});
const longGetRoute = createRoute({ method: "get", path: "/long/{id}", tags: ["Videos"], summary: "Progress of a long take", middleware: [requireAuth] as const, request: { params: takeIdParams }, responses: { 200: { content: { "application/json": { schema: takeProgressSchema } }, description: "Progress" }, ...errorResponses({ 401: "Not signed in", 404: "No such long take" }) } });
videosRoutes.openapi(longGetRoute, (c) => { const p = takeProgress(c.get("person"), c.req.valid("param").id); return p ? c.json(p, 200) : c.json({ error: "That long take isn't available." }, 404) as never; });
const longResumeRoute = createRoute({ method: "post", path: "/long/{id}/resume", tags: ["Videos"], summary: "Carry on a stopped or failed long take from its first missing part", middleware: [requireAuth] as const, request: { params: takeIdParams }, responses: { 200: { content: { "application/json": { schema: takeProgressSchema } }, description: "Progress" }, ...errorResponses({ 401: "Not signed in", 404: "No such long take" }) } });
videosRoutes.openapi(longResumeRoute, (c) => { const p = resumeLongTake(c.get("person"), c.req.valid("param").id); return p && !("line" in p) ? c.json(p, 200) : c.json({ error: "That long take isn't available." }, 404) as never; });
const longCancelRoute = createRoute({ method: "post", path: "/long/{id}/cancel", tags: ["Videos"], summary: "Stop a long take after the part being made; the parts already made are kept", middleware: [requireAuth] as const, request: { params: takeIdParams }, responses: { 200: { content: { "application/json": { schema: takeProgressSchema } }, description: "Progress" }, ...errorResponses({ 401: "Not signed in", 404: "No such long take" }) } });
videosRoutes.openapi(longCancelRoute, (c) => { const p = cancelLongTake(c.get("person"), c.req.valid("param").id); return p ? c.json(p, 200) : c.json({ error: "That long take isn't available." }, 404) as never; });

const animateRoute = createRoute({
  method: "post", path: "/animate", tags: ["Videos"], summary: "Animate a picture", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({
    conversation_id: z.string().min(1).max(80), file_id: z.string().min(1).max(80).optional(), turn_id: z.string().min(1).max(80), prompt: z.string().trim().min(3).max(1200).optional(),
  }) } } } },
  responses: { 200: { content: { "application/json": { schema: CardOrLocked } }, description: "The card for the new clip (or the lock tile)." }, ...refusals },
});
videosRoutes.openapi(animateRoute, async (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  const prompt = body.prompt ?? "Bring this picture to life with gentle, natural motion.";
  const blocked = await gateRoute(actor, prompt);
  if (blocked) return c.json(blocked.body, blocked.status) as never;
  // A child animates only a cartoon made for them: never a photo or a named person.
  const ownTurn = db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, body.turn_id), eq(conversationTurns.conversationId, body.conversation_id), eq(conversationTurns.personId, actor.id))).get();
  if (!ownTurn) return c.json({ error: "That chat isn't available any more. Open it again and try once more.", code: "not_found" }, 404) as never;
  const fileId = body.file_id ?? latestGeneratedPictureId(actor, body.conversation_id);
  if (!fileId) return c.json({ error: "I can animate a picture made here or a photo you attach. Attach the photo, then try again.", code: "reference" }, 422) as never;
  const audience = videoRouteAudience(actor);
  const adapters = await videoAdaptersFor(audience);
  const prep = await prepareVideoRerun({ actor, audience, conversationId: body.conversation_id, temporary: false, prompt, sourceFileId: fileId, adapters, styleIds: [] });
  if (!prep.ok) return c.json({ error: prep.line, code: prep.code }, 422) as never;
  const size = prep.width && prep.height && prep.height > prep.width ? VIDEO_SIZES_BY_QUALITY.quick.portrait : VIDEO_SIZES_BY_QUALITY.quick.landscape;
  const slot = laneOf(audience) === "child" ? reserveKid(actor, "video", 1, prompt) : null;
  if (laneOf(audience) === "child" && !slot) return c.json({ error: CHILD_VIDEO_LIMIT_LINE, code: "daily_limit" }, 422) as never;
  try {
    const job = await startVideoJob({
      actor, conversationId: body.conversation_id, turnId: body.turn_id, temporary: false, kind: "animate", prompt, sourceFileId: fileId,
      body: {
        prompt: laneOf(audience) === "child" ? forceCartoon(prompt) : prompt, size, seconds: laneOf(audience) === "child" ? 3 : 5, audience: stackAudienceFor(audience), image: prep.image!, image_source: prep.imageSource ?? "generated",
        ...(laneOf(audience) === "adult" ? {} : { model: videoModelForLane(laneOf(audience)) }),
        ...(laneOf(audience) === "child" ? { negative_prompt: CHILD_NEGATIVE_PROMPT } : {}),
      },
    });
    return c.json(videoCardOrLocked(actor, job, true, await readyFlags(actor)), 200);
  } catch (error) {
    releaseKid(slot);
    const status = error instanceof StackVideoError && error.status === 422 ? 422 : 503;
    return c.json({ error: plainVideoFailure(error), code: error instanceof StackVideoError ? error.code : "failed" }, status) as never;
  }
});

const cutToBeatRoute = createRoute({
  method: "post", path: "/cut-to-beat", tags: ["Videos"], summary: "Cut videos to a song's beat", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ conversation_id: z.string().min(1).max(80).optional(), clips: z.array(z.string().trim().min(1).max(80)).min(1).max(6), track: z.string().trim().min(1).max(80), beats_per_cut: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]).optional(), length_s: z.number().int().min(5).max(60).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: CardOrLocked } }, description: "The cut video card." }, ...refusals },
});
videosRoutes.openapi(cutToBeatRoute, async (c) => {
  const actor = c.get("person"); const body = c.req.valid("json"); const audience = videoRouteAudience(actor);
  if (videoDenial(audience)) return c.json({ error: videoDenial(audience), code: "not_allowed" }, 403) as never;
  if (laneOf(audience) !== "adult") return c.json({ error: "This edit is for adults on their own screen." , code: "minor" }, 422) as never;
  const jobs = body.clips.map((id) => getVideoJobFor(actor, id) ?? getVideoJobByFileFor(actor, id));
  if (jobs.some((job) => !job)) return c.json({ error: "That video isn't available any more. Ask for it again.", code: "not_found" }, 404) as never;
  const conversationId = body.conversation_id ?? jobs[0]!.conversationId;
  const turnId = conversationId ? db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.personId, actor.id), eq(conversationTurns.conversationId, conversationId))).orderBy(conversationTurns.createdAt).get()?.id ?? null : null;
  if (!conversationId || !turnId) return c.json({ error: "Open the chat with your videos and try again.", code: "no_chat" }, 422) as never;
  const clip = jobs[0]!.id;
  const state = { actor, surface: "chat", conversationId, turnId, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "", persona: null, crisis: false } as unknown as RunEditVideoInput["state"];
  const outcome = await runEditVideo({ state, args: { clip, clips: jobs.map((job) => job!.id), change: "cut_to_beat", track: body.track, beats_per_cut: body.beats_per_cut, length_s: body.length_s }, callId: "route-cut-to-beat", spoken: false });
  const id = (outcome.result?.data as { videoJobId?: string; refused?: string } | undefined)?.videoJobId;
  if (!id) return c.json({ error: outcome.result?.reply?.text ?? "I couldn't cut that video to the beat.", code: String((outcome.result?.data as { refused?: string } | undefined)?.refused ?? "cut_failed") }, 422) as never;
  const job = getVideoJobFor(actor, id);
  if (!job) return c.json({ error: "That video is not available any more.", code: "not_found" }, 404) as never;
  return c.json(videoCardOrLocked(actor, job, true, await readyFlags(actor)) as never, 200);
});

const addMusicRoute = createRoute({
  method: "post", path: "/add-music", tags: ["Videos"], summary: "Lay a song, or new music made for it, under a video", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ conversation_id: z.string().min(1).max(80).optional(), clip: z.string().trim().min(1).max(80),
    track: z.string().trim().min(1).max(80).optional(), make_music: z.string().trim().min(3).max(600).optional(), level: z.enum(MIX_LEVEL_IDS).optional() })
    .refine((body) => Boolean(body.track) !== Boolean(body.make_music), { message: "Pick a song or describe new music, not both." }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ conversation_id: z.string(), video_job_id: z.string().nullable(), music_job_id: z.string().nullable() }) } }, description: "The edit, or the music that is made first." }, ...refusals },
});
videosRoutes.openapi(addMusicRoute, async (c) => {
  const actor = c.get("person"); const body = c.req.valid("json"); const audience = videoRouteAudience(actor);
  if (videoDenial(audience)) return c.json({ error: videoDenial(audience), code: "not_allowed" }, 403) as never;
  if (laneOf(audience) !== "adult") return c.json({ error: "This edit is for adults on their own screen.", code: "minor" }, 422) as never;
  const job = getVideoJobFor(actor, body.clip) ?? getVideoJobByFileFor(actor, body.clip);
  if (!job) return c.json({ error: "That video isn't available any more. Ask for it again.", code: "not_found" }, 404) as never;
  const conversationId = body.conversation_id ?? job.conversationId;
  const turnId = conversationId ? db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.personId, actor.id), eq(conversationTurns.conversationId, conversationId))).orderBy(conversationTurns.createdAt).get()?.id ?? null : null;
  if (!conversationId || !turnId) return c.json({ error: "Open the chat with your video and try again.", code: "no_chat" }, 422) as never;
  const state = { actor, surface: "chat", conversationId, turnId, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "", persona: null, crisis: false } as unknown as RunEditVideoInput["state"];
  const outcome = await runEditVideo({ state, args: { clip: job.id, change: "mix", sound: "music", track: body.track, make_music: body.make_music, level: body.level }, callId: "route-add-music", spoken: false });
  const data = outcome.result?.data as { videoJobId?: string; musicJobId?: string; refused?: string } | undefined;
  if (!data?.videoJobId && !data?.musicJobId) return c.json({ error: outcome.result?.reply?.text ?? "I couldn't add music to that video.", code: String(data?.refused ?? "add_music_failed") }, 422) as never;
  return c.json({ conversation_id: conversationId, video_job_id: data.videoJobId ?? null, music_job_id: data.musicJobId ?? null }, 200);
});

// SPATIAL-05: "Spatial sound" in a clip's More menu. The same edit the chat tool runs (`edit_video`, change `spatial_sound`), so the age gate, the screening,
// the ownership and lock checks and the finished-clip check are the ones the tool has. The new clip joins the source's card (the same turn) or, for a clip made
// on the Create page, is a new Library clip. An adult-only source gives an adult-only result.
const spatialRoute = createRoute({
  method: "post", path: "/jobs/{id}/spatial-sound", tags: ["Videos"], summary: "Make the sound of a clip follow who is talking on screen (and, if asked, a 5.1 file); adults on their own screen only", middleware: [requireAuth] as const,
  request: { params: idParams, body: { required: false, content: { "application/json": { schema: z.object({ surround: z.boolean().optional().describe("Also make a 5.1 file, a second file of the new clip."), side: z.enum(["left", "right"]).optional().describe("Force the sound to one side of the picture; left out, the Stack decides.") }) } } } },
  responses: { 200: { content: { "application/json": { schema: CardOrLocked } }, description: "The card with the new clip being made (or the lock tile)." }, ...refusals },
});
videosRoutes.openapi(spatialRoute, async (c) => {
  const actor = c.get("person");
  const asked = (await c.req.json().catch(() => ({}))) as { surround?: unknown; side?: unknown };
  const started = await startSpatialSound(actor, c.req.valid("param").id, asked);
  if (!started.ok) return c.json({ error: started.error, code: started.code, ...(started.locked ? { locked: true } : {}) }, started.status) as never;
  return c.json(videoCardOrLocked(actor, started.job, true, await readyFlags(actor)), 200);
});

// ---------------------------------------------------------------- settings page: the household's video LoRA library

const AdapterSchema = z.object({
  id: z.string(), name: z.string(), classification: z.enum(["all-ages", "adult-only"]), enabled: z.boolean(), needs_confirmation: z.boolean(), sha256: z.string(), base_model: z.string(), trigger_words: z.array(z.string()),
  licence: z.string(), strength_default: z.number(), bytes: z.number(), source_url: z.string().nullable(), added_at: z.string(),
});
const settingsRoute = createRoute({
  method: "get", path: "/settings", tags: ["Videos"], summary: "The video role's state, the household switches and the LoRA library", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({
    state: z.string(), available: z.boolean(), reason: z.string().nullable(), tier: z.string().nullable(), model_installed: z.boolean(), limits: z.string(),
    quality: z.enum(["quick", "detailed"]).describe("The household's Video quality setting."),
    detailed: z.object({
      installed: z.boolean(), available: z.boolean(), reason: z.string().nullable(),
      download_bytes: z.number().describe("What getting the newer sound video model would still download (0 when installed)."),
      component: z.string().describe("The Models and storage id for the newer sound video model."),
      licence: z.object({ id: z.string(), name: z.string(), url: z.string() }).nullable(),
      lora_base_model: z.string(),
    }).describe("Detailed videos use the newer model for sound and speech, up to 5 seconds."),
    enabled: z.boolean(), adult_adapters: z.boolean(), minors: z.string(), adapters: z.array(AdapterSchema),
    locked_styles: z.boolean().describe("Some adult-only styles are locked: one tile, never a count. They open with the person's own passcode (the Adult lock)."),
  }) } }, description: "Additive." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only" }) },
});
videosRoutes.openapi(settingsRoute, async (c) => {
  const engine = await videoEngineStatus();
  // VIDEO-LORA-03: the library as this admin may read it now (lib/loras/access.ts): adult-only styles are one locked tile until their own unlock proof is valid.
  let list: ReturnType<typeof readLoras> = { items: [], locked: false };
  try { await syncLoras(); list = readLoras(c.get("person"), "own_written"); } catch { list = { items: [], locked: false }; }
  const adapters = list.items.map(adapterOfLora);
  return c.json({
    state: engine?.state ?? "unavailable", available: engine?.available === true, reason: engine?.reason ?? (engine ? null : "Videos are not ready yet. Try again in a few minutes."), tier: engine?.tier ?? null,
    model_installed: engine?.qualities ? engine.qualities.quick.installed : engine?.model?.installed === true, limits: VIDEO_LIMITS_LINE,
    quality: householdVideoQuality(),
    detailed: { installed: ltx25VideoReady(engine), available: ltx25VideoReady(engine), reason: null, download_bytes: ltx25VideoReady(engine) ? 0 : engine?.qualities?.ltx25?.install?.remaining_bytes ?? 0, component: "ltx25-q8", licence: engine?.qualities?.ltx25?.licence ?? null, lora_base_model: "ltx-2.5" },
    enabled: householdAllowsVideo(), adult_adapters: adultStylesAllowed(),
    minors: "Videos are off for children and teens. No setting turns them on.",
    adapters: adapters.map(adapterWire),
    locked_styles: list.locked,
  }, 200);
});

const adapterIdParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });
const LOCKED_STYLE_NAME = "Locked style";
const adultOnlyHidden = (person: PersonRow, record: Lora): boolean => record.audience === "adult-only" && loraAccess(person, record, "own_written") !== "open";
const NOT_IN_LIBRARY_LINE = "That style isn't in the library.";
const adapterWire = (a: ReturnType<typeof adapterOfLora>) => ({ id: a.id, name: a.name, classification: a.classification, enabled: a.enabled, needs_confirmation: a.needs_confirmation, sha256: a.sha256, base_model: a.base_model, trigger_words: a.trigger_words, licence: a.licence, strength_default: a.strength_default, bytes: a.bytes, source_url: a.source_url, added_at: a.added_at });
const patchAdapterRoute = createRoute({
  method: "patch", path: "/adapters/{id}", tags: ["Videos"], summary: "Mark a video LoRA usable by adults (or admins only), change its class or name (kept for the Settings page; see /api/loras)", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { params: adapterIdParams, body: { content: { "application/json": { schema: z.object({ enabled: z.boolean().optional(), classification: z.enum(["all-ages", "adult-only"]).optional(), name: z.string().trim().min(1).max(80).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: AdapterSchema } }, description: "Updated." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only", 404: "No such LoRA", 422: "A value is out of range" }) },
});
videosRoutes.openapi(patchAdapterRoute, async (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  await syncLoras();
  // A style the admin cannot read (missing, or locked behind the Adult lock) answers like a missing one.
  const found = readLora(actor, id, "own_written");
  if (!found || found.state !== "open") return c.json({ error: NOT_IN_LIBRARY_LINE }, 404) as never;
  try {
    if (body.name) patchLora(actor, id, { name: body.name });
    if (body.classification === "adult-only") await markAdultOnly(actor, id);
    if (body.classification === "all-ages") await markAllAges(actor, id);
    if (typeof body.enabled === "boolean") {
      if (body.enabled) confirmLora(actor, id);
      patchLora(actor, id, { availability: { who: body.enabled ? "adults" : "admins" } });
    }
  } catch (error) {
    if (error instanceof LoraWriteError) return c.json({ error: error.message }, 422) as never;
    throw error;
  }
  const after = getLoraRecord(id);
  return after ? c.json(adapterWire(adapterOfLora(after)), 200) : c.json({ error: NOT_IN_LIBRARY_LINE }, 404) as never;
});

const deleteAdapterRoute = createRoute({
  method: "delete", path: "/adapters/{id}", tags: ["Videos"], summary: "Remove a video LoRA to the 30-day trash (kept for the Settings page; see /api/loras)", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { params: adapterIdParams },
  responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } }, description: "Removed." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only", 404: "No such LoRA" }) },
});
videosRoutes.openapi(deleteAdapterRoute, async (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  await syncLoras();
  const found = readLora(actor, id, "own_written");
  if (!found || found.state !== "open") return c.json({ error: NOT_IN_LIBRARY_LINE }, 404) as never;
  removeLora(actor, id);
  return c.json({ ok: true as const }, 200);
});

const addAdapterRoute = createRoute({
  method: "post", path: "/adapters", tags: ["Videos"], summary: "Add a video LoRA file to the household library", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { body: { content: { "multipart/form-data": { schema: z.object({
    file: z.custom<File>((value) => value instanceof File, "The .safetensors file.").openapi({ type: "string", format: "binary" }),
    name: z.string().trim().min(1).max(80), licence: z.string().trim().min(1).max(120), licence_acknowledged: z.enum(["true", "false"]).optional(),
    source_url: z.string().max(500).optional(), classification: z.enum(["all-ages", "adult-only"]).optional(), trigger_words: z.string().max(400).optional(),
  }) } } } },
  responses: { 200: { content: { "application/json": { schema: AdapterSchema } }, description: "Added." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only", 409: "Already in the library", 413: "Too large", 422: "The file cannot be used", 503: "Videos are not ready" }) },
});
videosRoutes.openapi(addAdapterRoute, async (c) => {
  const form = c.req.valid("form");
  const adder = c.get("person");
  const out = new FormData();
  out.set("file", form.file);
  out.set("name", form.name);
  out.set("licence", form.licence);
  if (form.licence_acknowledged) out.set("licence_acknowledged", form.licence_acknowledged);
  if (form.source_url) out.set("source_url", form.source_url);
  // Uncertain means adult-only: an adder who does not say gets the stricter class.
  out.set("classification", form.classification ?? "adult-only");
  if (form.trigger_words) out.set("trigger_words", form.trigger_words);
  out.set("added_by", "household");
  try {
    const lora = await addVideoLora(out);
    // A new style is usable by admins only (the default of every record) and waits, unconfirmed, until an admin has read its fingerprint and licence.
    const made = recordFromStack(lora, { enabled: false, updatedBy: "pending" }, adder.id);
    if (made) {
      try { saveLora({ ...made, added_by: adder.id, provenance: { origin: "file", job_id: null } }, adder.id); } catch { /* a record that cannot be saved stays unlisted and unusable: fail closed */ }
    }
    dropVideoAdapterCache();
    const record = getLoraRecord(lora.id);
    // An adult-only style is not described to an admin whose unlock proof is not valid (the id stays, so the page can refresh its list): no name, words, hash or link.
    const shown = record && adultOnlyHidden(adder, record) ? { ...adapterWire(adapterOfLora(record)), name: LOCKED_STYLE_NAME, trigger_words: [], sha256: "", source_url: null } : null;
    if (shown) return c.json(shown, 200);
    return c.json(record ? adapterWire(adapterOfLora(record)) : { id: lora.id, name: lora.name, classification: lora.classification, enabled: false, needs_confirmation: true, sha256: lora.sha256, base_model: lora.base_model, trigger_words: lora.trigger_words, licence: lora.licence, strength_default: lora.strength_default, bytes: lora.bytes, source_url: lora.source_url, added_at: lora.added_at }, 200);
  } catch (error) {
    if (error instanceof StackVideoError) {
      const status = error.status === 403 || error.status === 409 || error.status === 413 || error.status === 422 ? error.status : 503;
      return c.json({ error: error.message, code: error.code }, status as 403 | 409 | 413 | 422 | 503) as never;
    }
    throw error;
  }
});
