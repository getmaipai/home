import { serveBytes } from "@/lib/media/serve";
import { getPictureJob } from "@/lib/pictures/jobs";
import { PERSISTED_HOLDS, answerableFitAsk, pendingFitAsk, type PersistedHold } from "@/lib/jobs/householdQueue";
import { pictureEngineReady } from "@/lib/pictures/ready";
import { pictureDenial } from "@/lib/pictures/policy";
import { startSongCover } from "@/lib/music/cover";
import { listVersions } from "@/lib/imageEdit";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, musicJobs } from "@/db/schema";
import { trashFile } from "@/lib/libraryTrash";
import { dropMusicJob, memory, pruneMusicJobs } from "@/lib/music/store";
// MUSIC-GEN-03: private chat cards and exports, every entrance behind the same age and surface gate.
import { createRoute, z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { apiRouter, errorResponses, refuseWith } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import type { AppEnv } from "@/types";
import { musicDenial, musicViewDenial, MUSIC_DENIAL_LINE } from "@/lib/music/policy";
import { jobQueueCopy } from "@/lib/jobQueueCopy";
import { laneOf } from "@/lib/pictures/lane";
import { musicEngineStatus, musicStatusReady, musicMaxOffered, musicMaxInstalled, musicQualityFor, musicTierOf, MUSIC_MAX_NOT_INSTALLED_LINE } from "@/lib/music/ready";
import { cancelMusicJob, getMusicJobFor, jobsForConversation, jobsForPerson, musicVersions, openMusicFile, plainMusicFailure, prepareOwnedStemsJob, prepareStemsJob, readMusicFile, resolveSongSource, startMusicJob, useMusicVersion, type MusicFileHandle, type MusicJob } from "@/lib/music/jobs";
import { authorizeTier, maxOffered } from "@/lib/tiers";
import { REFUSED_PREFIX, generateMusicArgs, lengthOf, musicRefusalFor, prepareOwnedMusicEdit, runGenerateMusic, startOwnedMusicPartsJob, type MusicToolInput } from "@/lib/music/tool";
import { resolveSound } from "@/lib/music/sound";
import { refuseMusicPrompt, MUSIC_REFUSAL_LINE } from "@/lib/music/policy";
import { likenessRefusal } from "@/lib/likeness";
import { runSongEdit } from "@/lib/music/songEdit";
import { StackMusicError } from "@/lib/music/stack";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { sungLyricsFromLrc, withoutLastLines } from "@/lib/music/sections";
import { timedLyricsFor } from "@/lib/music/timedWords";
import { requestRealign } from "@/lib/music/libraryAlign";
import { cachedMadeTranslation, fillMadeTranslation, translationLanguage } from "@/lib/music/lyricsTranslate";
import { commercialUseOf, COMMERCIAL_REFUSAL_LINE } from "@/lib/music/commercial";
import { refusePrompt } from "@/lib/pictures/policy";
import { consumeDjLine, deleteCachedDjLine, ensureDjLines, type DjPosition } from "@/lib/music/djLines";
import { getPersonSettingValue } from "@/lib/settings";
import { readClonedVoiceClip } from "@/lib/clonedVoices";
import { promoteMadeSoundFile, savedMadeSounds } from "@/lib/media/appHost";
import { runMakeSound, makeSoundArgs } from "@/lib/music/soundMaker";
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

const djPosition = z.enum(["intro", "transition", "outro"]);
const djPrepareRoute = createRoute({ method: "post", path: "/dj/prepare", tags: ["Music"], summary: "Prepare short DJ lines for upcoming tracks", middleware: viewMiddleware, request: { body: { content: { "application/json": { schema: z.object({ after: z.string().min(1).max(80), next: z.array(z.string().min(1).max(80)).max(2), station: z.string().trim().max(120).optional() }) } } } }, responses: { 202: { description: "Preparation queued." }, 204: { description: "DJ is off." }, ...refusals } });
musicRoutes.openapi(djPrepareRoute, (c) => {
  const actor = c.get("person"), body = c.req.valid("json");
  const mode = getPersonSettingValue(actor, "music.dj");
  if (mode !== "minimal" && mode !== "full") return c.body(null, 204);
  void ensureDjLines(actor, body.after, body.next, { stationName: body.station ?? null }).catch(() => {});
  return c.body(null, 202);
});
const djLineRoute = createRoute({ method: "get", path: "/dj/line", tags: ["Music"], summary: "Fetch and consume a prepared DJ line", middleware: viewMiddleware, request: { query: z.object({ before: z.string().min(1).max(80), position: djPosition }) }, responses: { 200: { description: "One audio line." }, 204: { description: "No prepared line." }, ...refusals } });
musicRoutes.openapi(djLineRoute, async (c) => {
  const actor = c.get("person"), query = c.req.valid("query");
  const line = consumeDjLine(actor, query.before, query.position as DjPosition);
  if (!line) return c.body(null, 204);
  return new Response(line.bytes, { headers: { "content-type": line.mediaType, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
});
const djDeleteRoute = createRoute({ method: "delete", path: "/dj/line", tags: ["Music"], summary: "Delete a prepared DJ line", middleware: viewMiddleware, request: { query: z.object({ before: z.string().min(1).max(80), position: djPosition }) }, responses: { 204: { description: "Line deleted or absent." }, ...refusals } });
musicRoutes.openapi(djDeleteRoute, (c) => { const actor = c.get("person"), query = c.req.valid("query"); deleteCachedDjLine(actor, query.before, query.position as DjPosition); return c.body(null, 204); });
const params = z.object({ id: z.string().min(1).max(80) });
const versionSchema = z.object({ id: z.string(), label: z.string(), url: z.string() });
const stages = ["Queued", "Loading", "Planning", "Making", "Mixing", "Finishing"] as const;
const musicStagesSchema = z.array(z.object({ id: z.string(), label: z.string() }));
const cardSchema = z.object({
  conversation_id: z.string().nullable().optional(), made_from_file: z.boolean().optional(),
  id: z.string(), state: z.enum(["queued", "running", "done", "failed", "cancelled"]), stage: z.string().nullable(), stage_label: z.string(),
  task: z.string(),
  sound: z.object({ loop: z.boolean(), surprise: z.boolean() }).nullable(),
  fit_ask: z.object({ job_id: z.string(), picked: z.string().nullable(), actual: z.string().nullable() }).nullable().describe("Set while this card is asking whether to make it now with the level it can run at (TIER-PRIO-07; `picked` and `actual` are the level names the buttons use) and this person may answer: POST /api/ai/jobs/{job_id}/fit-answer with allow or wait. Null otherwise."),
  cut: z.enum(["asked", "ceiling"]).nullable(), max_seconds: z.number().nullable(),
  progress: z.number(), eta_seconds: z.number().nullable(), position: z.number().nullable(), error_line: z.string().nullable(),
  stages: musicStagesSchema, stage_index: z.number().int().min(0), started_at: z.number(),
  making_version: z.object({ stage_label: z.string(), progress: z.number(), eta_seconds: z.number().nullable(), position: z.number().nullable() }).nullable(),
  cover_pending: z.boolean(), cover_url: z.string().nullable(), cover_versions: z.array(z.object({ id: z.string(), url: z.string() })),
  timed_lyrics: z.array(z.object({ t: z.number(), line: z.string(), section: z.string().nullable(), secondary: z.string().optional(), words: z.array(z.object({ t: z.number(), end: z.number(), text: z.string() })).optional().describe("Each word with its start and end in seconds, when the song's words were timed (MUSIC-GEN-20b); absent on a line without word timing.") })).nullable(),
  versions: z.array(versionSchema), current_id: z.string().nullable(), length: z.enum(["quick", "full"]), quality: z.enum(["quick", "detailed", "max"]), boost_offered: z.boolean(), max_offered: z.boolean().describe("Whether this person is shown Max on the Quality control: the engine offers a Max maker, they hold Max and the age band reaches it."), max_installed: z.boolean().describe("Whether the Max music models are installed. A Max song made without them runs as Boost, so the card disables Max until they are."), title: z.string().nullable(), description: z.string().nullable(), lyrics: z.string().nullable(), duration_s: z.number().nullable(),
});
export function musicFileUrl(job: MusicJob): string { return `/api/music/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(job.fileId!)}`; }
const MUSIC_STAGE_LABELS: Record<string, string> = {
  loading: "Loading", starting: "Loading",
  splitting: "Making", voice_convert: "Making", "voice-convert": "Making", pitch: "Making", converting: "Making", mix: "Mixing",
  planning: "Planning", lm: "Planning",
  making: "Making", dit: "Making", music: "Making", generating: "Making",
  vae: "Mixing", decoding: "Mixing", mixing: "Finishing", encoding: "Finishing", saving: "Finishing",
  paused: jobQueueCopy("paused_chat", "paused_chat", null, null, "adult"),
};
const MUSIC_STAGE_INDEX: Record<string, number> = {
  loading: 1, starting: 1, planning: 2, lm: 2, splitting: 3, voice_convert: 3, "voice-convert": 3, pitch: 3, converting: 3, mix: 4,
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
  const hold = job.stage.startsWith("held:") ? job.stage.slice(5) : null;
  if (hold === "tier_ask" && audience === "adult") { const line = pendingFitAsk(job.id)?.line; if (line) return line; }
  if (hold && PERSISTED_HOLDS.includes(hold)) return jobQueueCopy("queued", hold as PersistedHold, job.position, null, audience);
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
  // A remix, extension or new length that is still being made is a job without a file yet, so it is in no version list: say so on the card.
  const familyFiles = new Set(versions.map((job) => job.fileId).filter((id): id is string => !!id));
  const pending = root.task === "stems" || !root.conversationId ? null
    : jobsForConversation(actor, root.conversationId, root.temporary).find((job) => (job.state === "queued" || job.state === "running") && job.task !== "stems" && job.id !== root.id && !!job.parentFileId && familyFiles.has(job.parentFileId));
  const makingVersion = pending ? { stage_label: musicStageLabel(pending, laneOf(musicRouteAudience(actor)) === "child" ? "child" : "adult"), progress: pending.progress, eta_seconds: pending.etaSeconds, position: pending.position } : null;
  // TIER-HOME-03: the song card offers Boost when the engine has a Detailed maker and this person may use Boost (music has no Max maker yet).
  const engine = await musicEngineStatus();
  const boostOffered = !!engine?.quality.includes("detailed") && authorizeTier({ person: actor, category: "music", requested: "boost" }).tier === "boost";
  // MUSIC-MAX-01: Max follows Boost's gate (grant, age band, level switch) and is shown only when the engine lists a Max maker.
  const maxShown = maxOffered(actor, "music", undefined, musicMaxOffered(engine));
  return {
    stages: stages.map((label, index) => ({ id: ["queued", "model", "planning", "making", "mixing", "finishing"][index]!, label })),
    stage_index: musicStageIndex(root), started_at: Date.parse(root.createdAt),
    cover_pending: coverPending,
    making_version: makingVersion,
    cover_url: covers.at(-1)?.url ?? null, cover_versions: covers,
    conversation_id: root.temporary ? null : root.conversationId, made_from_file: root.request.ownedFile === true,
    id: root.id, task: root.task, state: root.state, stage: root.stage, stage_label: musicStageLabel(root, laneOf(musicRouteAudience(actor)) === "child" ? "child" : "adult"), progress: root.progress,
    sound: root.request.sound ?? null,
    fit_ask: root.state === "queued" && laneOf(musicRouteAudience(actor)) !== "child" ? answerableFitAsk(actor, root.id) : null,
    cut: (current ?? root).request.cut ?? null, max_seconds: (current ?? root).request.max_seconds ?? null,
    eta_seconds: root.etaSeconds, position: root.position, error_line: root.errorLine,
    versions: versions.map((job, index) => ({ id: job.fileId!, label: versionLabel(job, index), url: musicFileUrl(job) })),
    current_id: current?.fileId ?? null, length: lengthOf((current ?? root).request, (current ?? root).durationS),
    quality: (current ?? root).request.quality === "max" ? "max" as const : (current ?? root).request.quality === "detailed" ? "detailed" as const : "quick" as const, boost_offered: boostOffered, max_offered: maxShown, max_installed: musicMaxInstalled(engine), title: current?.request.title ?? root.request.title ?? null,
    description: current?.request.description ?? root.request.description ?? null,
    timed_lyrics: (() => {
      const timed = timedLyricsFor(shown);
      const language = translationLanguage(actor);
      if (!timed || !language || !shown.fileId) return timed;
      const translated = cachedMadeTranslation(shown.fileId, language, timed.map((line) => line.line));
      if (translated?.length === timed.length) return timed.map((line, index) => ({ ...line, ...(translated[index] ? { secondary: translated[index]! } : {}) }));
      if (shown.state === "done") void fillMadeTranslation(shown.fileId, language, timed.map((line) => line.line)).catch(() => {});
      return timed;
    })(),
    lyrics: cardLyricsOf(shown), duration_s: current?.durationS ?? root.durationS,
  };
}
const statusRoute = createRoute({ method: "get", path: "/status", tags: ["Music"], summary: "Whether this person can make songs now", middleware,
  responses: { 200: { content: { "application/json": { schema: z.object({ can_make: z.boolean(), engine_ready: z.boolean(), limits: z.object({ min_seconds: z.number(), max_seconds: z.number() }).nullable() }) } }, description: "Music capability." }, ...refusals } });
musicRoutes.openapi(statusRoute, async (c) => {
  const engine = await musicEngineStatus(); const ready = musicStatusReady(engine);
  return c.json({ can_make: ready, engine_ready: ready, limits: engine?.limits ?? null }, 200);
});
const listRoute = createRoute({ method: "get", path: "/jobs", tags: ["Music"], summary: "The owner's songs, newest first", middleware: viewMiddleware,
  responses: { 200: { content: { "application/json": { schema: z.array(cardSchema) } }, description: "Up to 40 song cards." }, ...refusals } });
musicRoutes.openapi(listRoute, async (c) => {
  const actor = c.get("person");
  const trashed = new Set(db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.ownerPersonId, actor.id), isNotNull(attachments.deletedAt))).all().map((r) => r.id));
  return c.json(await Promise.all(jobsForPerson(actor, 40).filter((job) => !job.request.sound && (!job.fileId || !trashed.has(job.fileId))).map((job) => musicCardView(actor, job))), 200);
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
  const actor = c.get("person"); const { change, file_id } = c.req.valid("json");
  let description = "";
  const result = await runSongEdit({ actor, jobId: c.req.valid("param").id, fileId: file_id,
    input: (source) => { description = `${source.request.description.trim()}. Change: ${change}`.slice(0, 1200); return { change: "remake", description }; },
    // The revised prompt is the source of truth for both the stored request and the Stack body.
    patch: (plan) => { plan.request.description = description; plan.body.caption = description; } });
  return result.ok ? c.json(await musicCardView(actor, result.root), 200) : refuseWith(c, result) as never;
});
// MUSIC-STUDIO-SONG: the Make a song page. It runs the same runGenerateMusic path as the generate_music tool, in a chat of its own
// (so the song shows in chat history like any song made there), and answers with the song card the page polls.
const makeSongBody = z.object({
  idea: z.string().trim().min(3).max(1200).describe("What the song is about and how it should sound."),
  lyrics: z.string().max(4000).optional().describe("The words to sing. Leave out for Home to write them."),
  instrumental: z.boolean().optional(), title: z.string().trim().min(1).max(200).optional(), length: z.enum(["quick", "full"]).optional(),
  bpm: z.number().finite().min(20).max(300).optional(), key: z.string().max(20).optional(),
  song_style: z.string().optional().describe("A saved song style's id (starter or the person's own)."), band: z.string().optional().describe("A made band's id: make the song in that band's sound."),
});
const makeSongRoute = createRoute({ method: "post", path: "/songs", tags: ["Music"], summary: "Make a song from the Make a song page", middleware,
  request: { body: { content: { "application/json": { schema: makeSongBody } } } },
  responses: { 201: { content: { "application/json": { schema: cardSchema } }, description: "The song card, still being made." }, 422: { description: "The song cannot be made as asked." }, ...refusals, ...errorResponses({ 503: "No music model is installed or the computer cannot make songs now" }) } });
musicRoutes.openapi(makeSongRoute, async (c) => {
  const actor = c.get("person"); const body = c.req.valid("json");
  const engine = await musicEngineStatus();
  if (!musicStatusReady(engine)) return c.json({ error: plainMusicFailure("not_installed") }, 503) as never;
  const args: Record<string, unknown> = { description: body.idea, ...(body.lyrics?.trim() ? { lyrics: body.lyrics } : {}), ...(body.instrumental ? { instrumental: true } : {}),
    ...(body.title ? { title: body.title } : {}), ...(body.length ? { length: body.length } : {}), ...(body.bpm !== undefined ? { bpm: body.bpm } : {}),
    ...(body.key?.trim() ? { key: body.key.trim() } : {}), ...(body.song_style ? { song_style: body.song_style } : {}), ...(body.band ? { band: body.band } : {}) };
  if (!generateMusicArgs.safeParse(args).success) return c.json({ error: "That song request is not valid. Check the tempo, the key and the style, then try again." }, 422) as never;
  const refusal = musicRefusalFor(musicRouteAudience(actor), args);
  if (refusal) return c.json({ error: refusal.line }, 403) as never;
  const sound = resolveSound(actor, { song_style: body.song_style, band: body.band });
  if (!sound.ok) return c.json({ error: sound.line }, 422) as never;
  const conversation = resolveOrCreateConversation(actor, "chat", undefined, {});
  if (!conversation.ok) return c.json({ error: plainMusicFailure("failed") }, 503) as never;
  const turnId = newConversationTurnId();
  const state = { actor, persona: null, surface: "chat", speakerEvidence: null, planBasis: { surfaceClass: "written" }, plan: undefined, conversationId: conversation.value.id, turnId, temporary: false, ephemeral: false } as unknown as MusicToolInput["state"];
  const outcome = await runGenerateMusic({ state, args, callId: `page-${turnId}`, spoken: false });
  const jobId = (outcome.result?.data as { musicJobId?: string } | undefined)?.musicJobId;
  const job = jobId ? getMusicJobFor(actor, jobId) : null;
  if (!job) {
    const refused = (outcome.result?.data as { refused?: string } | undefined)?.refused;
    if (refused) return c.json({ error: (outcome.result?.reply?.text ?? "").replace(REFUSED_PREFIX, "") || plainMusicFailure("failed") }, 422) as never;
    return c.json({ error: plainMusicFailure(outcome.errorCode === "no_engine" ? "not_installed" : outcome.errorCode ?? "failed") }, outcome.failureKind === "bad_arguments" ? 422 : 503) as never;
  }
  logTurn(actor, "chat", body.title ? `Make a song: ${body.title}` : "Make a song", { reply: { text: "Making your song." }, source: "plugin", plugin_id: "generate_music", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conversation.value.id, turn_id: turnId });
  return c.json(await musicCardView(actor, job), 201);
});
const makeSoundRoute = createRoute({ method: "post", path: "/sounds", tags: ["Music"], summary: "Make a sound effect", middleware,
  request: { body: { content: { "application/json": { schema: makeSoundArgs } } } },
  responses: { 201: { content: { "application/json": { schema: cardSchema } }, description: "The sound card." }, 422: { description: "The sound cannot be made as asked." }, ...refusals, ...errorResponses({ 503: "No music model is installed or the computer cannot make sounds now" }) } });
musicRoutes.openapi(makeSoundRoute, async (c) => {
  const actor = c.get("person"), args = c.req.valid("json");
  const engine = await musicEngineStatus();
  if (!musicStatusReady(engine)) return c.json({ error: plainMusicFailure("not_installed") }, 503) as never;
  const refusal = musicRefusalFor(musicRouteAudience(actor), args);
  if (refusal) return c.json({ error: refusal.line }, 403) as never;
  const conversation = resolveOrCreateConversation(actor, "chat", undefined, {});
  if (!conversation.ok) return c.json({ error: plainMusicFailure("failed") }, 503) as never;
  const turnId = newConversationTurnId();
  const state = { actor, persona: null, surface: "chat", speakerEvidence: null, planBasis: { surfaceClass: "written" }, plan: undefined, conversationId: conversation.value.id, turnId, temporary: false, ephemeral: false } as unknown as MusicToolInput["state"];
  const outcome = await runMakeSound({ state, args, callId: `page-${turnId}`, spoken: false });
  const jobId = (outcome.result?.data as { musicJobId?: string } | undefined)?.musicJobId;
  const job = jobId ? getMusicJobFor(actor, jobId) : null;
  if (!job) {
    const refused = (outcome.result?.data as { refused?: string } | undefined)?.refused;
    if (refused) return c.json({ error: (outcome.result?.reply?.text ?? "").replace(REFUSED_PREFIX, "") || plainMusicFailure("failed") }, 422) as never;
    return c.json({ error: plainMusicFailure(outcome.errorCode === "no_engine" ? "not_installed" : outcome.errorCode ?? "failed") }, outcome.failureKind === "bad_arguments" ? 422 : 503) as never;
  }
  logTurn(actor, "chat", "Make a sound", { reply: { text: "Making your sound." }, source: "plugin", plugin_id: "make_sound", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conversation.value.id, turn_id: turnId });
  return c.json(await musicCardView(actor, job), 201);
});
const saveSoundRoute = createRoute({ method: "post", path: "/sounds/{id}/save", tags: ["Music"], summary: "Save a made sound to Sounds", middleware: viewMiddleware,
  request: { params }, responses: { 200: { content: { "application/json": { schema: z.object({ item_id: z.string() }) } }, description: "The saved sound." }, ...refusals } });
musicRoutes.openapi(saveSoundRoute, (c) => {
  const job = getMusicJobFor(c.get("person"), c.req.valid("param").id);
  if (!job || job.task === "stems" || !job.request.sound || job.state !== "done" || !job.fileId) return c.json({ error: "No finished sound with that id." }, 404);
  const item = promoteMadeSoundFile(c.get("person"), job.fileId);
  return item ? c.json({ item_id: item.id }, 200) : c.json({ error: "That sound cannot be saved." }, 404);
});
const soundsRoute = createRoute({ method: "get", path: "/sounds", tags: ["Music"], summary: "List saved sounds", middleware: viewMiddleware,
  responses: { 200: { content: { "application/json": { schema: z.array(z.object({ id: z.string(), title: z.string(), duration_s: z.number().nullable(), file_id: z.string(), src: z.string(), loop: z.boolean() })) } }, description: "Saved sound items." }, ...refusals } });
musicRoutes.openapi(soundsRoute, (c) => c.json(savedMadeSounds(c.get("person")), 200));
// Change a song's title, words, style, tempo or key: a new version on the same card; the earlier versions stay.
const detailsRoute = createRoute({ method: "post", path: "/jobs/{id}/details", tags: ["Music"], summary: "Make a new version of the song with a new title, words, style, tempo or key", middleware,
  request: { params, body: { content: { "application/json": { schema: z.object({
    title: z.string().trim().min(1).max(200).optional(), lyrics: z.string().max(4000).optional(), description: z.string().trim().min(3).max(1200).optional(),
    bpm: z.number().finite().min(20).max(300).optional(), key: z.string().max(20).regex(/^[A-G][#b]?\s?(major|minor|maj|min|m)?$/i).optional(), file_id: z.string().min(1).max(80).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The card with a new version coming." }, 422: { description: "The requested edit cannot be made." }, ...refusals } });
musicRoutes.openapi(detailsRoute, async (c) => {
  const actor = c.get("person"); const { file_id, ...changes } = c.req.valid("json");
  if (!Object.values(changes).some((v) => v !== undefined)) return c.json({ error: "Change at least one thing: the title, the words, the style, the tempo or the key." }, 422) as never;
  const result = await runSongEdit({ actor, jobId: c.req.valid("param").id, fileId: file_id, skipStems: true, input: () => ({ change: "remake", ...changes }) });
  return result.ok ? c.json(await musicCardView(actor, result.root), 200) : refuseWith(c, result) as never;
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
const fromFileEditBody = z.object({ file_id: z.string().min(1).max(80), change: z.enum(["restyle", "instrumental", "parts", "stems", "voice_swap"]), voice: z.string().min(1).max(80).optional(), style: z.string().trim().min(3).max(600).optional(), parts: z.object({ keep: z.array(z.string()).optional(), drop: z.array(z.string()).optional() }).optional() }).superRefine((value, ctx) => { if (value.change === "restyle" && !value.style) ctx.addIssue({ code: "custom", path: ["style"], message: "Add a style." }); if (value.change === "voice_swap" && !value.voice) ctx.addIssue({ code: "custom", path: ["voice"], message: "Choose a voice." }); });
const fromFileEditRoute = createRoute({ method: "post", path: "/from-file/edit", tags: ["Music"], summary: "Edit an audio file in my Library", middleware,
  request: { body: { content: { "application/json": { schema: fromFileEditBody } } } },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The new song card." }, 413: { description: "The file is too big." }, 422: { description: "The edit cannot be made." }, ...refusals, ...errorResponses({ 503: "Music is unavailable" }) } });
musicRoutes.openapi(fromFileEditRoute, async c => {
  const actor = c.get("person"), args = c.req.valid("json");
  const source = resolveSongSource(actor, args.file_id, "pending");
  if (!source?.fileId) return c.json({ error: "That file isn't available any more." }, 404) as never;
  const engine = await musicEngineStatus();
  if (!musicStatusReady(engine)) return c.json({ error: plainMusicFailure("not_installed") }, 503) as never;
  const prompt = args.style ?? "";
  const refusal = refuseMusicPrompt(prompt);
  if (refusal) return c.json({ error: MUSIC_REFUSAL_LINE[refusal] }, 403) as never;
  const likeness = likenessRefusal(actor, prompt);
  if (likeness) return c.json({ error: likeness }, 403) as never;
  const sharedPlan = prepareOwnedMusicEdit(source, { change: args.change, ...(args.style ? { style: args.style } : {}), ...(args.parts ? { parts: args.parts } : {}) }, engine!.limits);
  const plan = sharedPlan;
  if (!plan.ok) return c.json({ error: plan.line }, 422) as never;
  const conversation = resolveOrCreateConversation(actor, "chat", undefined, {});
  if (!conversation.ok) return c.json({ error: plainMusicFailure("failed") }, 503) as never;
  const turnId = newConversationTurnId();
  if (args.change === "voice_swap") {
    const clip = readClonedVoiceClip(args.voice!);
    if (!clip) return c.json({ error: "That voice has no sample to sing with." }, 422) as never;
    const prepared = await prepareOwnedStemsJob(actor, args.file_id);
    if (!prepared.ok) return c.json({ error: prepared.line }, prepared.status) as never;
    let job: MusicJob;
    try { job = await startMusicJob({ actor, conversationId: conversation.value.id, turnId, temporary: false, task: "stems", request: { ...prepared.request, voiceSwap: { voiceId: args.voice! } }, body: prepared.body, parentFileId: null }); }
    catch (error) { return c.json({ error: plainMusicFailure(error instanceof StackMusicError ? error.code : "voice_swap") }, 503) as never; }
    logTurn(actor, "chat", "Edit an audio file", { reply: { text: "Changing your song." }, source: "plugin", plugin_id: "edit_music", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conversation.value.id, turn_id: turnId });
    return c.json(await musicCardView(actor, job), 200);
  }
  if (args.change === "parts") {
    try {
      const result = await startOwnedMusicPartsJob({ actor, source, parts: args.parts, conversationId: conversation.value.id, turnId, temporary: false });
      if (!result.ok) return c.json({ error: result.line }, ("status" in result ? result.status : 422)) as never;
      logTurn(actor, "chat", "Edit an audio file", { reply: { text: "Changing your song." }, source: "plugin", plugin_id: "edit_music", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conversation.value.id, turn_id: turnId });
      return c.json(await musicCardView(actor, result.job), 200);
    } catch (error) { return c.json({ error: plainMusicFailure(error instanceof StackMusicError ? error.code : "failed") }, 503) as never; }
  }
  let body = plan.body;
  if (args.change === "stems") {
    const prepared = await prepareOwnedStemsJob(actor, args.file_id);
    if (!prepared.ok) return c.json({ error: prepared.line }, prepared.status) as never;
    body = prepared.body;
  } else {
    const read = readMusicFile(actor, source, args.file_id);
    if (!read) return c.json({ error: "That file isn't available any more." }, 404) as never;
    body.source = Buffer.from(read.bytes).toString("base64"); body.source_sha256 = read.sha256; body.origin = "owned_file";
  }
  let job: MusicJob;
  try { job = await startMusicJob({ actor, conversationId: conversation.value.id, turnId, temporary: false, task: plan.task, request: plan.request, body, parentFileId: args.change === "stems" ? args.file_id : null }); }
  catch (error) { return c.json({ error: plainMusicFailure(error instanceof StackMusicError ? error.code : "failed") }, 503) as never; }
  logTurn(actor, "chat", "Edit an audio file", { reply: { text: "Changing your song." }, source: "plugin", plugin_id: "edit_music", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conversation.value.id, turn_id: turnId });
  return c.json(await musicCardView(actor, job), 200);
});
// MUSIC-GEN-20c: "Lyrics look off" on a scanned Library track: line the words up with the file again, ignoring the stored words. It reads the track
// through the same Library and band gates as the lyrics themselves (no music-making gate: nothing is made), answers at once and works in the background.
const lyricsRealignRoute = createRoute({ method: "post", path: "/library/{id}/lyrics-realign", tags: ["Music"], summary: "Line up a Library track's lyrics with the file again", middleware: [requireAuth] as [typeof requireAuth], request: { params },
  responses: { 202: { content: { "application/json": { schema: z.object({ ok: z.literal(true), state: z.literal("queued") }) } }, description: "Lining the words up again; the lyrics improve in a moment." }, 422: { description: "These lyrics have no timing." }, 429: { description: "Asked again within a minute." }, ...errorResponses({ 401: "Not signed in", 404: "No such song" }) } });
musicRoutes.openapi(lyricsRealignRoute, (c) => {
  const { result } = requestRealign(c.get("person"), c.req.valid("param").id);
  return result.ok ? c.json({ ok: true as const, state: "queued" as const }, 202) : refuseWith(c, result) as never;
});
const cancelRoute = createRoute({ method: "delete", path: "/jobs/{id}", tags: ["Music"], summary: "Stop a song being made", middleware: viewMiddleware, request: { params },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The stopped card." }, ...refusals } });
musicRoutes.openapi(cancelRoute, async (c) => {
  const actor = c.get("person"); const job = await cancelMusicJob(actor, c.req.valid("param").id);
  if (!job) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  return c.json(await musicCardView(actor, job), 200);
});
// Delete a song (owner, 2026-11-02): the song, its versions and covers go to Trash together and come back from there until the keep window ends.
const deleteSongRoute = createRoute({ method: "post", path: "/jobs/{id}/delete", tags: ["Music"], summary: "Move a song and all its versions to Trash", middleware,
  request: { params },
  responses: { 200: { content: { "application/json": { schema: z.object({ deleted: z.number(), trash_until: z.string().nullable() }) } }, description: "How many versions moved to Trash." }, ...refusals } });
musicRoutes.openapi(deleteSongRoute, async (c) => {
  const actor = c.get("person"); const root = getMusicJobFor(actor, c.req.valid("param").id);
  if (!root) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  if (root.state === "queued" || root.state === "running") await cancelMusicJob(actor, root.id);
  let deleted = 0; let trashUntil: string | null = null;
  for (const version of musicVersions(actor, root)) {
    if (!version.fileId) continue;
    if (version.temporary) { dropMusicJob(version); deleted += 1; continue; }
    const result = trashFile(actor, version.fileId);
    if (result.ok) { deleted += 1; trashUntil = result.value.trash_until; }
  }
  // A song with no file (stopped or failed) has nothing for Trash to hold: remove its record, or it stays in the list after "Deleted".
  if (deleted === 0 && !root.fileId) { dropMusicJob(root); db.delete(musicJobs).where(and(eq(musicJobs.id, root.id), eq(musicJobs.personId, actor.id))).run(); }
  else if (deleted === 0 && !db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.id, root.fileId!), isNotNull(attachments.deletedAt))).get()) return c.json({ error: "That song could not be moved to Trash. Refresh the page and try again." }, 409) as never;
  return c.json({ deleted, trash_until: trashUntil }, 200);
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
  const actor = c.get("person"); const { length, file_id } = c.req.valid("json");
  const result = await runSongEdit({ actor, jobId: c.req.valid("param").id, fileId: file_id, input: () => ({ change: length === "full" ? "make_full" : "make_quick" }) });
  return result.ok ? c.json(await musicCardView(actor, result.root), 200) : refuseWith(c, result) as never;
});
// Make it Boost / Make it Standard (TIER-HOME-03): the same song made again with the engine's Detailed or Quick maker, as a new version on the same card.
const qualityRoute = createRoute({ method: "post", path: "/jobs/{id}/quality", tags: ["Music"], summary: "Make the shown song again at Standard, Boost or Max", middleware,
  request: { params, body: { content: { "application/json": { schema: z.object({ tier: z.enum(["standard", "boost", "max"]), file_id: z.string().min(1).max(80).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The card with the new version coming." }, 422: { description: "The requested edit cannot be made." }, ...refusals } });
musicRoutes.openapi(qualityRoute, async (c) => {
  const actor = c.get("person"); const { tier, file_id } = c.req.valid("json");
  const granted = authorizeTier({ person: actor, category: "music", requested: tier }).tier;
  const result = await runSongEdit({ actor, jobId: c.req.valid("param").id, fileId: file_id, input: () => ({ change: "remake" }),
    beforePlan: (engine) => tier === "boost" && (granted !== "boost" || !engine.quality.includes("detailed")) ? { status: 422, error: "A better maker is not available for this song. Make it again at Standard." } : null,
    extraChecks: (plan, engine) => {
      if (tier === "max" && (granted !== "max" || !musicMaxOffered(engine))) return { status: 422, error: "Max is not available for this song. Make it again at Boost or Standard." };
      if (tier === "max" && !musicMaxInstalled(engine)) return { status: 422, error: MUSIC_MAX_NOT_INSTALLED_LINE };
      plan.request.quality = musicQualityFor(engine, tier); plan.request.tier = musicTierOf(plan.request.quality); plan.body.quality = plan.request.quality;
      return null;
    } });
  return result.ok ? c.json(await musicCardView(actor, result.root), 200) : refuseWith(c, result) as never;
});
/** Audio seeking uses the one Range server (`serveBytes`); the slice is read from the file on demand. */
function audioResponse(file: MusicFileHandle, rangeHeader?: string): Response {
  return serveBytes({ size: file.size, slice: (start = 0, end = file.size) => file.read(start, end) as never }, file.mediaType, rangeHeader);
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
