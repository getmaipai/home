import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MediaSegmentsSchema, skipPlan, type MediaSegmentsRecord, type MediaSegment } from "@maipai/spec/media/ts/segments.js";
import { db } from "@/db";
import { podcastSegmentLinks, podcastSegmentRecords, podcastShowKeys, attachments, mediaItems, mediaSources } from "@/db/schema";
import { getStackClient } from "@/lib/stackEngine";
import { getHouseholdSettingValue, getSettingValueForPerson } from "@/lib/settings";
import { mediaBandOf } from "@/lib/media/band";
import { isOwnerOrAdmin } from "@/lib/access";
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
  const ownLink = db.select().from(podcastSegmentLinks).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).get();
  const item = db.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).get();
  const file = item?.locFileId ? db.select().from(attachments).where(eq(attachments.id, item.locFileId)).get() : null;
  if (!item || item.kind !== "podcast_episode" || !file || file.origin !== "fetched") return { state: ownLink?.state ?? "not_processed", reason: ownLink?.reason ?? null, ranges: [] };
  const link = db.select().from(podcastSegmentRecords).where(and(eq(podcastSegmentRecords.sha256, file.sha256), eq(podcastSegmentRecords.pipelineVersion, PODCAST_SEGMENT_PIPELINE_VERSION))).get();
  if (!link || !link.record) return { state: link?.state ?? (ownLink?.sha256 === file.sha256 ? ownLink.state : "not_processed"), reason: link?.reason ?? (ownLink?.sha256 === file.sha256 ? ownLink.reason : null) ?? null, ranges: [] };
  // This plan applies only to bytes with this SHA. If the publisher stream differs from the
  // stored copy, the plan never applies to the live stream.
  let rawRecord: unknown;
  try { rawRecord = JSON.parse(link.record); } catch { return { state: "unavailable", reason: "The saved segment record could not be read. Reprocess this episode.", ranges: [] }; }
  const record = MediaSegmentsSchema.safeParse(rawRecord);
  if (!record.success) return { state: "unavailable", reason: "The Stack returned an invalid segment record. Reprocess this saved episode.", ranges: [] };
  const policies = resolvedPodcastPolicies(person, item.sourceId);
  const ranges = record.data.segments.map((segment) => ({ id: segment.id, kind: segment.kind, startSec: segment.startSec, endSec: segment.endSec, status: segment.status, source: segment.source, confidence: segment.confidence, mode: policies[segment.kind as PodcastSegmentKind] ?? "off" }));
  return { state: record.data.segments.length ? "ready" : "nothing_found", reason: null, recordId: link.recordId, sourceHash: file.sha256, modes: policies, ranges };
}

