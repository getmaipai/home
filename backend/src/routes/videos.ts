// VIDEO-GEN-04/06: the video card's routes and the Settings page's library routes. Signed-in, per person: a job is
// readable and stoppable by its owner only (nobody sees another person's videos, a parent included). Starting a
// clip from a route (Make another, Animate this picture) passes the same age and surface gate as the chat tool and
// the same prompt check, so a route is never a way around either. A child, a teen, a guest and a spoken or shared
// surface are refused here exactly as in the tool.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { speakerAgeBand } from "@/lib/ageBand";
import { PENDING, videoAdaptersFor, allVideoAdapters, dropVideoAdapterCache, forgetVideoAdapterPref, setVideoAdapterEnabled } from "@/lib/videos/adapters";
import { cancelVideoJob, clipUrl, getVideoJobFor, loadGeneratedReference, plainVideoFailure, posterUrl, readVideoFile, startVideoJob, videoJobsForTurn, busyLine, type VideoJob } from "@/lib/videos/jobs";
import { adultVideoAdaptersAllowed, householdAllowsVideo, refuseVideoPrompt, stackAudienceFor, videoAdapterAudiencesFor, videoDenial, VIDEO_DENIAL_LINE, VIDEO_REFUSAL_LINE, type VideoAudience } from "@/lib/videos/policy";
import { videoEngineStatus, videoStatusReady, videoNotReadyReason } from "@/lib/videos/ready";
import { hasAudioTrack, messagesCopyOf, videoFileName, videoTitle } from "@/lib/videos/messagesCopy";
import { addVideoLora, removeVideoLora, StackVideoError, updateVideoLora } from "@/lib/videos/stack";
import { latestGeneratedPictureId, VIDEO_SIZES } from "@/lib/videos/tool";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import type { PersonRow } from "@/types";

export const videosRoutes = apiRouter();

/** The audience of a route call: the signed-in person on the web chat screen. */
export function videoRouteAudience(actor: PersonRow): VideoAudience {
  return { actor, band: speakerAgeBand(actor, new Date()), surface: "chat", surfaceClass: "written", spoken: false };
}

/** The plain words for the video limits, shown on the card and on the settings page. */
/** The most clips one request's card holds (the first and each Make another). */
export const MAX_CLIPS_PER_CARD = 8;

export const VIDEO_LIMITS_LINE = "Videos are 5 seconds at 480p and take about 2 minutes.";

const ItemSchema = z.object({
  id: z.string(),
  state: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  percent: z.number(),
  label: z.string().describe("One plain line for the card: what the engine is doing now."),
  position: z.number().nullable(),
  started_at: z.number().describe("Epoch milliseconds the job started, for the card's elapsed clock."),
  prompt: z.string(),
  kind: z.enum(["generate", "animate"]),
  error: z.string().nullable(),
  clip: z.object({ url: z.string(), poster_url: z.string(), width: z.number(), height: z.number(), seconds: z.number().nullable(), seed: z.number().nullable(), file_id: z.string(), poster_file_id: z.string() }).nullable(),
});
const CardSchema = z.object({ id: z.string(), conversation_id: z.string().nullable(), items: z.array(ItemSchema), can_make_another: z.boolean(), limits: z.string() });

function phaseLabel(job: VideoJob): string {
  if (job.phase === "paused: low memory") return "Paused: low memory";
  if (job.state === "queued" || job.phase === "queued" || job.phase === "waiting for memory") return busyLine(job.position);
  if (job.phase === "setting up") return "Setting up the video model for the first time";
  if (job.phase === "starting" || job.phase === "loading") return "Getting the video model ready";
  if (job.phase === "rendering") return "Drawing the frames";
  if (job.phase === "decoding") return "Finishing the frames";
  if (job.phase === "encoding") return "Putting the video together";
  return "Making your video";
}

function itemView(job: VideoJob) {
  const file = job.state === "done" ? job.files[0] : undefined;
  return {
    id: job.id, state: job.state, percent: job.state === "done" ? 100 : job.percent,
    label: job.state === "queued" || job.state === "running" ? phaseLabel(job) : "",
    position: job.position, started_at: new Date(job.createdAt).getTime(), prompt: job.prompt, kind: job.kind,
    error: job.state === "failed" ? job.error : null,
    clip: file ? { url: clipUrl(job, file), poster_url: posterUrl(job, file), width: file.width, height: file.height, seconds: file.seconds, seed: file.seed, file_id: file.id, poster_file_id: file.poster_id } : null,
  };
}

