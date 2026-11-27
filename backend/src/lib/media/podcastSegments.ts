import { eq } from "drizzle-orm";
import { MediaSegmentsSchema, skipPlan, type MediaSegmentsRecord, type MediaSegment } from "@maipai/spec/media/ts/segments.js";
import { db } from "@/db";
import { podcastSegmentLinks, attachments, mediaItems } from "@/db/schema";
import { getStackClient } from "@/lib/stackEngine";
import { getHouseholdSettingValue, getSettingValueForPerson } from "@/lib/settings";
import type { PersonRow } from "@/types";
import { BUILTIN_SEGMENT_POLICY, PODCAST_SEGMENT_KINDS, resolveSegmentPolicy, type PodcastSegmentKind, type SegmentPolicy, PODCAST_SEGMENT_PIPELINE_VERSION } from "./podcastSegmentPolicy";
export { BUILTIN_SEGMENT_POLICY, PODCAST_SEGMENT_KINDS, resolveSegmentPolicy } from "./podcastSegmentPolicy";
export type { PodcastSegmentKind, SegmentPolicy } from "./podcastSegmentPolicy";

export function resolvedPodcastPolicies(person: PersonRow, showId: string) {
  return Object.fromEntries(PODCAST_SEGMENT_KINDS.map((kind) => {
    const key = `podcasts.skip.${kind}`;
    const raw = getHouseholdSettingValue(`${key}.shows`);
    let show: SegmentPolicy | undefined;
    try { show = (JSON.parse(typeof raw === "string" ? raw : "{}") as Record<string, SegmentPolicy>)[showId]; } catch { show = undefined; }
    return [kind, resolveSegmentPolicy(kind, { show, person: getSettingValueForPerson(person.id, key) as SegmentPolicy | undefined, household: getHouseholdSettingValue(`${key}.default`) as SegmentPolicy | undefined })];
  })) as Record<PodcastSegmentKind, Exclude<SegmentPolicy, "inherit">>;
}

export function skipPlanFor(mediaItemId: string, person: PersonRow) {
  const link = db.select().from(podcastSegmentLinks).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).get();
  const item = db.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).get();
  const file = item?.locFileId ? db.select().from(attachments).where(eq(attachments.id, item.locFileId)).get() : null;
  if (!item || item.kind !== "podcast_episode" || !file || file.origin !== "fetched" || !link || link.sha256 !== file.sha256 || !link.record) return { state: link?.state ?? "not_processed", reason: link?.reason ?? null, ranges: [] };
  let rawRecord: unknown;
  try { rawRecord = JSON.parse(link.record); } catch { return { state: "unavailable", reason: "The saved segment record could not be read. Reprocess this episode.", ranges: [] }; }
  const record = MediaSegmentsSchema.safeParse(rawRecord);
  if (!record.success) return { state: "unavailable", reason: "The Stack returned an invalid segment record. Reprocess this saved episode.", ranges: [] };
  const policies = resolvedPodcastPolicies(person, item.sourceId);
  const kinds = PODCAST_SEGMENT_KINDS.filter((kind) => policies[kind] === "skip") as MediaSegment["kind"][];
  return { state: record.data.segments.length ? "ready" : "nothing_found", reason: null, ranges: skipPlan(record.data, { kinds, bumpersWithAds: policies.bumper === "skip" && getHouseholdSettingValue("podcasts.skip.bumpers_with_ads") !== false }) };
}