/** Enqueue analysis after a fetched copy commits. This is intentionally fire-and-forget for playback/save callers. */
export async function processPodcastCopy(mediaItemId: string, options: { idle?: boolean } = {}) {
  if (options.idle === false) return { state: "deferred" as const };
  const item = db.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).get();
  const file = item?.locFileId ? db.select().from(attachments).where(eq(attachments.id, item.locFileId)).get() : null;
  if (!item || item.kind !== "podcast_episode" || (file && (file.origin !== "fetched" || !file.provenance.startsWith("podcast:"))) || (!file && !item.locUrl)) return { state: "not_processed" as const };
  const source = db.select().from(mediaSources).where(eq(mediaSources.id, item.sourceId)).get();
  const disabled = getHouseholdSettingValue("podcasts.skip.enabled") === false || getHouseholdSettingValue("podcasts.skip.enabled") === "off" || PODCAST_SEGMENT_KINDS.every((kind) => {
    const raw = getHouseholdSettingValue(`podcasts.skip.${kind}.shows`);
    let show: SegmentPolicy | undefined;
    try { show = (JSON.parse(typeof raw === "string" ? raw : "{}") as Record<string, SegmentPolicy>)[item.sourceId]; } catch { show = undefined; }
    const policy = resolveSegmentPolicy(kind, { show, household: getHouseholdSettingValue(`podcasts.skip.${kind}.default`) as SegmentPolicy | undefined });
    return policy === "off";
  });
  if (!source || source.kind !== "feed" || source.paused || disabled) return { state: "not_processed" as const };
  const pendingSha = `pending:${mediaItemId}`;
  const prev = file ? db.select().from(podcastSegmentRecords).where(and(eq(podcastSegmentRecords.sha256, file.sha256), eq(podcastSegmentRecords.pipelineVersion, PODCAST_SEGMENT_PIPELINE_VERSION))).get() : null;
  if (prev && ["queued", "processing", "ready", "nothing_found"].includes(prev.state)) {
    const savedSha = file!.sha256;
    db.insert(podcastSegmentLinks).values({ mediaItemId, sha256: savedSha, pipelineVersion: PODCAST_SEGMENT_PIPELINE_VERSION, state: prev.state, recordId: prev.recordId, jobId: prev.jobId, record: prev.record, reason: prev.reason, updatedAt: prev.updatedAt }).onConflictDoUpdate({ target: podcastSegmentLinks.mediaItemId, set: { sha256: savedSha, pipelineVersion: PODCAST_SEGMENT_PIPELINE_VERSION, state: prev.state, recordId: prev.recordId, jobId: prev.jobId, record: prev.record, reason: prev.reason, updatedAt: prev.updatedAt } }).run();
    return { state: prev.state };
  }
  const stamp = new Date().toISOString();
  const jobSha = file?.sha256 ?? pendingSha;
  if (file) db.insert(podcastSegmentRecords).values({ sha256: file.sha256, pipelineVersion: PODCAST_SEGMENT_PIPELINE_VERSION, state: "processing", recordId: null, jobId: null, record: null, reason: null, updatedAt: stamp }).onConflictDoUpdate({ target: [podcastSegmentRecords.sha256, podcastSegmentRecords.pipelineVersion], set: { state: "processing", recordId: null, jobId: null, record: null, reason: null, updatedAt: stamp } }).run();
  db.insert(podcastSegmentLinks).values({ mediaItemId, sha256: jobSha, pipelineVersion: PODCAST_SEGMENT_PIPELINE_VERSION, state: "processing", recordId: null, jobId: null, record: null, reason: null, updatedAt: stamp }).onConflictDoUpdate({ target: podcastSegmentLinks.mediaItemId, set: { sha256: jobSha, pipelineVersion: PODCAST_SEGMENT_PIPELINE_VERSION, state: "processing", recordId: null, jobId: null, record: null, reason: null, updatedAt: stamp } }).run();
  try {
    let showKey = db.select().from(podcastShowKeys).where(eq(podcastShowKeys.sourceId, source.id)).get()?.showKey;
    if (!showKey) { showKey = randomUUID(); db.insert(podcastShowKeys).values({ sourceId: source.id, showKey }).onConflictDoNothing().run(); showKey = db.select().from(podcastShowKeys).where(eq(podcastShowKeys.sourceId, source.id)).get()!.showKey; }
    // When a Home copy exists, analyze those exact bytes by path. Otherwise Stack fetches the
    // episode URL itself; its analysis is reusable only if a later saved copy has the returned SHA.
    const job = await getStackClient().submitJob({ kind: "media.segments", input: { ...(file ? { path: file.storagePath } : { url: item.locUrl! }), showKey, kinds: [...PODCAST_SEGMENT_KINDS] } });
    const state = job.state === "done" ? "processing" : "queued";
    if (file) db.update(podcastSegmentRecords).set({ jobId: job.id, state, updatedAt: new Date().toISOString() }).where(and(eq(podcastSegmentRecords.sha256, file.sha256), eq(podcastSegmentRecords.pipelineVersion, PODCAST_SEGMENT_PIPELINE_VERSION))).run();
    db.update(podcastSegmentLinks).set({ jobId: job.id, state, updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
    return { state: job.state === "done" ? "processing" as const : "queued" as const, jobId: job.id };
  } catch {
    if (file) db.update(podcastSegmentRecords).set({ state: "offline", reason: "Stack is offline; playback remains available. Try again later.", updatedAt: new Date().toISOString() }).where(and(eq(podcastSegmentRecords.sha256, file.sha256), eq(podcastSegmentRecords.pipelineVersion, PODCAST_SEGMENT_PIPELINE_VERSION))).run();
    db.update(podcastSegmentLinks).set({ state: "offline", reason: "Stack is offline; playback remains available. Try again later.", updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
    return { state: "offline" as const };
  }
}

export function queuePodcastRows(sourceId: string) {
  return db.select({ item: mediaItems, link: podcastSegmentLinks }).from(mediaItems).leftJoin(podcastSegmentLinks, eq(podcastSegmentLinks.mediaItemId, mediaItems.id))
    .where(and(eq(mediaItems.sourceId, sourceId), eq(mediaItems.kind, "podcast_episode"), isNull(mediaItems.deletedAt)))
    .all().map(({ item, link }) => {
      const file = item.locFileId ? db.select().from(attachments).where(eq(attachments.id, item.locFileId)).get() : null;
      const shared = file ? db.select().from(podcastSegmentRecords).where(and(eq(podcastSegmentRecords.sha256, file.sha256), eq(podcastSegmentRecords.pipelineVersion, PODCAST_SEGMENT_PIPELINE_VERSION))).get() : null;
      const currentLink = file && link?.sha256 !== file.sha256 ? null : link;
      return { media_id: item.id, state: shared?.state ?? currentLink?.state ?? "not_processed", reason: shared?.reason ?? currentLink?.reason ?? null, job_id: shared?.jobId ?? currentLink?.jobId ?? null, sha256: file?.sha256 ?? (link?.sha256.startsWith("pending:") ? null : link?.sha256) ?? null, updated_at: shared?.updatedAt ?? currentLink?.updatedAt ?? null };
    });
}

export function cancelPodcastProcessing(mediaItemId: string) {
  const item = db.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).get();
  const link = db.select().from(podcastSegmentLinks).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).get();
  if (!item || !link || !["queued", "processing"].includes(link.state)) return false;
  if (link.jobId) void getStackClient().cancelJob(link.jobId).catch(() => undefined);
  db.update(podcastSegmentLinks).set({ state: "not_processed", jobId: null, recordId: null, record: null, reason: null, updatedAt: new Date().toISOString() }).where(and(eq(podcastSegmentLinks.sha256, link.sha256), eq(podcastSegmentLinks.pipelineVersion, link.pipelineVersion))).run();
  if (!link.sha256.startsWith("pending:")) db.update(podcastSegmentRecords).set({ state: "not_processed", jobId: null, recordId: null, record: null, reason: null, updatedAt: new Date().toISOString() }).where(and(eq(podcastSegmentRecords.sha256, link.sha256), eq(podcastSegmentRecords.pipelineVersion, link.pipelineVersion))).run();
  return true;
}

export async function backfillPodcastShow(person: PersonRow, sourceId: string) {
  if (!isOwnerOrAdmin(person) || mediaBandOf(person) !== "adult") throw new Error("Only an adult admin can backfill podcast episodes.");
  const source = db.select().from(mediaSources).where(and(eq(mediaSources.id, sourceId), eq(mediaSources.kind, "feed"), isNull(mediaSources.deletedAt))).get();
  if (!source || source.paused) throw new Error("Follow the show before processing its episodes.");
  const countValue = Number(getHouseholdSettingValue("podcasts.skip.backfill_latest") ?? 3);
  const count = Math.max(1, Math.min(20, Number.isInteger(countValue) ? countValue : 3));
  const published = (external: string | null, addedAt: string) => {
    try { return (external ? (JSON.parse(external) as { published_at?: string | null }).published_at : null) ?? addedAt; } catch { return addedAt; }
  };
  const ids = db.select({ id: mediaItems.id, addedAt: mediaItems.addedAt, external: mediaItems.external }).from(mediaItems).where(and(eq(mediaItems.sourceId, sourceId), eq(mediaItems.kind, "podcast_episode"), isNull(mediaItems.deletedAt))).all()
    .sort((a, b) => published(b.external, b.addedAt).localeCompare(published(a.external, a.addedAt))).slice(0, count).map((row) => row.id);
  void import("@/lib/media/podcasts").then(({ queuePodcastSegmentProcessing }) => queuePodcastSegmentProcessing(sourceId, ids)).catch(() => {});
  return { queued: ids.length };
}

export function acceptPodcastSegments(mediaItemId: string, sha256: string, recordId: string, value: unknown) {
  const parsed = MediaSegmentsSchema.safeParse(value);
  if (!parsed.success) return { ok: false as const, error: "The Stack returned an invalid segment record. Reprocess this saved episode." };
  if (parsed.data.fileSha256 !== sha256) return { ok: false as const, error: "The Stack returned segments for a different saved copy. Reprocess this episode." };
  const item = db.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).get();
  const file = item?.locFileId ? db.select().from(attachments).where(eq(attachments.id, item.locFileId)).get() : null;
  const row = db.select().from(podcastSegmentRecords).where(and(eq(podcastSegmentRecords.sha256, sha256), eq(podcastSegmentRecords.pipelineVersion, PODCAST_SEGMENT_PIPELINE_VERSION))).get();
  if (!item || file && file.sha256 !== sha256 || !row) return { ok: false as const, error: "The saved episode changed during analysis. Reprocess its current copy." };
  if (parsed.data.producedBy.pipelineVersion !== row.pipelineVersion) return { ok: false as const, error: "The Stack returned an outdated segment analysis. Reprocess this saved episode." };
  db.update(podcastSegmentLinks).set({ state: parsed.data.segments.length ? "ready" : "nothing_found", recordId, record: JSON.stringify(parsed.data), reason: null, updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
  db.update(podcastSegmentRecords).set({ state: parsed.data.segments.length ? "ready" : "nothing_found", recordId, record: JSON.stringify(parsed.data), reason: null, updatedAt: new Date().toISOString() }).where(and(eq(podcastSegmentRecords.sha256, sha256), eq(podcastSegmentRecords.pipelineVersion, row.pipelineVersion))).run();
  return { ok: true as const };
}

export async function pollPodcastSegments(mediaItemId: string) {
  const row = db.select().from(podcastSegmentLinks).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).get();
  if (!row?.jobId || !["queued", "processing"].includes(row.state)) return row?.state ?? "not_processed";
  try {
    const job = await getStackClient().job(row.jobId);
    if (job.state === "failed" || job.state === "cancelled") {
      db.update(podcastSegmentRecords).set({ state: "failed", reason: job.reason || "Stack segment analysis failed. Playback remains available; retry processing.", updatedAt: new Date().toISOString() }).where(and(eq(podcastSegmentRecords.sha256, row.sha256), eq(podcastSegmentRecords.pipelineVersion, row.pipelineVersion))).run();
      db.update(podcastSegmentLinks).set({ state: "failed", reason: job.reason || "Stack segment analysis failed. Playback remains available; retry processing.", updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
      return "offline";
    }
    if (job.state !== "done") return "processing";
    const result = job.result as ({ record_id?: string; recordId?: string; sha256?: string; record?: unknown; fileSha256?: string } & Record<string, unknown>) | null;
    const record = result?.record ?? result;
    const hash = result?.sha256 ?? result?.fileSha256 ?? (record && typeof record === "object" ? (record as { fileSha256?: string }).fileSha256 : undefined);
    const recordId = result?.record_id ?? result?.recordId ?? row.sha256;
    const version = record && typeof record === "object" ? (record as { producedBy?: { pipelineVersion?: string } }).producedBy?.pipelineVersion : undefined;
    if (version !== row.pipelineVersion || !result || typeof hash !== "string") {
      db.update(podcastSegmentRecords).set({ state: "failed", reason: "Stack returned a malformed or mismatched analysis record. Retry processing.", updatedAt: new Date().toISOString() }).where(and(eq(podcastSegmentRecords.sha256, row.sha256), eq(podcastSegmentRecords.pipelineVersion, row.pipelineVersion))).run();
      db.update(podcastSegmentLinks).set({ state: "failed", reason: "Stack returned a malformed or mismatched analysis record. Retry processing.", updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
      return "failed";
    }
    if (row.sha256.startsWith("pending:")) {
      const stamp = new Date().toISOString();
      db.insert(podcastSegmentRecords).values({ sha256: hash, pipelineVersion: row.pipelineVersion, state: "processing", recordId: null, jobId: row.jobId, record: null, reason: null, updatedAt: stamp }).onConflictDoNothing().run();
      db.update(podcastSegmentLinks).set({ sha256: hash, updatedAt: stamp }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
      db.delete(podcastSegmentRecords).where(and(eq(podcastSegmentRecords.sha256, row.sha256), eq(podcastSegmentRecords.pipelineVersion, row.pipelineVersion))).run();
    } else if (hash !== row.sha256) {
      db.update(podcastSegmentRecords).set({ state: "failed", reason: "Stack analyzed bytes that do not match the submitted saved copy. Retry processing.", updatedAt: new Date().toISOString() }).where(and(eq(podcastSegmentRecords.sha256, row.sha256), eq(podcastSegmentRecords.pipelineVersion, row.pipelineVersion))).run();
      db.update(podcastSegmentLinks).set({ state: "failed", reason: "Stack analyzed bytes that do not match the submitted saved copy. Retry processing.", updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
      return "failed";
    }
    const accepted = acceptPodcastSegments(mediaItemId, hash, recordId, record);
    if (accepted.ok) return db.select().from(podcastSegmentRecords).where(and(eq(podcastSegmentRecords.sha256, hash), eq(podcastSegmentRecords.pipelineVersion, row.pipelineVersion))).get()?.state ?? "failed";
    const reason = accepted.error;
    db.update(podcastSegmentRecords).set({ state: "failed", reason, updatedAt: new Date().toISOString() }).where(and(eq(podcastSegmentRecords.sha256, hash), eq(podcastSegmentRecords.pipelineVersion, row.pipelineVersion))).run();
    db.update(podcastSegmentLinks).set({ state: "failed", reason, updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
    return "failed";
  } catch {
    db.update(podcastSegmentRecords).set({ state: "offline", reason: "Stack is offline while checking segment analysis. Playback remains available; try again later.", updatedAt: new Date().toISOString() }).where(and(eq(podcastSegmentRecords.sha256, row.sha256), eq(podcastSegmentRecords.pipelineVersion, row.pipelineVersion))).run();
    db.update(podcastSegmentLinks).set({ state: "offline", reason: "Stack is offline while checking segment analysis. Playback remains available; try again later.", updatedAt: new Date().toISOString() }).where(eq(podcastSegmentLinks.mediaItemId, mediaItemId)).run();
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