/** The card for a job: every clip made in the same turn (the first and each Make another), oldest first. */
export function videoCardView(actor: PersonRow, root: VideoJob, canMake: boolean) {
  const group = root.turnId ? videoJobsForTurn(actor, root.turnId) : [root];
  const jobs = group.length > 0 ? group : [root];
  const active = jobs.some((j) => j.state === "queued" || j.state === "running");
  return {
    id: root.id, conversation_id: root.conversationId, items: jobs.map(itemView),
    can_make_another: canMake && !active && jobs.length < MAX_CLIPS_PER_CARD, limits: VIDEO_LIMITS_LINE,
  };
}

const idParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });
const refusals = errorResponses({ 401: "Not signed in", 403: "Videos are off for this profile", 404: "No such video job", 422: "That request is not allowed", 502: "The video engine refused it", 503: "The video engine is not available" });

const statusRoute = createRoute({
  method: "get", path: "/status", tags: ["Videos"], summary: "Whether this person can make videos now, and why not", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ can_make: z.boolean(), reason: z.string().nullable(), engine_ready: z.boolean(), adult_styles: z.boolean(), limits: z.string(), styles: z.array(z.object({ id: z.string(), name: z.string() })) }) } }, description: "Additive." }, ...errorResponses({ 401: "Not signed in" }) },
});
videosRoutes.openapi(statusRoute, async (c) => {
  const actor = c.get("person");
  const audience = videoRouteAudience(actor);
  const denial = videoDenial(audience);
  const engine = await videoEngineStatus();
  const ready = videoStatusReady(engine);
  const styles = denial ? [] : (await videoAdaptersFor(videoAdapterAudiencesFor(audience))).map((a) => ({ id: a.id, name: a.name }));
  return c.json({
    can_make: denial === null && ready,
    reason: denial ? VIDEO_DENIAL_LINE[denial] : ready ? null : videoNotReadyReason(engine),
    engine_ready: ready,
    adult_styles: denial === null && adultVideoAdaptersAllowed(),
    limits: VIDEO_LIMITS_LINE,
    styles,
  }, 200);
});

const getRoute = createRoute({
  method: "get", path: "/jobs/{id}", tags: ["Videos"], summary: "Progress, then the finished clip, of one video job", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "application/json": { schema: CardSchema } }, description: "The card as its owner sees it." }, ...refusals },
});
videosRoutes.openapi(getRoute, (c) => {
  const actor = c.get("person");
  const job = getVideoJobFor(actor, c.req.valid("param").id);
  if (!job) return c.json({ error: "That video isn't available any more. Ask for it again." }, 404) as never;
  return c.json(videoCardView(actor, job, videoDenial(videoRouteAudience(actor)) === null), 200);
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
  const file = job ? readVideoFile(actor, job, fileId) : null;
  if (!job || !file) return c.json({ error: "That video isn't available any more." }, 404) as never;
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

const messagesRoute = createRoute({
  method: "get", path: "/jobs/{id}/messages.mp4", tags: ["Videos"], summary: "The clip prepared for texting: a sound track so a phone treats it as a video, a name from the prompt", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "video/mp4": { schema: z.string() } }, description: "The mp4 as a download named after the prompt (paper-boat-in-the-rain.mp4). A clip made before the Stack added a silent AAC track is converted by the Stack on first request." }, ...errorResponses({ 401: "Not signed in", 404: "No such video" }) },
});
videosRoutes.openapi(messagesRoute, async (c) => {
  const actor = c.get("person");
  const job = getVideoJobFor(actor, c.req.valid("param").id);
  const first = job?.state === "done" ? job.files[0] : undefined;
  const file = job && first ? readVideoFile(actor, job, first.id) : null;
  if (!job || !first || !file) return c.json({ error: "That video isn't available any more. Ask for it again." }, 404) as never;
  let bytes: Uint8Array;
  try { bytes = await messagesCopyOf(first.id, file.bytes, videoTitle(job.prompt)); } catch (error) {
    if (error instanceof StackVideoError) return c.json({ error: `I couldn't prepare the video for texting. ${error.message}`, code: error.code }, error.status >= 500 ? 503 : 422) as never;
    throw error;
  }
  const name = videoFileName(job.prompt);
  return new Response(bytes, { status: 200, headers: { "content-type": "video/mp4", "content-length": String(bytes.byteLength), "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } }) as never;
});

const cancelRoute = createRoute({
  method: "post", path: "/jobs/{id}/cancel", tags: ["Videos"], summary: "Stop a video that is waiting or being made", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "application/json": { schema: CardSchema } }, description: "The card, with the clip stopped (a finished clip stays finished)." }, ...refusals },
});
videosRoutes.openapi(cancelRoute, async (c) => {
  const actor = c.get("person");
  const wanted = getVideoJobFor(actor, c.req.valid("param").id);
  if (!wanted) return c.json({ error: "That video isn't available any more." }, 404) as never;
  // The card's Stop is for the clip being made now, which may be a later one of the same turn.
  const live = (wanted.turnId ? videoJobsForTurn(actor, wanted.turnId) : [wanted]).filter((j) => j.state === "queued" || j.state === "running");
  for (const job of live) await cancelVideoJob(actor, job.id);
  const fresh = getVideoJobFor(actor, wanted.id) ?? wanted;
  return c.json(videoCardView(actor, fresh, videoDenial(videoRouteAudience(actor)) === null), 200);
});