/** Enqueue analysis after a fetched copy commits. This is intentionally fire-and-forget for playback/save callers. */
export async function processPodcastCopy(mediaItemId: string, options: { idle?: boolean } = {}) {
  if (options.idle === false) return { state: "deferred" as const };
  const item = db.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).get();
  const file = item?.locFileId ? db.select().from(attachments).where(eq(attachments.id, item.locFileId)).get() : null;
  if (!item || item.kind !== "podcast_episode" || !file || file.origin !== "fetched" || !file.provenance.startsWith("podcast:")) return { state: "not_processed" as const };
  const prev = db.select().from(podcastSegmentLinks).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).get();
  if (prev?.sha256 === file.sha256 && prev.pipelineVersion === PODCAST_SEGMENT_PIPELINE_VERSION && ["queued", "processing", "ready", "nothing_found"].includes(prev.state)) return { state: prev.state };
  db.insert(podcastSegmentLinks).values({ mediaItemId, sha256: file.sha256, pipelineVersion: PODCAST_SEGMENT_PIPELINE_VERSION, state: "processing", recordId: null, jobId: null, record: null, reason: null, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: podcastSegmentLinks.mediaItemId, set: { sha256: file.sha256, pipelineVersion: PODCAST_SEGMENT_PIPELINE_VERSION, state: "processing", recordId: null, jobId: null, record: null, reason: null, updatedAt: new Date().toISOString() } }).run();
  try {
    const job = await getStackClient().submitJob({ kind: "media.segments", input: { path: file.storagePath, showKey: item.sourceId, kinds: [...PODCAST_SEGMENT_KINDS] } });
    db.update(podcastSegmentLinks).set({ jobId: job.id, state: job.state === "done" ? "processing" : "queued", updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
    return { state: job.state === "done" ? "processing" as const : "queued" as const, jobId: job.id };
  } catch {
    db.update(podcastSegmentLinks).set({ state: "offline", reason: "Stack could not start segment analysis. Playback remains available; try again later.", updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
    return { state: "offline" as const };
  }
}

export function acceptPodcastSegments(mediaItemId: string, sha256: string, recordId: string, value: unknown) {
  const parsed = MediaSegmentsSchema.safeParse(value);
  if (!parsed.success) return { ok: false as const, error: "The Stack returned an invalid segment record. Reprocess this saved episode." };
  if (parsed.data.fileSha256 !== sha256) return { ok: false as const, error: "The Stack returned segments for a different saved copy. Reprocess this episode." };
  const row = db.select().from(podcastSegmentLinks).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).get();
  if (!row || row.sha256 !== sha256) return { ok: false as const, error: "The saved episode changed during analysis. Reprocess its current copy." };
  if (parsed.data.producedBy.pipelineVersion !== row.pipelineVersion) return { ok: false as const, error: "The Stack returned an outdated segment analysis. Reprocess this saved episode." };
  db.update(podcastSegmentLinks).set({ state: parsed.data.segments.length ? "ready" : "nothing_found", recordId, record: JSON.stringify(parsed.data), reason: null, updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
  return { ok: true as const };
}

export async function pollPodcastSegments(mediaItemId: string) {
  const row = db.select().from(podcastSegmentLinks).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).get();
  if (!row?.jobId || !["queued", "processing"].includes(row.state)) return row?.state ?? "not_processed";
  try {
    const job = await getStackClient().job(row.jobId);
    if (job.state === "failed" || job.state === "cancelled") {
      db.update(podcastSegmentLinks).set({ state: "offline", reason: "Stack segment analysis failed. Playback remains available; try again later.", updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
      return "offline";
    }
    if (job.state !== "done") return "processing";
    const result = job.result as ({ record_id?: string; recordId?: string; sha256?: string; record?: unknown; fileSha256?: string } & Record<string, unknown>) | null;
    const record = result?.record ?? result;
    const hash = result?.sha256 ?? result?.fileSha256 ?? (record && typeof record === "object" ? (record as { fileSha256?: string }).fileSha256 : undefined);
    const recordId = result?.record_id ?? result?.recordId ?? row.sha256;
    const version = record && typeof record === "object" ? (record as { producedBy?: { pipelineVersion?: string } }).producedBy?.pipelineVersion : undefined;
    if (version !== row.pipelineVersion) return "processing";
    if (!result || hash !== row.sha256) return "processing";
    const accepted = acceptPodcastSegments(mediaItemId, hash, recordId, record);
    return accepted.ok ? "ready" : "offline";
  } catch {
    db.update(podcastSegmentLinks).set({ state: "offline", reason: "Stack is unavailable while checking segment analysis. Playback remains available; try again later.", updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
    return "offline";
  }
}

export async function correctPodcastSegment(mediaItemId: string, recordId: string, segmentId: string, rejected: boolean) {
  // Stack remains authoritative for segment truth; a correction is never rewritten locally.
  const link = db.select().from(podcastSegmentLinks).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).get();
  if (!link || link.recordId !== recordId || !link.record) throw new Error("That segment is not part of this saved episode. Refresh the episode and try again.");
  const parsed = MediaSegmentsSchema.safeParse(JSON.parse(link.record));
  if (!parsed.success || !parsed.data.segments.some((segment) => segment.id === segmentId)) throw new Error("That segment is not part of this saved episode. Refresh the episode and try again.");
  const correct = getStackClient().correctMediaSegment;
  if (!correct) throw new Error("This Stack version cannot accept segment corrections. Update Stack and try again.");
  return correct(segmentId, rejected ? "rejected" : "confirmed");
}

export type { MediaSegmentsRecord, MediaSegment };
