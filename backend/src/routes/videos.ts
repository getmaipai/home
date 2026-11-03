// VIDEO-GEN-04/06: the video card's routes and the Settings page's library routes. Signed-in, per person: a job is
// readable and stoppable by its owner only (nobody sees another person's videos, a parent included). Starting a
// clip from a route (Make another, Animate this picture) passes the same age and surface gate as the chat tool and
// the same prompt check, so a route is never a way around either. A child, a teen, a guest and a spoken or shared
// surface are refused here exactly as in the tool.
import { answerableFitAsk } from "@/lib/jobs/householdQueue";
import { phaseLabel } from "@/lib/videos/phaseLabel";
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { speakerAgeBand } from "@/lib/ageBand";
import { videoAdaptersFor, dropVideoAdapterCache, adapterOfLora } from "@/lib/videos/adapters";
import { cancelVideoJob, clipUrl, getVideoJobFor, plainVideoFailure, posterUrl, readVideoFile, startVideoJob, videoJobsForTurn, type VideoJob } from "@/lib/videos/jobs";
import { plainStageLabel } from "@/lib/jobQueueCopy";
import { promptRefusalLineFor } from "@/lib/pictures/ageCheck";
import { CHILD_NEGATIVE_PROMPT, CHILD_VIDEO_LIMIT_LINE, forceCartoon, kidsDailyVideos, laneOf, releaseKid, reserveKid, videoModelForLane, videosMadeToday } from "@/lib/pictures/lane";
import { adultVideoAdaptersAllowed, householdAllowsVideo, refuseVideoPrompt, stackAudienceFor, videoDenial, VIDEO_DENIAL_LINE, VIDEO_REFUSAL_LINE, type VideoAudience } from "@/lib/videos/policy";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { getLive, liveCardFields } from "@/lib/genLive";
import { videoEngineStatus, videoStatusReady, videoNotReadyReason } from "@/lib/videos/ready";
import { hasAudioTrack, messagesCopyOf, videoFileName, videoTitle } from "@/lib/videos/messagesCopy";
import { addVideoLora, StackVideoError } from "@/lib/videos/stack";
import { readLora, readLoras } from "@/lib/loras/access";
import { confirmLora, markAdultOnly, markAllAges, patchLora, removeLora } from "@/lib/loras/admin";
import { LoraWriteError, getLoraRecord, saveLora } from "@/lib/loras/store";
import { recordFromStack, syncLoras } from "@/lib/loras/sync";
import { latestGeneratedPictureId } from "@/lib/videos/tool";
import { prepareVideoRerun } from "@/lib/videos/rerun";
import { anotherTakeFor, makeVideoFor } from "@/lib/videos/make";
import { getStudioVoice } from "@/lib/videos/studioVoices";
import { appRouteAllowed } from "@/lib/apps";
import { allowedQuality, jobTier, maxOffered, tierArgument } from "@/lib/tiers";
import { LTX25_MAX_MODEL, LTX25_MODEL, chooseVideoQuality, ltx25MaxReady, detailedVideoReady, isVideoQuality, ltx25VideoReady, maxSecondsFor, quickVideoReady, videoSizeFor, VIDEO_SIZES_BY_QUALITY } from "@/lib/videos/quality";
import { videoJobLockItem, videoJobLockState, LOCKED_START_LINE } from "@/lib/videos/lock";
import { lockedView, sessionKeyOf } from "@/lib/adultLock";
import { adultStateOf, setItemLock, NOT_READY_LINE, TEMPORARY_LINE } from "@/lib/adultMarks";
import { getCookie } from "hono/cookie";
import { householdVideoQuality } from "@/lib/videos/policy";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, videoJobs } from "@/db/schema";
import { isOwnerOrAdmin } from "@/lib/access";
import type { PersonRow } from "@/types";

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

