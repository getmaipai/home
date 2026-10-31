import { getPictureJob } from "@/lib/pictures/jobs";
import { pictureEngineReady } from "@/lib/pictures/ready";
import { pictureDenial } from "@/lib/pictures/policy";
import { startSongCover } from "@/lib/music/cover";
import { listVersions } from "@/lib/imageEdit";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { musicJobs } from "@/db/schema";
import { memory, pruneMusicJobs } from "@/lib/music/store";
// MUSIC-GEN-03: private chat cards and exports, every entrance behind the same age and surface gate.
import { createRoute, z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import type { AppEnv } from "@/types";
import { musicDenial, musicViewDenial, MUSIC_DENIAL_LINE } from "@/lib/music/policy";
import { jobQueueCopy } from "@/lib/jobQueueCopy";
import { laneOf } from "@/lib/pictures/lane";
import { musicEngineStatus, musicStatusReady } from "@/lib/music/ready";
import { cancelMusicJob, getMusicJobFor, jobsForConversation, musicVersions, openMusicFile, plainMusicFailure, prepareOwnedStemsJob, prepareStemsJob, startMusicJob, useMusicVersion, type MusicFileHandle, type MusicJob } from "@/lib/music/jobs";
import { lengthOf, prepareMusicEdit } from "@/lib/music/tool";
import { refuseMusicPrompt, MUSIC_REFUSAL_LINE } from "@/lib/music/policy";
import { StackMusicError } from "@/lib/music/stack";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { sungLyricsFromLrc, withoutLastLines } from "@/lib/music/sections";
import { commercialUseOf, COMMERCIAL_REFUSAL_LINE } from "@/lib/music/commercial";
import { refusePrompt } from "@/lib/pictures/policy";
export const musicRoutes = apiRouter();
export function musicRouteAudience(actor: PersonRow) { return { actor, band: speakerAgeBand(actor, new Date()), surface: "chat" as const, surfaceClass: "written" as const, spoken: false }; }
// Making a song needs the full gate (age, surface and the household switch). A person's own existing song (the card, Stop,
// play, download, Use this version) needs only the age and surface lines: switching music off never strands a finished song.
const gate = createMiddleware<AppEnv>(async (c, next) => {
  const denial = musicDenial(musicRouteAudience(c.get("person")));
  if (denial) return c.json({ error: MUSIC_DENIAL_LINE[denial], code: denial }, 403);
  await next();
});
const viewGate = createMiddleware<AppEnv>(async (c, next) => {
  const denial = musicViewDenial(musicRouteAudience(c.get("person")));
  if (denial) return c.json({ error: MUSIC_DENIAL_LINE[denial], code: denial }, 403);
  await next();
});
const middleware = [requireAuth, gate] as [typeof requireAuth, typeof gate];
const viewMiddleware = [requireAuth, viewGate] as [typeof requireAuth, typeof viewGate];
const refusals = errorResponses({ 401: "Not signed in", 403: "Music is off for this profile", 404: "No such song", 409: "Commercial export not allowed" });
const params = z.object({ id: z.string().min(1).max(80) });
const versionSchema = z.object({ id: z.string(), label: z.string(), url: z.string() });
const stages = ["Queued", "Loading", "Planning", "Making", "Mixing", "Finishing"] as const;
const musicStagesSchema = z.array(z.object({ id: z.string(), label: z.string() }));
const cardSchema = z.object({
  conversation_id: z.string().nullable().optional(), made_from_file: z.boolean().optional(),
  id: z.string(), state: z.enum(["queued", "running", "done", "failed", "cancelled"]), stage: z.string().nullable(), stage_label: z.string(),
  task: z.string(),
  cut: z.enum(["asked", "ceiling"]).nullable(), max_seconds: z.number().nullable(),
  progress: z.number(), eta_seconds: z.number().nullable(), position: z.number().nullable(), error_line: z.string().nullable(),
  stages: musicStagesSchema, stage_index: z.number().int().min(0), started_at: z.number(),
  cover_pending: z.boolean(), cover_url: z.string().nullable(), cover_versions: z.array(z.object({ id: z.string(), url: z.string() })),
  timed_lyrics: z.array(z.object({ t: z.number(), line: z.string(), section: z.string().nullable() })).nullable(),
  versions: z.array(versionSchema), current_id: z.string().nullable(), length: z.enum(["quick", "full"]), title: z.string().nullable(), description: z.string().nullable(), lyrics: z.string().nullable(), duration_s: z.number().nullable(),
});
export function musicFileUrl(job: MusicJob): string { return `/api/music/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(job.fileId!)}`; }
const MUSIC_STAGE_LABELS: Record<string, string> = {
  loading: "Loading", starting: "Loading",
  planning: "Planning", lm: "Planning",
  making: "Making", dit: "Making", music: "Making", generating: "Making",
  vae: "Mixing", decoding: "Mixing", mixing: "Finishing", encoding: "Finishing", saving: "Finishing",
  paused: "Paused while chat is working",
};
const MUSIC_STAGE_INDEX: Record<string, number> = {
  loading: 1, starting: 1, planning: 2, lm: 2,
  dit: 3, making: 3, music: 3, generating: 3,
  vae: 4, decoding: 4, mixing: 5, encoding: 5, saving: 5,
};
const lastKnownMusicStage = new Map<string, number>();
export function musicStageIndex(job: MusicJob): number {
  if (job.state === "queued" || job.stage === "queued") { lastKnownMusicStage.set(job.id, 0); return 0; }
  if (job.state === "done") { lastKnownMusicStage.set(job.id, stages.length - 1); return stages.length - 1; }
  const known = job.stage ? MUSIC_STAGE_INDEX[job.stage] : undefined;
  if (known !== undefined) {
    const index = Math.max(lastKnownMusicStage.get(job.id) ?? 0, known);
    lastKnownMusicStage.set(job.id, index);
    if (lastKnownMusicStage.size > 500) lastKnownMusicStage.delete(lastKnownMusicStage.keys().next().value!);
    return index;
  }
  return lastKnownMusicStage.get(job.id) ?? 0;
}
const warnedMusicStages = new Set<string>();
export function musicStageLabel(job: MusicJob, audience: "adult" | "child" = "adult"): string {
  if (job.stage == null || job.stage === "") return "";
  if (job.state === "queued" && job.stage === "queued") return jobQueueCopy("queued", "queue", job.position, null, audience);
  if (job.stage === "paused") return jobQueueCopy("paused_chat", "paused_chat", null, null, audience);
  if (job.stage === "longer") return ["queued", "running"].includes(job.state) ? "Making it longer so every line fits" : "";
  const label = MUSIC_STAGE_LABELS[job.stage];
  if (!label && !warnedMusicStages.has(job.stage)) {
    warnedMusicStages.add(job.stage);
    console.warn(`[music] unknown Stack stage: ${job.stage}`);
  }
  if (!label || job.state !== "running") return "";
  return label;
}
/** MUSIC-GEN-17: the card shows the words the engine sang (its own `lrc`, squeezed lines left out), else the words sent. */
function cardLyricsOf(job: MusicJob): string | null {
  const words = job.request.lyrics ?? null;
  if (!job.lrc || !words || job.request.instrumental) return words;
  const sung = sungLyricsFromLrc(job.lrc, job.durationS);
  const timed = sungLyricsFromLrc(job.lrc, null, { keepSqueezed: true });
  return sung.length && sung.length < timed.length ? withoutLastLines(words, timed.length - sung.length) : words;
}
export async function musicCardView(actor: PersonRow, input: Omit<MusicJob, "coverJobId" | "coverFileId"> & Partial<Pick<MusicJob, "coverJobId" | "coverFileId">>) {
  const root: MusicJob = { coverJobId: null, coverFileId: null, ...input };
  // A finished split is one card that steps through its tracks (vocals, drums, bass, other), each with its own Download and Share.
  const stemOrder: Record<string, number> = { vocals: 0, drums: 1, bass: 2, other: 3 };
  const stemName = (job: MusicJob) => (job.request.title?.match(/\(([^)]+)\)$/)?.[1] ?? "").toLowerCase();
  const stemSet = root.task === "stems" && root.conversationId && root.parentFileId
    ? jobsForConversation(actor, root.conversationId, root.temporary)
      .filter((job) => job.task === "stems" && job.state === "done" && job.parentFileId === root.parentFileId && job.request.stemsOf === root.request.stemsOf && !!job.fileId)
      .sort((a, b) => (stemOrder[stemName(a)] ?? 9) - (stemOrder[stemName(b)] ?? 9))
    : [];
  const versions = stemSet.length ? stemSet : musicVersions(actor, root);
  const current = stemSet.length ? stemSet[0] : [...versions].sort((a, b) => (b.chosenAt ?? b.createdAt).localeCompare(a.chosenAt ?? a.createdAt) || b.id.localeCompare(a.id))[0];
  const shown = current ?? root;
  const versionLabel = (job: MusicJob, index: number) => stemSet.length ? stemName(job).replace(/^./, (c) => c.toUpperCase()) : `Version ${index + 1}`;
  let covers: { id: string; url: string }[] = [];
  if (shown.coverFileId && shown.conversationId) {
    try { covers = listVersions(actor, shown.conversationId, shown.coverFileId).map(({ id, url }) => ({ id, url })); } catch { /* A deleted cover leaves the song playable. */ }
  }
  let coverPending = false;
  if (root.state === "done" && shown.state === "done" && !shown.coverFileId && !shown.temporary && shown.conversationId && shown.turnId && !pictureDenial(musicRouteAudience(actor)) && await pictureEngineReady()) {
    const picture = shown.coverJobId ? getPictureJob(actor, shown.coverJobId) : null;
    coverPending = shown.coverJobId
      ? picture?.state === "queued" || picture?.state === "running"
      : Date.now() - Date.parse(shown.updatedAt) < 30_000;
  }
  return {
    stages: stages.map((label, index) => ({ id: ["queued", "model", "planning", "making", "mixing", "finishing"][index]!, label })),
    stage_index: musicStageIndex(root), started_at: Date.parse(root.createdAt),
    cover_pending: coverPending,
    cover_url: covers.at(-1)?.url ?? null, cover_versions: covers,
    conversation_id: root.temporary ? null : root.conversationId, made_from_file: root.request.ownedFile === true,
    id: root.id, task: root.task, state: root.state, stage: root.stage, stage_label: musicStageLabel(root, laneOf(musicRouteAudience(actor)) === "child" ? "child" : "adult"), progress: root.progress,
    cut: (current ?? root).request.cut ?? null, max_seconds: (current ?? root).request.max_seconds ?? null,
    eta_seconds: root.etaSeconds, position: root.position, error_line: root.errorLine,
    versions: versions.map((job, index) => ({ id: job.fileId!, label: versionLabel(job, index), url: musicFileUrl(job) })),
    current_id: current?.fileId ?? null, length: lengthOf((current ?? root).request, (current ?? root).durationS), title: current?.request.title ?? root.request.title ?? null,
    description: current?.request.description ?? root.request.description ?? null,
    timed_lyrics: shown.lrc && !shown.request.instrumental ? sungLyricsFromLrc(shown.lrc, shown.durationS).map(({ t, line, section }) => ({ t, line, section })) : null,
    lyrics: cardLyricsOf(shown), duration_s: current?.durationS ?? root.durationS,
  };
}
const statusRoute = createRoute({ method: "get", path: "/status", tags: ["Music"], summary: "Whether this person can make songs now", middleware,
  responses: { 200: { content: { "application/json": { schema: z.object({ can_make: z.boolean(), engine_ready: z.boolean(), limits: z.object({ min_seconds: z.number(), max_seconds: z.number() }).nullable() }) } }, description: "Music capability." }, ...refusals } });
