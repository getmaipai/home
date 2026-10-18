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
import { musicEngineStatus, musicStatusReady } from "@/lib/music/ready";
import { cancelMusicJob, getMusicJobFor, musicVersions, openMusicFile, plainMusicFailure, startMusicJob, useMusicVersion, type MusicFileHandle, type MusicJob } from "@/lib/music/jobs";
import { lengthOf, prepareMusicEdit } from "@/lib/music/tool";
import { refuseMusicPrompt, MUSIC_REFUSAL_LINE } from "@/lib/music/policy";
import { StackMusicError } from "@/lib/music/stack";
import { sungLyricsFromLrc, withoutLastLines } from "@/lib/music/sections";
import { commercialUseOf, COMMERCIAL_REFUSAL_LINE } from "@/lib/music/commercial";
import { busyLine } from "@/lib/videos/jobs";
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
const cardSchema = z.object({
  id: z.string(), state: z.enum(["queued", "running", "done", "failed", "cancelled"]), stage: z.string().nullable(), stage_label: z.string(),
  cut: z.enum(["asked", "ceiling"]).nullable(), max_seconds: z.number().nullable(),
  progress: z.number(), eta_seconds: z.number().nullable(), position: z.number().nullable(), error_line: z.string().nullable(),
  cover_url: z.string().nullable(), cover_versions: z.array(z.object({ id: z.string(), url: z.string() })),
  versions: z.array(versionSchema), current_id: z.string().nullable(), length: z.enum(["quick", "full"]), title: z.string().nullable(), description: z.string().nullable(), lyrics: z.string().nullable(), duration_s: z.number().nullable(), started_at: z.number(),
});
export function musicFileUrl(job: MusicJob): string { return `/api/music/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(job.fileId!)}`; }
export function musicStageLabel(job: MusicJob): string {
  if (job.stage === "longer" && ["queued", "running"].includes(job.state)) return "Making it longer so every line fits";
  if (job.state === "queued") return busyLine(job.position);
  if (job.state !== "running") return "";
  switch (job.stage) {
    case "planning": case "lm": return "Planning the song";
    case "making": case "dit": case "music": case "generating": return "Making the music";
    case "mixing": case "vae": case "decoding": case "encoding": return "Mixing it down";
    case "loading": case "starting": return "Getting the music model ready";
    // ISOLATION-01: the Stack stops the music worker while a chat or voice request runs; the existing stage string says so.
    case "paused": return "Paused while chat is working";
    default: return "Making the song";
  }
}
/** MUSIC-GEN-17: the card shows the words the engine sang (its own `lrc`, squeezed lines left out), else the words sent. */
function cardLyricsOf(job: MusicJob): string | null {
  const words = job.request.lyrics ?? null;
  if (!job.lrc || !words || job.request.instrumental) return words;
  const sung = sungLyricsFromLrc(job.lrc, job.durationS);
  const timed = sungLyricsFromLrc(job.lrc, null, { keepSqueezed: true });
  return sung.length && sung.length < timed.length ? withoutLastLines(words, timed.length - sung.length) : words;
}
export function musicCardView(actor: PersonRow, input: Omit<MusicJob, "coverJobId" | "coverFileId"> & Partial<Pick<MusicJob, "coverJobId" | "coverFileId">>) {
  const root: MusicJob = { coverJobId: null, coverFileId: null, ...input };
  const versions = musicVersions(actor, root);
  const current = [...versions].sort((a, b) => (b.chosenAt ?? b.createdAt).localeCompare(a.chosenAt ?? a.createdAt) || b.id.localeCompare(a.id))[0];
  const shown = current ?? root;
  let covers: { id: string; url: string }[] = [];
  if (shown.coverFileId && shown.conversationId) {
    try { covers = listVersions(actor, shown.conversationId, shown.coverFileId).map(({ id, url }) => ({ id, url })); } catch { /* A deleted cover leaves the song playable. */ }
  }
  return {
    cover_url: covers.at(-1)?.url ?? null, cover_versions: covers,
    id: root.id, state: root.state, stage: root.stage, stage_label: musicStageLabel(root), progress: root.progress,
    cut: (current ?? root).request.cut ?? null, max_seconds: (current ?? root).request.max_seconds ?? null,
    eta_seconds: root.etaSeconds, position: root.position, error_line: root.errorLine,
    versions: versions.map((job, index) => ({ id: job.fileId!, label: `Version ${index + 1}`, url: musicFileUrl(job) })),
    current_id: current?.fileId ?? null, length: lengthOf((current ?? root).request, (current ?? root).durationS), title: current?.request.title ?? root.request.title ?? null,
    description: current?.request.description ?? root.request.description ?? null, started_at: Date.parse(root.createdAt),
    lyrics: cardLyricsOf(current ?? root), duration_s: current?.durationS ?? root.durationS,
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
musicRoutes.openapi(getRoute, (c) => {
  const actor = c.get("person"); const job = getMusicJobFor(actor, c.req.valid("param").id);
  if (!job) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  return c.json(musicCardView(actor, job), 200);
});
const coverRoute = createRoute({ method: "post", path: "/jobs/{id}/cover", tags: ["Music"], summary: "Make a new cover for the shown song", middleware,
  request: { params }, responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The song card." }, ...refusals } });
musicRoutes.openapi(coverRoute, async (c) => {
  const actor = c.get("person"); const root = getMusicJobFor(actor, c.req.valid("param").id);
  if (!root) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  const current = musicVersions(actor, root).sort((a, b) => (b.chosenAt ?? b.createdAt).localeCompare(a.chosenAt ?? a.createdAt) || b.id.localeCompare(a.id))[0] ?? root;
  await startSongCover(actor, current);
  return c.json(musicCardView(actor, getMusicJobFor(actor, root.id) ?? root), 200);
});
const cancelRoute = createRoute({ method: "delete", path: "/jobs/{id}", tags: ["Music"], summary: "Stop a song being made", middleware: viewMiddleware, request: { params },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The stopped card." }, ...refusals } });
musicRoutes.openapi(cancelRoute, async (c) => {
  const actor = c.get("person"); const job = await cancelMusicJob(actor, c.req.valid("param").id);
  if (!job) return c.json({ error: "That song isn't available any more. Ask for it again." }, 404) as never;
  return c.json(musicCardView(actor, job), 200);
});
const useRoute = createRoute({ method: "post", path: "/jobs/{id}/use", tags: ["Music"], summary: "Use a version for the next edit", middleware: viewMiddleware,
  request: { params, body: { content: { "application/json": { schema: z.object({ file_id: z.string().min(1).max(80) }) } } } },
  responses: { 200: { content: { "application/json": { schema: cardSchema } }, description: "The selected version." }, ...refusals } });
musicRoutes.openapi(useRoute, (c) => {
  const actor = c.get("person"); const root = getMusicJobFor(actor, c.req.valid("param").id);
  if (!root || !useMusicVersion(actor, root, c.req.valid("json").file_id)) return c.json({ error: "That version isn't available any more. Choose another version." }, 404) as never;
  return c.json(musicCardView(actor, root), 200);
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
  return c.json(musicCardView(actor, root), 200);
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
