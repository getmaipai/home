// MP-10: GET /api/music/jobs/{id}/files/{fileId}/peaks, the Studio's waveform made on the hub (see lib/music/peaks.ts). It follows the audio route's rules exactly:
// view gate, the owner's own file only, a locked (Adult lock) song is hidden as "not available", nothing is logged by title or lyric. A hub with no ffmpeg answers 503
// with a plain line, and the Studio then falls back to drawing the waveform in the browser.
import { createRoute, z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { speakerAgeBand } from "@/lib/ageBand";
import { musicViewDenial, MUSIC_DENIAL_LINE } from "@/lib/music/policy";
import { musicJobLockState } from "@/lib/music/lock";
import { getMusicJobFor, musicVersions, openMusicFile, readMusicFile } from "@/lib/music/jobs";
import { cachedPeaks, computePeaks, savePeaks, PEAKS_FAILED_LINE, PEAKS_NO_FFMPEG_LINE } from "@/lib/music/peaks";
import type { AppEnv } from "@/types";

export const musicPeaksRoutes = apiRouter();
const viewGate = createMiddleware<AppEnv>(async (c, next) => {
  const denial = musicViewDenial({ actor: c.get("person"), band: speakerAgeBand(c.get("person"), new Date()), surface: "chat", surfaceClass: "written", spoken: false });
  if (denial) return c.json({ error: MUSIC_DENIAL_LINE[denial], code: denial }, 403);
  await next();
});
const NO_STORE = { "cache-control": "private, no-store" };
const refusals = errorResponses({ 401: "Not signed in", 403: "Music is off for this profile", 404: "No such song" });
const route = createRoute({ method: "get", path: "/jobs/{id}/files/{fileId}/peaks", tags: ["Music"], summary: "About 600 waveform peaks (0 to 1) for one song file", middleware: [requireAuth, viewGate] as [typeof requireAuth, typeof viewGate],
  request: { params: z.object({ id: z.string().min(1).max(80), fileId: z.string().min(1).max(80) }) },
  responses: { 200: { content: { "application/json": { schema: z.object({ peaks: z.array(z.number()), duration: z.number() }) } }, description: "Peaks and the length in seconds." }, ...refusals, ...errorResponses({ 503: "No audio tool on this computer" }) } });
const GONE = { error: "That song isn't available any more. Ask for it again." };
const inflight = new Map<string, Promise<unknown>>();
musicPeaksRoutes.openapi(route, async (c) => {
  const actor = c.get("person"); const { id, fileId } = c.req.valid("param"); const root = getMusicJobFor(actor, id);
  if (root && musicJobLockState(root, actor) !== "open") return c.json(GONE, 404, NO_STORE) as never;
  const version = root ? musicVersions(actor, root).find((j) => j.fileId === fileId) : null;
  const handle = version ? openMusicFile(actor, version, fileId) : null;
  if (!handle || !version) return c.json(GONE, 404, NO_STORE) as never;
  // The file's hash keys the cache: the stored row has it, so a hit reads no audio at all.
  const row = db.select({ sha256: attachments.sha256 }).from(attachments).where(and(eq(attachments.id, fileId), eq(attachments.ownerPersonId, actor.id))).get();
  const sha = row?.sha256 ?? readMusicFile(actor, version, fileId)?.sha256;
  if (!sha) return c.json(GONE, 404, NO_STORE) as never;
  const hit = cachedPeaks(fileId, sha);
  if (hit) return c.json(hit, 200, NO_STORE) as never;
  try {
    const key = `${fileId}:${sha}`;
    const work = inflight.get(key) ?? computePeaks(handle.read(0, handle.size)).then((made) => { savePeaks(fileId, sha, made); return made; }).finally(() => inflight.delete(key));
    inflight.set(key, work);
    const made = await work as { peaks: number[]; duration: number };
    if (musicJobLockState(root!, actor) !== "open") return c.json(GONE, 404, NO_STORE) as never; // locked while it was being made
    return c.json(made, 200, NO_STORE) as never;
  } catch (error) {
    return c.json({ error: error instanceof Error && error.message === "peaks_unavailable" ? PEAKS_NO_FFMPEG_LINE : PEAKS_FAILED_LINE }, 503, NO_STORE) as never;
  }
});