async function gateRoute(actor: PersonRow, prompt: string): Promise<{ status: 403 | 422 | 503; body: { error: string; code: string } } | null> {
  const audience = videoRouteAudience(actor);
  const denial = videoDenial(audience);
  if (denial) return { status: 403, body: { error: VIDEO_DENIAL_LINE[denial], code: denial } };
  const refused = refuseVideoPrompt(prompt);
  if (refused) return { status: 422, body: { error: VIDEO_REFUSAL_LINE[refused], code: refused } };
  { const engine = await videoEngineStatus(); if (!videoStatusReady(engine)) return { status: 503, body: { error: videoNotReadyReason(engine), code: "not_installed" } }; }
  return null;
}

const anotherRoute = createRoute({
  method: "post", path: "/jobs/{id}/another", tags: ["Videos"], summary: "Make another clip from the same words with a new seed (also Try again after a failed or stopped one)", middleware: [requireAuth] as const,
  request: { params: idParams },
  responses: { 200: { content: { "application/json": { schema: CardSchema } }, description: "The card, with a new clip queued." }, ...refusals },
});
videosRoutes.openapi(anotherRoute, async (c) => {
  const actor = c.get("person");
  const source = getVideoJobFor(actor, c.req.valid("param").id);
  if (!source || source.state === "queued" || source.state === "running") return c.json({ error: "That video isn't available any more. Ask for it again." }, 404) as never;
  const blocked = await gateRoute(actor, source.prompt);
  if (blocked) return c.json(blocked.body, blocked.status) as never;
  if (!source.conversationId) return c.json({ error: "That video isn't available any more." }, 404) as never;
  if (source.turnId && videoJobsForTurn(actor, source.turnId).length >= MAX_CLIPS_PER_CARD) return c.json({ error: "That chat already has eight videos from this request. Ask for a new one in a new message.", code: "too_many" }, 422) as never;
  const audience = videoRouteAudience(actor);
  const adapters = await videoAdaptersFor(videoAdapterAudiencesFor(audience));
  // Only LoRAs this person may still use ride along; one turned off since is dropped.
  const loras = source.request.loras.flatMap((id) => { const a = adapters.find((x) => x.id === id); return a ? [{ id: a.id, strength: a.strength_default }] : []; });
  let image: string | undefined;
  if (source.request.source_file_id) {
    const ref = loadGeneratedReference(actor, source.conversationId, source.request.source_file_id, source.temporary);
    if (!ref.ok) return c.json({ error: ref.line, code: "reference" }, 422) as never;
    image = ref.base64;
  }
  try {
    const started = await startVideoJob({
      actor, conversationId: source.conversationId, turnId: source.turnId, temporary: source.temporary, kind: source.kind, prompt: source.prompt, sourceFileId: source.request.source_file_id,
      body: { prompt: source.prompt, size: source.request.size, seconds: source.request.seconds, audience: stackAudienceFor(audience), ...(image ? { image, image_source: "generated" as const } : {}), ...(loras.length ? { loras } : {}) },
    });
    return c.json(videoCardView(actor, started, true), 200);
  } catch (error) {
    const status = error instanceof StackVideoError && error.status === 422 ? 422 : 503;
    return c.json({ error: plainVideoFailure(error), code: error instanceof StackVideoError ? error.code : "failed" }, status) as never;
  }
});

