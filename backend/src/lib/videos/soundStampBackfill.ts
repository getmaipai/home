// CLIP-AUDIENCE-LOCK-01: the one-time fix of the clips the old stamp raised. From 2026-11-17 (AGE-ROUTING-REMOVE-01) every clip a person's request made with sound was saved adult-only
// merely because its sound was unchecked. The owner ruled (2026-11-20) that was wrong. This lowers exactly those clips and nothing else, through the existing audience-change path
// (the file's own provenance, then `syncCreationMarkForFile`, which restamps the rating): a clip the Stack made (`video-gen`, not an edit) whose job saved `audio: true`,
// `request.adultOnly === false` and `request.adultLock === "off"`, whose file is adult-only with its lock off. Anything it cannot prove (the job row gone, a field missing, a lock
// on, a clip locked since) stays as it is. A durable marker makes it run once; a person who locks a clip afterwards is never undone by a later run. Logs carry a count only.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, settingsValues, videoJobs } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { appendLogLine } from "@/lib/log";
import { syncCreationMarkForFile } from "@/lib/creations/store";
import type { VideoFile, VideoRequest } from "./jobs";

const MARKER_KEY = "__migration.clip_audience_lock_01";

function lowerFile(fileId: string): boolean {
  const row = db.select().from(attachments).where(and(eq(attachments.id, fileId), isNull(attachments.deletedAt))).get();
  if (!row) return false;
  const colon = row.provenance.indexOf(":");
  if (colon < 0) return false;
  let meta: Record<string, unknown>;
  try { meta = JSON.parse(row.provenance.slice(colon + 1)) as Record<string, unknown>; } catch { return false; }
  // Only the audience the old stamp wrote, with the lock off: a lock (a person's or the frame verdict's) is never touched.
  if (meta.audience !== "adult-only" || meta.lock !== "off") return false;
  const next = { ...meta, audience: "all-ages", ...(meta.made_audience === "adult-only" ? { made_audience: "all-ages" } : {}) };
  const provenance = row.provenance.slice(0, colon + 1) + JSON.stringify(next);
  const changed = db.update(attachments).set({ provenance, hlc: nextHlc() }).where(and(eq(attachments.id, fileId), eq(attachments.provenance, row.provenance), isNull(attachments.deletedAt))).returning({ id: attachments.id }).all().length === 1;
  if (changed) syncCreationMarkForFile(fileId);
  return changed;
}

/** Runs once per household data folder (a durable marker). Returns how many clips (jobs) it lowered. */
export function backfillSoundOnlyClips(): { ran: boolean; lowered: number } {
  const marker = db.select({ key: settingsValues.key }).from(settingsValues).where(and(eq(settingsValues.scope, "system"), eq(settingsValues.key, MARKER_KEY))).get();
  if (marker) return { ran: false, lowered: 0 };
  let lowered = 0;
  for (const job of db.select().from(videoJobs).where(eq(videoJobs.state, "done")).all()) {
    let request: VideoRequest & { edit?: unknown }; let files: VideoFile[];
    try { request = JSON.parse(job.request) as VideoRequest & { edit?: unknown }; files = JSON.parse(job.files) as VideoFile[]; } catch { continue; }
    const first = files[0];
    // Proved only when the job itself says: made by the generator (not an edit), with sound, not adult by words, style or source, and not locked.
    if (!first || request.edit || first.audio !== true || request.adultOnly !== false || request.adultLock !== "off") continue;
    let any = false;
    for (const id of new Set(files.flatMap((file) => [file.id, file.poster_id]))) if (lowerFile(id)) any = true;
    if (any) lowered++;
  }
  const now = new Date().toISOString();
  db.insert(settingsValues).values({ scope: "system", key: MARKER_KEY, value: "true", hlc: nextHlc(), source: "migration", setBy: null, updatedAt: now }).run();
  appendLogLine(JSON.stringify({ event: "clip-audience-lock.backfill", lowered }));
  return { ran: true, lowered };
}