musicRoutes.openapi(statusRoute, async (c) => {
  const engine = await musicEngineStatus(); const ready = musicStatusReady(engine);
  return c.json({ can_make: ready, engine_ready: ready, limits: engine?.limits ?? null }, 200);
});
const getRoute = createRoute({ method: "get", path: "/jobs/{id}", tags: ["Music"], summary: "The owner's song card", middleware: viewMiddleware, request: { params },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "Progress and versions." }, ...refusals } });
musicRoutes.openapi(getRoute, async (c) => {
  const actor = c.get("person"); const job = getMusicJobFor(actor, c.req.valid("param").id);
  if (!job) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  return c.json(await musicCardView(actor, job), 200);
});
const coverRoute = createRoute({ method: "post", path: "/jobs/{id}/cover", tags: ["Music"], summary: "Make a new cover for the shown song", middleware,
  request: { params, body: { content: { "application/json": { schema: z.object({ prompt: z.string().trim().min(3).max(1200).optional() }) } } } }, responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The song card." }, ...refusals, ...errorResponses({ 409: "The song or its cover is still being made" }) } });
musicRoutes.openapi(coverRoute, async (c) => {
  const actor = c.get("person"); const root = getMusicJobFor(actor, c.req.valid("param").id);
  if (!root) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  const current = musicVersions(actor, root).sort((a, b) => (b.chosenAt ?? b.createdAt).localeCompare(a.chosenAt ?? a.createdAt) || b.id.localeCompare(a.id))[0] ?? root;
  if (current.state !== "done") return c.json({ error: "The song is still being made. Try New cover when it is ready." }, 409) as never;
  const { prompt } = c.req.valid("json");
  if (prompt && refusePrompt(prompt, { lane: laneOf(musicRouteAudience(actor)) })) return c.json({ error: "That cover request can't be used. Try a different description." }, 403) as never;
  if (await startSongCover(actor, current, prompt ? { prompt: `${prompt}. Album cover art for ${current.request.title ?? "this song"}. No text, no letters.` } : {}) === "busy") return c.json({ error: "A cover is already being made. It will show in a moment." }, 409) as never;
  return c.json(await musicCardView(actor, getMusicJobFor(actor, root.id) ?? root), 200);
});

const reviseRoute = createRoute({ method: "post", path: "/jobs/{id}/revise", tags: ["Music"], summary: "Make a new version of the song with a style change", middleware,
  request: { params, body: { content: { "application/json": { schema: z.object({ change: z.string().trim().min(3).max(600), file_id: z.string().min(1).max(80).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The card with a new version coming." }, 422: { description: "The requested edit cannot be made." }, ...refusals } });
musicRoutes.openapi(reviseRoute, async (c) => {
  const actor = c.get("person"); const root = getMusicJobFor(actor, c.req.valid("param").id); const { change, file_id } = c.req.valid("json");
  const versions = root ? musicVersions(actor, root).filter((j) => j.state === "done" && j.fileId) : [];
  const source = (file_id ? versions.find((j) => j.fileId === file_id) : versions.sort((a, b) => (b.chosenAt ?? b.createdAt).localeCompare(a.chosenAt ?? a.createdAt))[0]) ?? null;
  if (!root || !source || !source.conversationId || !source.turnId) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  const engine = await musicEngineStatus();
  if (!musicStatusReady(engine)) return c.json({ error: plainMusicFailure("not_installed") }, 503) as never;
  const description = `${source.request.description.trim()}. Change: ${change}`.slice(0, 1200);
  const plan = prepareMusicEdit(source, { track: source.fileId!, change: "remake", description }, engine!.limits);
  if (!plan.ok) return c.json({ error: plan.line }, 422) as never;
  // The revised prompt is the source of truth for both the stored request and the Stack body.
  plan.request.description = description;
  plan.body.caption = description;
  const refusal = refuseMusicPrompt([description, plan.request.lyrics, plan.request.written_lyrics, plan.request.title, plan.request.key, plan.request.language].filter(Boolean).join(" "));
  if (refusal) return c.json({ error: MUSIC_REFUSAL_LINE[refusal] }, 403) as never;
  plan.request.seconds = Math.min(plan.request.seconds, engine!.limits.max_seconds); plan.body.duration_s = plan.request.seconds;
  try { await startMusicJob({ actor, conversationId: source.conversationId, turnId: source.turnId, temporary: source.temporary, task: plan.task, request: plan.request, body: plan.body, parentFileId: source.fileId }); }
  catch (error) { return c.json({ error: plainMusicFailure(error instanceof StackMusicError ? error.code : "failed") }, 503) as never; }
  return c.json(await musicCardView(actor, root), 200);
});
const stemsRoute = createRoute({ method: "post", path: "/jobs/{id}/stems", tags: ["Music"], summary: "Split the shown song into stems", middleware,
  request: { params, body: { content: { "application/json": { schema: z.object({ file_id: z.string().min(1).max(80).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The card with stems coming." }, 422: { description: "The source cannot be split." }, ...refusals, ...errorResponses({ 503: "Stem splitting is unavailable" }) } });
musicRoutes.openapi(stemsRoute, async (c) => {
  const actor = c.get("person"); const root = getMusicJobFor(actor, c.req.valid("param").id); const { file_id } = c.req.valid("json");
  const versions = root ? musicVersions(actor, root).filter((j) => j.state === "done" && j.fileId && j.task !== "stems") : [];
  const source = (file_id ? versions.find((j) => j.fileId === file_id) : versions.sort((a, b) => (b.chosenAt ?? b.createdAt).localeCompare(a.chosenAt ?? a.createdAt))[0]) ?? null;
  if (!root || !source || !source.conversationId || !source.turnId) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  const prepared = await prepareStemsJob(actor, source);
  if (!prepared.ok) return c.json({ error: prepared.line }, prepared.status) as never;
  let stemsJob: MusicJob;
  // The split is its own message in the chat ("Split into stems" and a card of its tracks): the chat lists one music card per turn, so reusing the song's turn would never show it.
  const turnId = source.temporary ? source.turnId : newConversationTurnId();
  try { stemsJob = await startMusicJob({ actor, conversationId: source.conversationId, turnId, temporary: source.temporary, task: prepared.task, request: prepared.request, body: prepared.body, parentFileId: source.fileId }); }
  catch (error) { return c.json({ error: plainMusicFailure(error instanceof StackMusicError ? error.code : "failed") }, 503) as never; }
  if (!source.temporary) logTurn(actor, "chat", "Split into stems", { reply: { text: "Splitting it into stems." }, source: "plugin", plugin_id: "edit_music", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: source.conversationId, turn_id: turnId });
  return c.json(await musicCardView(actor, stemsJob!), 200);
});
// TIER-STEMS-02b: split an audio file the person owns in their Library. Same age and surface gate as every music action; the split is its own chat, named for the file.
const stemsFromFileRoute = createRoute({ method: "post", path: "/stems/from-file", tags: ["Music"], summary: "Split an audio file in my Library into stems", middleware,
  request: { body: { content: { "application/json": { schema: z.object({ file_id: z.string().min(1).max(80), temporary: z.boolean().optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The card with stems coming." }, 413: { description: "The file is too big." }, 422: { description: "The file cannot be split." }, ...refusals, ...errorResponses({ 503: "Stem splitting is unavailable" }) } });
musicRoutes.openapi(stemsFromFileRoute, async (c) => {
  const actor = c.get("person"); const { file_id, temporary = false } = c.req.valid("json");
  const prepared = await prepareOwnedStemsJob(actor, file_id);
  if (!prepared.ok) return c.json({ error: prepared.line }, prepared.status) as never;
  const conversation = resolveOrCreateConversation(actor, "chat", undefined, { temporary });
  if (!conversation.ok) return c.json({ error: plainMusicFailure("stems_unavailable") }, 503) as never;
  const turnId = newConversationTurnId();
  let job: MusicJob;
  try { job = await startMusicJob({ actor, conversationId: conversation.value.id, turnId, temporary, task: "stems", request: prepared.request, body: prepared.body, parentFileId: file_id }); }
  catch (error) { return c.json({ error: plainMusicFailure(error instanceof StackMusicError ? error.code : "failed") }, 503) as never; }
  if (!temporary) logTurn(actor, "chat", `Split: ${prepared.name}`, { reply: { text: "Splitting it into stems." }, source: "plugin", plugin_id: "edit_music", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conversation.value.id, turn_id: turnId });
  return c.json(await musicCardView(actor, job), 200);
});
const cancelRoute = createRoute({ method: "delete", path: "/jobs/{id}", tags: ["Music"], summary: "Stop a song being made", middleware: viewMiddleware, request: { params },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The stopped card." }, ...refusals } });
musicRoutes.openapi(cancelRoute, async (c) => {
  const actor = c.get("person"); const job = await cancelMusicJob(actor, c.req.valid("param").id);
  if (!job) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  return c.json(await musicCardView(actor, job), 200);
});
const useRoute = createRoute({ method: "post", path: "/jobs/{id}/use", tags: ["Music"], summary: "Use a version for the next edit", middleware: viewMiddleware,
  request: { params, body: { content: { "application/json": { schema: z.object({ file_id: z.string().min(1).max(80) }) } } } },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The selected version." }, ...refusals } });
musicRoutes.openapi(useRoute, async (c) => {
  const actor = c.get("person"); const root = getMusicJobFor(actor, c.req.valid("param").id);
  if (!root || !useMusicVersion(actor, root, c.req.valid("json").file_id)) return c.json({ error: "That version isn't available any more. Choose another version." }, 404) as never;
  return c.json(await musicCardView(actor, root), 200);
});

// Make it full / Make it quick (owner, 2026-10-17): the same song made again at the other length, as a new version on the same card.
const lengthRoute = createRoute({ method: "post", path: "/jobs/{id}/length", tags: ["Music"], summary: "Make the shown song again as a quick or a full song", middleware,
  request: { params, body: { content: { "application/json": { schema: z.object({ length: z.enum(["quick", "full"]), file_id: z.string().min(1).max(80).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The card with the new version coming." }, 422: { description: "The requested edit cannot be made." }, ...refusals } });
musicRoutes.openapi(lengthRoute, async (c) => {
  const actor = c.get("person"); const root = getMusicJobFor(actor, c.req.valid("param").id); const { length, file_id } = c.req.valid("json");
  const versions = root ? musicVersions(actor, root).filter((j) => j.state === "done" && j.fileId) : [];
  const source = (file_id ? versions.find((j) => j.fileId === file_id) : versions.sort((a, b) => (b.chosenAt ?? b.createdAt).localeCompare(a.chosenAt ?? a.createdAt))[0]) ?? null;
  if (!root || !source || !source.conversationId || !source.turnId) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  const engine = await musicEngineStatus();
  if (!musicStatusReady(engine)) return c.json({ error: plainMusicFailure("not_installed") }, 503) as never;
  const plan = prepareMusicEdit(source, { track: source.fileId!, change: length === "full" ? "make_full" : "make_quick" }, engine!.limits);
  if (!plan.ok) return c.json({ error: plan.line }, 422) as never;
  const refusal = refuseMusicPrompt([plan.request.description, plan.request.lyrics, plan.request.written_lyrics, plan.request.title, plan.request.key, plan.request.language].join(" "));
  if (refusal) return c.json({ error: MUSIC_REFUSAL_LINE[refusal] }, 403) as never;
  plan.request.seconds = Math.min(plan.request.seconds, engine!.limits.max_seconds); plan.body.duration_s = plan.request.seconds;
  try {
    await startMusicJob({ actor, conversationId: source.conversationId, turnId: source.turnId, temporary: source.temporary, task: plan.task, request: plan.request, body: plan.body, parentFileId: source.fileId });
  } catch (error) {
    return c.json({ error: plainMusicFailure(error instanceof StackMusicError ? error.code : "failed") }, 503) as never;
  }
  return c.json(await musicCardView(actor, root), 200);
});
/** Audio seeking uses the same single-Range semantics as the video card. */
function audioResponse(file: MusicFileHandle, rangeHeader?: string): Response {
  const total = file.size;
  const headers: Record<string, string> = { "content-type": file.mediaType, "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (rangeHeader) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!range || (!range[1] && !range[2])) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${total}` } });
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= total) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${total}` } });
    const bytes = file.read(start, end + 1);
    return new Response(bytes, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${total}`, "content-length": String(bytes.length) } });
  }
  return new Response(file.read(0, total), { status: 200, headers: { ...headers, "content-length": String(total) } });
}
const fileRoute = createRoute({ method: "get", path: "/jobs/{id}/files/{fileId}", tags: ["Music"], summary: "The owner's audio with Range support", middleware: viewMiddleware,
  request: { params: params.extend({ fileId: z.string().min(1).max(80) }) },
  responses: { 200: { content: { "audio/mp4": { schema: z.string() } }, description: "Audio bytes." }, 206: { description: "A Range slice." }, 416: { description: "Range outside the file." }, ...refusals } });
musicRoutes.openapi(fileRoute, (c) => {
  const actor = c.get("person"); const { id, fileId } = c.req.valid("param"); const root = getMusicJobFor(actor, id);
  const version = root ? musicVersions(actor, root).find((j) => j.fileId === fileId) : null;
  const file = version ? openMusicFile(actor, version, fileId) : null;
  if (!file) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  return audioResponse(file, c.req.header("Range")) as never;
});
const exportRoute = createRoute({ method: "get", path: "/files/{fileId}", tags: ["Music"], summary: "Download a song, checking its chain for commercial export", middleware: viewMiddleware,
  request: { params: z.object({ fileId: z.string().min(1).max(80) }), query: z.object({ purpose: z.enum(["commercial", "personal"]).optional() }) },
  responses: { 200: { content: { "audio/mp4": { schema: z.string() } }, description: "Audio bytes." }, 206: { description: "A Range slice." }, ...refusals } });
musicRoutes.openapi(exportRoute, (c) => {
  const actor = c.get("person"); const { fileId } = c.req.valid("param");
  // Use the owner index, never a Library share or parent access. Temporary songs remain scoped to their owner too.
  const job = findOwnedSong(actor, fileId);
  const file = job ? openMusicFile(actor, job, fileId) : null;
  if (!file) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  if (c.req.valid("query").purpose === "commercial" && commercialUseOf(fileId) !== "cleared") return c.json({ error: COMMERCIAL_REFUSAL_LINE }, 409) as never;
  return audioResponse(file, c.req.header("Range")) as never;
});
function findOwnedSong(actor: PersonRow, fileId: string): MusicJob | null {
  pruneMusicJobs();
  const temp = [...memory.values()].find((j) => j.personId === actor.id && j.fileId === fileId);
  if (temp) return temp;
  const row = db.select({ id: musicJobs.id }).from(musicJobs).where(and(eq(musicJobs.personId, actor.id), eq(musicJobs.fileId, fileId))).get();
  return row ? getMusicJobFor(actor, row.id) : null;
}