const animateRoute = createRoute({
  method: "post", path: "/animate", tags: ["Videos"], summary: "Animate a picture this home made (a generated picture or a clip's poster)", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ conversation_id: z.string().min(1).max(80), file_id: z.string().min(1).max(80).optional(), turn_id: z.string().min(1).max(80), prompt: z.string().trim().min(3).max(1200).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: CardSchema } }, description: "The card for the new clip." }, ...refusals },
});
videosRoutes.openapi(animateRoute, async (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  const prompt = body.prompt ?? "Bring this picture to life with gentle, natural motion.";
  const blocked = await gateRoute(actor, prompt);
  if (blocked) return c.json(blocked.body, blocked.status) as never;
  const ownTurn = db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, body.turn_id), eq(conversationTurns.conversationId, body.conversation_id), eq(conversationTurns.personId, actor.id))).get();
  if (!ownTurn) return c.json({ error: "That chat isn't available any more. Open it again and try once more.", code: "not_found" }, 404) as never;
  const fileId = body.file_id ?? latestGeneratedPictureId(actor, body.conversation_id);
  const ref = fileId ? loadGeneratedReference(actor, body.conversation_id, fileId, false) : null;
  if (!ref || !ref.ok) return c.json({ error: ref && !ref.ok ? ref.line : "I can only animate a picture that was made here in this home. Ask me to make a picture first, then animate that one.", code: "reference" }, 422) as never;
  const audience = videoRouteAudience(actor);
  const size = ref.width && ref.height && ref.height > ref.width ? VIDEO_SIZES.portrait! : VIDEO_SIZES.landscape!;
  try {
    const job = await startVideoJob({
      actor, conversationId: body.conversation_id, turnId: body.turn_id, temporary: false, kind: "animate", prompt, sourceFileId: ref.id,
      body: { prompt, size, seconds: 5, audience: stackAudienceFor(audience), image: ref.base64, image_source: "generated" },
    });
    return c.json(videoCardView(actor, job, true), 200);
  } catch (error) {
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
    enabled: z.boolean(), adult_adapters: z.boolean(), minors: z.string(), adapters: z.array(AdapterSchema),
  }) } }, description: "Additive." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only" }) },
});
videosRoutes.openapi(settingsRoute, async (c) => {
  const engine = await videoEngineStatus();
  let adapters: Awaited<ReturnType<typeof allVideoAdapters>> = [];
  try { adapters = await allVideoAdapters(); } catch { adapters = []; }
  return c.json({
    state: engine?.state ?? "unavailable", available: engine?.available === true, reason: engine?.reason ?? (engine ? null : "The engine isn't answering."), tier: engine?.tier ?? null,
    model_installed: engine?.model?.installed === true, limits: VIDEO_LIMITS_LINE,
    enabled: householdAllowsVideo(), adult_adapters: adultVideoAdaptersAllowed(),
    minors: "Videos are off for children and teens. No setting turns them on.",
    adapters: adapters.map((a) => ({ id: a.id, name: a.name, classification: a.classification, enabled: a.enabled, needs_confirmation: a.needs_confirmation, sha256: a.sha256, base_model: a.base_model, trigger_words: a.trigger_words, licence: a.licence, strength_default: a.strength_default, bytes: a.bytes, source_url: a.source_url, added_at: a.added_at })),
  }, 200);
});

const adapterIdParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });
const patchAdapterRoute = createRoute({
  method: "patch", path: "/adapters/{id}", tags: ["Videos"], summary: "Switch a video LoRA on or off for chat, or change its class", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { params: adapterIdParams, body: { content: { "application/json": { schema: z.object({ enabled: z.boolean().optional(), classification: z.enum(["all-ages", "adult-only"]).optional(), name: z.string().trim().min(1).max(80).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: AdapterSchema } }, description: "Updated." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only", 404: "No such LoRA", 409: "That class is locked by the file's own description", 422: "A value is out of range" }) },
});
videosRoutes.openapi(patchAdapterRoute, async (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  try {
    // Only a LoRA that is in the library gets a switch: an unknown id never leaves a row behind.
    if (!(await allVideoAdapters()).some((a) => a.id === id)) return c.json({ error: "That style isn't in the library." }, 404) as never;
    if (body.classification || body.name) await updateVideoLora(id, { ...(body.classification ? { classification: body.classification } : {}), ...(body.name ? { name: body.name } : {}) });
    if (typeof body.enabled === "boolean") setVideoAdapterEnabled(id, body.enabled, actor.id);
    dropVideoAdapterCache();
    const found = (await allVideoAdapters()).find((a) => a.id === id);
    if (!found) return c.json({ error: "That style isn't in the library." }, 404) as never;
    return c.json({ id: found.id, name: found.name, classification: found.classification, enabled: found.enabled, needs_confirmation: found.needs_confirmation, sha256: found.sha256, base_model: found.base_model, trigger_words: found.trigger_words, licence: found.licence, strength_default: found.strength_default, bytes: found.bytes, source_url: found.source_url, added_at: found.added_at }, 200);
  } catch (error) {
    if (error instanceof StackVideoError) return c.json({ error: error.message, code: error.code }, (error.status === 404 || error.status === 409 || error.status === 422 ? error.status : 422) as 404 | 409 | 422) as never;
    throw error;
  }
});

const deleteAdapterRoute = createRoute({
  method: "delete", path: "/adapters/{id}", tags: ["Videos"], summary: "Remove a video LoRA and its file", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { params: adapterIdParams },
  responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } }, description: "Removed." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only", 404: "No such LoRA" }) },
});
videosRoutes.openapi(deleteAdapterRoute, async (c) => {
  const { id } = c.req.valid("param");
  try {
    await removeVideoLora(id);
  } catch (error) {
    if (error instanceof StackVideoError && error.status === 404) return c.json({ error: "That style isn't in the library." }, 404) as never;
    throw error;
  }
  forgetVideoAdapterPref(id);
  dropVideoAdapterCache();
  return c.json({ ok: true as const }, 200);
});

const addAdapterRoute = createRoute({
  method: "post", path: "/adapters", tags: ["Videos"], summary: "Add a video LoRA file to the household library", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { body: { content: { "multipart/form-data": { schema: z.object({
    file: z.custom<File>((value) => value instanceof File, "The .safetensors file.").openapi({ type: "string", format: "binary" }),
    name: z.string().trim().min(1).max(80), licence: z.string().trim().min(1).max(120), licence_acknowledged: z.enum(["true", "false"]).optional(),
    source_url: z.string().max(500).optional(), classification: z.enum(["all-ages", "adult-only"]).optional(), trigger_words: z.string().max(400).optional(),
  }) } } } },
  responses: { 200: { content: { "application/json": { schema: AdapterSchema } }, description: "Added." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only", 409: "Already in the library", 413: "Too large", 422: "The file cannot be used", 503: "The video engine is not available" }) },
});
videosRoutes.openapi(addAdapterRoute, async (c) => {
  const form = c.req.valid("form");
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
    // A new style is off, for everyone, until an admin has read its fingerprint and licence and turns it on.
    setVideoAdapterEnabled(lora.id, false, PENDING);
    dropVideoAdapterCache();
    return c.json({ id: lora.id, name: lora.name, classification: lora.classification, enabled: false, needs_confirmation: true, sha256: lora.sha256, base_model: lora.base_model, trigger_words: lora.trigger_words, licence: lora.licence, strength_default: lora.strength_default, bytes: lora.bytes, source_url: lora.source_url, added_at: lora.added_at }, 200);
  } catch (error) {
    if (error instanceof StackVideoError) {
      const status = error.status === 409 || error.status === 413 || error.status === 422 ? error.status : 503;
      return c.json({ error: error.message, code: error.code }, status as 409 | 413 | 422 | 503) as never;
    }
    throw error;
  }
});