export const VIDEO_LIMITS_LINE = "Quick videos are 5 seconds at 480p with no sound and take about 2 minutes. Detailed videos have sound and speech, run up to 10 seconds and take a minute or two.";

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
  error: z.string().nullable(),
  quality: z.enum(["quick", "detailed"]).describe("Which kind made it: Quick (about two minutes, no sound) or Detailed (with sound and speech)."),
  switch_to: z.enum(["quick", "detailed"]).nullable().describe("The other kind this video can be made again as, or null (it uses a style made for one kind, or the other kind is not on this computer)."),
  fit_ask: z.object({ job_id: z.string(), picked: z.string().nullable(), actual: z.string().nullable() }).nullable().describe("Set while this card is asking whether to make it now with the level it can run at (TIER-PRIO-07; `picked` and `actual` are the level names the buttons use) and this person may answer: POST /api/ai/jobs/{job_id}/fit-answer with allow or wait. Null otherwise."),
  max_offered: z.boolean().describe("Whether this person is shown Make it Max: they hold Max, the age band reaches it and a Max model is set for this kind."),
  clip: z.object({ url: z.string(), poster_url: z.string(), width: z.number(), height: z.number(), seconds: z.number().nullable(), seed: z.number().nullable(), file_id: z.string(), poster_file_id: z.string(), has_sound: z.boolean().describe("The clip has a sound track the model made (speech included).") }).nullable(),
  adult: z.object({
    made_audience: z.enum(["all-ages", "adult-only"]).describe("The machine fact and the minor ceiling; never lowered."),
    lock: z.enum(["on", "off"]).describe("Whether the Adult lock applies; the creator can clear it."),
    can_clear: z.boolean().describe("Show 'Unmark as NSFW': the creator, the item is adult-only and locked. Needs the confirm dialog and a fresh passcode (POST /api/adult-lock/confirm, then adult-mark)."),
    can_mark: z.boolean().describe("Show 'Mark as NSFW': the creator, the item is not locked."),
    line: z.string().nullable().describe("The state in plain words, for an adult-only item."),
    history: z.array(z.object({ action: z.enum(["clear", "mark"]), via: z.enum(["creator_passcode", "creator", "admin", "auto"]), at: z.string() })).describe("The creator's own audit rows for this item (no content)."),
  }).nullable().describe("ADULT-LOCK-06: the item's Adult lock state for its creator, once it is shown (null for a clip still being made, a minor or a temporary chat)."),
});
const CardSchema = z.object({ id: z.string(), conversation_id: z.string().nullable(), items: z.array(ItemSchema), can_make_another: z.boolean(), limits: z.string() });
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

function itemView(job: VideoJob, actor: PersonRow, ready: { quick: boolean; detailed: boolean; max?: boolean }) {
  const file = job.state === "done" ? job.files[0] : undefined;
  return {
    id: job.id, state: job.state, percent: job.state === "done" ? 100 : job.percent,
    label: job.state === "queued" ? phaseLabel(job, laneOfPerson(actor) === "child" ? "child" : "adult") : job.state === "running" ? plainStageLabel(getLive(job.id)?.stageLabel, laneOfPerson(actor) === "child" ? "child" : "adult") ?? phaseLabel(job, laneOfPerson(actor) === "child" ? "child" : "adult") : "",
    position: job.position,
    ...(job.state === "running" ? (({ eta_seconds, step, steps, preview_url }) => ({ eta_seconds, step, steps, preview_url: laneOfPerson(actor) === "adult" ? preview_url : null }))(liveCardFields(job.id, (version) => `/api/videos/jobs/${encodeURIComponent(job.id)}/preview?v=${version}`)) : { eta_seconds: null, step: null, steps: null, preview_url: null }), started_at: new Date(job.createdAt).getTime(), prompt: job.prompt, kind: job.kind,
    error: job.state === "failed" ? job.error : null,
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
    can_make_another: canMake && !active && jobs.length < MAX_CLIPS_PER_CARD, limits: VIDEO_LIMITS_LINE,
  };
}

/** Which kinds can run now (read from the Stack's status, cached for a few seconds). */
async function readyFlags(actor: PersonRow): Promise<{ quick: boolean; detailed: boolean; max: boolean }> {
  const engine = await videoEngineStatus();
  // A teen or a child is only ever on Quick (lane review): the card never offers them Detailed, and the job starter would override it anyway.
  // VIDEO-TIERS-01: an adult's LTX-2.5 serves both levels, so either switch is ready when the Stack says it is.
  const adult = laneOfPerson(actor) === "adult";
  return { quick: quickVideoReady(engine) || (adult && ltx25VideoReady(engine)), detailed: adult && (detailedVideoReady(engine) || ltx25VideoReady(engine)), max: adult && ltx25MaxReady(engine) };
}

const idParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });
const refusals = errorResponses({ 401: "Not signed in", 403: "Videos are off for this profile", 404: "No such video job", 422: "That request is not allowed", 502: "Videos could not be made", 503: "Videos are not ready" });

const TierStatusSchema = z.object({ ready: z.boolean(), max_seconds: z.number(), sound: z.boolean(), model: z.enum(["wan", "ltx23", "ltx25", "ltx25max"]).nullable() });
/** VIDEO-TIERS-01: what each level makes on this computer now (the one answer the Create page, the tools and the settings read). A teen or a child: Standard on Wan, silent. Max is the LTX-2.5 Max model when the Stack reports it ready. */
export function videoTiersStatus(engine: Awaited<ReturnType<typeof videoEngineStatus>>, adult: boolean) {
  const ltx25 = adult && ltx25VideoReady(engine);
  const boost23 = adult && detailedVideoReady(engine);
  return {
    standard: ltx25 ? { ready: true, max_seconds: maxSecondsFor("quick", "ltx25", engine), sound: true, model: "ltx25" as const } : { ready: quickVideoReady(engine), max_seconds: maxSecondsFor("quick", "wan"), sound: false, model: quickVideoReady(engine) ? "wan" as const : null },
    boost: ltx25 ? { ready: true, max_seconds: maxSecondsFor("detailed", "ltx25", engine), sound: true, model: "ltx25" as const } : boost23 ? { ready: true, max_seconds: maxSecondsFor("detailed", "ltx23"), sound: true, model: "ltx23" as const } : { ready: false, max_seconds: 0, sound: false, model: null },
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
    adult_styles: denial === null && laneOf(audience) === "adult" && adultVideoAdaptersAllowed(),
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
  const total = file.bytes.byteLength;
  const headers: Record<string, string> = { "content-type": file.mediaType, "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header("Range") ?? "");
  if (range) {
    const hasStart = range[1] !== "";
    const start = hasStart ? Number(range[1]) : Math.max(total - Number(range[2] || 0), 0);
    const end = hasStart && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end < total) {
      const slice = file.bytes.subarray(start, end + 1);
      headers["content-range"] = `bytes ${start}-${end}/${total}`;
      headers["content-length"] = String(slice.byteLength);
      return new Response(slice, { status: 206, headers }) as never;
    }
    // A range that starts past the end (or ends before it starts) is unsatisfiable, not "send everything".
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}`, "cache-control": "private, no-store" } }) as never;
  }
  headers["content-length"] = String(total);
  return new Response(file.bytes, { status: 200, headers }) as never;
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
  const voice = laneOfPerson(actor) === "adult" && appRouteAllowed(actor, "videos", "actions", "add") ? getStudioVoice(actor.id, c.req.valid("param").id) : null;
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
  method: "post", path: "/jobs/{id}/adult-mark", tags: ["Videos"], summary: "Mark a clip NSFW again, or (the creator only, with a fresh passcode ticket) remove its Adult lock", middleware: [requireAuth] as const,
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
  const own = getVideoJobFor(actor, id);
  let fileId: string | undefined;
  if (own) {
    if (own.temporary) return c.json({ error: TEMPORARY_LINE }, 409) as never;
    if (own.state !== "done" || !own.files[0]) return c.json({ error: NOT_READY_LINE }, 409) as never;
    fileId = own.files[0].id;
  } else if (action === "mark" && isOwnerOrAdmin(actor)) {
    // An admin may mark more of the household's items adult-only without seeing them; nothing of the item is answered.
    const row = db.select({ files: videoJobs.files, state: videoJobs.state }).from(videoJobs).where(eq(videoJobs.id, id)).get();
    try { fileId = row?.state === "done" ? (JSON.parse(row.files) as Array<{ id?: string }>)[0]?.id : undefined; } catch { fileId = undefined; }
  }
  if (!fileId) return c.json({ error: "That video isn't available any more." }, 404) as never;
  const done = setItemLock({ actor, fileId, action, ticket: ticket ?? null, ticketItem: id, sessionKey: sessionKeyOf(getCookie(c, "session")) });
  if (!done.ok) return c.json({ error: done.error }, done.status) as never;
  return c.json({ made_audience: done.made_audience, lock: done.lock }, 200);
});

async function gateRoute(actor: PersonRow, prompt: string): Promise<{ status: 403 | 422 | 503; body: { error: string; code: string } } | null> {
  const audience = videoRouteAudience(actor);
  const denial = videoDenial(audience);
  if (denial) return { status: 403, body: { error: VIDEO_DENIAL_LINE[denial], code: denial } };
  const refused = refuseVideoPrompt(prompt, { lane: laneOf(audience) });
  if (refused) return { status: 422, body: { error: promptRefusalLineFor(refused, "video", actor, audience.band, prompt, VIDEO_REFUSAL_LINE[refused]), code: refused } };
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
        prompt: laneOf(audience) === "child" ? forceCartoon(words) : words, size, seconds: laneOf(audience) === "child" ? Math.min(choice.seconds, 3) : choice.seconds, ...(choice.maker === "ltx25max" ? { model: LTX25_MAX_MODEL } : choice.maker === "ltx25" ? { model: LTX25_MODEL } : choice.maker === "ltx23" ? { model: "detailed" as const } : {}), audience: stackAudienceFor(audience),
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
  }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.union([CardSchema, LockedCardSchema]).and(z.object({ notice: z.string().nullable().describe("One plain line when the length was cut to fit the level, else null.") })) } }, description: "The card for the new clip." }, ...refusals },
});
videosRoutes.openapi(makeRoute, async (c) => {
  const actor = c.get("person");
  const result = await makeVideoFor(actor, c.req.valid("json"));
  if (!result.ok) return c.json({ error: result.error, code: result.code }, result.status) as never;
  return c.json({ ...videoCardOrLocked(actor, result.job, true, await readyFlags(actor)), notice: result.notice } as never, 200);
});

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
      download_bytes: z.number().describe("What getting Detailed videos would still download (0 when installed)."),
      component: z.string().describe("The Models and storage id to install it with."),
      licence: z.object({ id: z.string(), name: z.string(), url: z.string() }).nullable(),
      lora_base_model: z.string(),
    }).describe("Detailed videos: sound and speech, up to 10 seconds."),
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
    detailed: (() => {
      const detailed = engine?.qualities?.detailed;
      return {
        installed: detailed?.installed === true, available: detailed?.available === true,
        reason: detailed && !detailed.available ? detailed.memory.reason ?? engine?.reason ?? null : engine && !engine.qualities ? "Detailed videos need an update first. Ask an admin to update Home." : null,
        download_bytes: detailed?.install.remaining_bytes ?? 0, component: "ltx-2-3-distilled-mlx", licence: detailed?.licence ?? null, lora_base_model: detailed?.lora_base_model ?? "ltx-2.3",
      };
    })(),
    enabled: householdAllowsVideo(), adult_adapters: adultVideoAdaptersAllowed(),
    minors: "Videos are off for children and teens. No setting turns them on.",
    adapters: adapters.map(adapterWire),
    locked_styles: list.locked,
  }, 200);
});

const adapterIdParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });
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
    return c.json(record ? adapterWire(adapterOfLora(record)) : { id: lora.id, name: lora.name, classification: lora.classification, enabled: false, needs_confirmation: true, sha256: lora.sha256, base_model: lora.base_model, trigger_words: lora.trigger_words, licence: lora.licence, strength_default: lora.strength_default, bytes: lora.bytes, source_url: lora.source_url, added_at: lora.added_at }, 200);
  } catch (error) {
    if (error instanceof StackVideoError) {
      const status = error.status === 403 || error.status === 409 || error.status === 413 || error.status === 422 ? error.status : 503;
      return c.json({ error: error.message, code: error.code }, status as 403 | 409 | 413 | 422 | 503) as never;
    }
    throw error;
  }
});
