import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, mediaItems, mediaSources, people, podcastSegmentLinks } from "@/db/schema";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { resetDb } from "../../../tests/reset-db";
import { newMediaItemId } from "@/lib/id";
import { BUILTIN_SEGMENT_POLICY, PODCAST_SEGMENT_KINDS, resolveSegmentPolicy } from "./podcastSegmentPolicy";
import { acceptPodcastSegments, correctPodcastSegment, podcastPlayerSkipBindings, podcastSkipAction, pollPodcastSegments, processPodcastCopy, skipPlanFor } from "./podcastSegments";
import type { PersonRow } from "@/types";
import type { MediaSegmentsRecord } from "@maipai/spec/media/ts/segments.js";

describe("podcast segment policy resolution", () => {
  test("resolves show, person, household and built-in layers including bumper worked example", () => {
    const resolve = (show?: "skip" | "mark" | "off" | "inherit") => resolveSegmentPolicy("bumper", { show, person: "off", household: "skip" });
    const cases: Array<[string, "skip" | "mark" | "off"]> = [
      ["show X overrides person", resolve("skip")], ["show Y inherit falls to person", resolve("inherit")],
      ["show unset falls to person", resolve()], ["household ad", resolveSegmentPolicy("ad", { household: "skip" })],
      ["sponsor built-in", resolveSegmentPolicy("sponsor", {})], ["selfpromo built-in", resolveSegmentPolicy("selfpromo", {})],
      ["intro built-in", resolveSegmentPolicy("intro", {})], ["outro built-in", resolveSegmentPolicy("outro", {})],
      ["recap built-in", resolveSegmentPolicy("recap", {})],
    ];
    const expected: Array<"skip" | "mark" | "off"> = ["skip", "off", "off", "skip", "skip", "off", "mark", "mark", "mark"];
    cases.forEach(([label, actual], index) => { expect(actual, label).toBe(expected[index]!); });
    expect(BUILTIN_SEGMENT_POLICY.bumper).toBe("skip");
    expect(PODCAST_SEGMENT_KINDS).toEqual(["ad", "sponsor", "bumper", "selfpromo", "intro", "outro", "recap"]);
  });
});

const record = (sha: string, pipelineVersion = "1"): MediaSegmentsRecord => ({
  fileSha256: sha, durationSec: 100, segments: [{ id: "seg-1", kind: "ad", startSec: 10, endSec: 20, confidence: 0.95, source: "llm", status: "auto" }],
  producedBy: { transcriptRevision: "rev-1", modelId: "fixture", pipelineVersion, createdAt: new Date().toISOString() }, cleanCopy: true,
  created_at: new Date().toISOString(), hlc: "1:0:fixture01", provenance: "stack:media.segments",
});
const stackJob = (id: string, state: "queued" | "running" | "done" | "failed", result: unknown = null) => ({ id, kind: "media.segments", role: null, state, percent: 0, completedBytes: 0, totalBytes: 0, status: state, position: null, input: {}, result, reason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
let adult: PersonRow;
let itemId: string;
let sha = "a".repeat(64);
let jobNo = 0;
let lastRequest: unknown;
let pollResult: ReturnType<typeof stackJob>;
let submitFailure = false;

beforeEach(async () => {
  resetDb();
  const now = new Date().toISOString();
  adult = db.insert(people).values({ id: "person-podseg-adult", displayName: "Owner", role: "owner", avatarSeed: "owner", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:fixture01" }).returning().get() as PersonRow;
  db.insert(people).values({ id: "person-podseg-child", displayName: "Child", role: "child", avatarSeed: "child", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:fixture02" }).run();
  sha = "a".repeat(64); itemId = newMediaItemId(); jobNo = 0; lastRequest = null; submitFailure = false;
  pollResult = stackJob("segments-1", "running");
  const sourceId = "podcast-source-test";
  db.insert(mediaSources).values({ id: sourceId, kind: "feed", scope: "household", ownerPersonId: adult.id, label: "Show X", url: "https://example.test/feed", auto: "{}", paused: false, visibleTo: '"household"', archive: "[]", prune: true, createdAt: new Date().toISOString(), hlc: "1:0:fixture01", provenance: "test" }).run();
  db.insert(mediaItems).values({ id: itemId, kind: "podcast_episode", title: "Episode", sourceId, locFileId: "podcast-file-test", mediaType: "audio/mpeg", playable: "original", chapters: "[]", subtitles: "[]", locatorKind: "file", bandOk: "adult", advisoryExplicit: false, advisorySource: "tag", hidden: false, addedAt: new Date().toISOString(), createdAt: new Date().toISOString(), hlc: "1:0:fixture01", provenance: "test" }).run();
  db.insert(attachments).values({ id: "podcast-file-test", ownerPersonId: adult.id, conversationId: null, turnId: null, mediaType: "audio/mpeg", size: 100, sha256: sha, storagePath: "podcast/file", retention: "kept", provenance: "podcast:manual", origin: "fetched", mediaSourceId: sourceId, deletedAt: null, trashUntil: null, name: null, createdAt: new Date().toISOString(), hlc: "1:0:fixture01" }).run();
  __setStackClientForTests({
    submitJob: async (request: unknown) => { lastRequest = request; jobNo++; if (submitFailure) throw new Error("offline"); return stackJob(`segments-${jobNo}`, "queued") as never; },
    job: async () => pollResult as never,
    correctMediaSegment: async (id: string, status: string) => { correctionCalls.push([id, status]); return { ok: true }; },
  } as never);
});
const correctionCalls: Array<[string, string]> = [];

describe("saved podcast segment lifecycle", () => {
  test("player bindings show marked ranges but expose only skip-mode time as saved", () => {
    const bindings = podcastPlayerSkipBindings({ state: "ready", ranges: [
      { id: "ad1", kind: "ad", startSec: 10, endSec: 70, status: "auto", mode: "skip" },
      { id: "sponsor1", kind: "sponsor", startSec: 100, endSec: 150, status: "auto", mode: "skip" },
      { id: "bumper1", kind: "bumper", startSec: 200, endSec: 230, status: "confirmed", mode: "skip" },
      { id: "intro1", kind: "intro", startSec: 0, endSec: 45, status: "auto", mode: "mark" },
    ] } as ReturnType<typeof skipPlanFor>);
    expect(bindings.ranges).toHaveLength(4);
    expect(bindings.ranges[3]).toMatchObject({ id: "intro1", start_sec: 0, end_sec: 45, status: "auto" });
    expect(bindings.bar.saved_label).toBe("2 minutes saved");
  });
  test("submits once per file SHA and pipeline version, polls and stores the result on the media item link", async () => {
    expect(await processPodcastCopy(itemId)).toMatchObject({ state: "queued", jobId: "segments-1" });
    expect(lastRequest).toMatchObject({ kind: "media.segments", input: { path: "podcast/file", kinds: PODCAST_SEGMENT_KINDS } });
    const showKey = (lastRequest as { input: { showKey: string } }).input.showKey;
    expect(showKey).not.toBe("podcast-source-test");
    expect(showKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(await processPodcastCopy(itemId)).toMatchObject({ state: "queued" });
    expect(jobNo).toBe(1);
    pollResult = stackJob("segments-1", "done", { record_id: "record-1", sha256: sha, record: record(sha) });
    expect(await pollPodcastSegments(itemId)).toBe("ready");
    expect(db.select().from(podcastSegmentLinks).where(eq(podcastSegmentLinks.mediaItemId, itemId)).get()).toMatchObject({ state: "ready", recordId: "record-1", sha256: sha, pipelineVersion: "1" });
  });
  test("Stack down and failed jobs retain a reason, preserve plain playback, and allow retry", async () => {
    submitFailure = true;
    expect(await processPodcastCopy(itemId)).toMatchObject({ state: "offline" });
    expect(skipPlanFor(itemId, adult)).toMatchObject({ state: "offline", ranges: [] });
    expect(db.select().from(podcastSegmentLinks).where(eq(podcastSegmentLinks.mediaItemId, itemId)).get()?.reason?.toLowerCase()).toContain("playback remains available");
    submitFailure = false;
    expect(await processPodcastCopy(itemId)).toMatchObject({ state: "queued" });
    pollResult = stackJob("segments-2", "failed");
    expect(await pollPodcastSegments(itemId)).toBe("offline");
    expect(await processPodcastCopy(itemId)).toMatchObject({ state: "queued", jobId: "segments-3" });
  });
  test("child receives a playback plan without review data; correction is sent to Stack", async () => {
    await processPodcastCopy(itemId);
    const accepted = acceptPodcastSegments(itemId, sha, "record-1", record(sha));
    expect(accepted.ok).toBe(true);
    const child = db.select().from(people).where(eq(people.id, "person-podseg-child")).get()! as PersonRow;
    const childPlan = skipPlanFor(itemId, child) as Record<string, unknown>;
    expect(childPlan.ranges).toEqual([{ id: "seg-1", kind: "ad", startSec: 10, endSec: 20, status: "auto", source: "llm", confidence: 0.95, mode: "skip" }]);
    expect(childPlan).not.toHaveProperty("record");
    correctionCalls.length = 0;
    await correctPodcastSegment(itemId, "record-1", "seg-1", true);
    expect(correctionCalls).toEqual([["seg-1", "rejected"]]);
  });
  test("skip actions answer with player instructions the page renderer applies; a child cannot review", async () => {
    await processPodcastCopy(itemId);
    acceptPodcastSegments(itemId, sha, "record-1", record(sha));
    const child = db.select().from(people).where(eq(people.id, "person-podseg-child")).get()! as PersonRow;
    const undo = await podcastSkipAction(child, { mediaId: itemId, actionId: "undo", id: "seg-1" }) as { player: Record<string, unknown> };
    expect(undo.player).toMatchObject({ seek_to_sec: 10, play_once_until_sec: 20, resume_after: true });
    const press = await podcastSkipAction(child, { mediaId: itemId, actionId: "skip_button", id: "seg-1" }) as { player: Record<string, unknown> };
    expect(press.player).toMatchObject({ seek_to_sec: 20, refresh: true });
    const hear = await podcastSkipAction(child, { mediaId: itemId, actionId: "hear_anyway", id: "seg-1" }) as { player: Record<string, unknown> };
    expect(hear.player).toMatchObject({ refresh: true });
    await expect(Promise.resolve().then(() => podcastSkipAction(child, { mediaId: itemId, actionId: "wrong", id: "seg-1" }))).rejects.toThrow();
    await expect(Promise.resolve().then(() => podcastSkipAction(child, { mediaId: itemId, actionId: "missed", startSec: 5 }))).rejects.toThrow();
  });
  test("a completed plan follows matching saved-copy SHA, never the publisher stream", async () => {
    await processPodcastCopy(itemId);
    expect(acceptPodcastSegments(itemId, sha, "record-1", record(sha)).ok).toBe(true);
    const secondId = newMediaItemId();
    db.insert(mediaItems).values({ id: secondId, kind: "podcast_episode", title: "Same bytes", sourceId: "podcast-source-test", locFileId: "podcast-file-copy-2", mediaType: "audio/mpeg", playable: "original", chapters: "[]", subtitles: "[]", locatorKind: "file", bandOk: "adult", advisoryExplicit: false, advisorySource: "tag", hidden: false, addedAt: new Date().toISOString(), createdAt: new Date().toISOString(), hlc: "1:0:fixture02", provenance: "test" }).run();
    db.insert(attachments).values({ id: "podcast-file-copy-2", ownerPersonId: adult.id, conversationId: null, turnId: null, mediaType: "audio/mpeg", size: 100, sha256: sha, storagePath: "podcast/identical", retention: "kept", provenance: "podcast:manual", origin: "fetched", mediaSourceId: "podcast-source-test", deletedAt: null, trashUntil: null, name: null, createdAt: new Date().toISOString(), hlc: "1:0:fixture02" }).run();
    expect(skipPlanFor(secondId, adult)).toMatchObject({ state: "ready", ranges: [{ startSec: 10, endSec: 20 }] });
    expect(await processPodcastCopy(secondId)).toMatchObject({ state: "ready" });
    expect(jobNo).toBe(1);
  });
  test("without a saved copy, Stack receives the episode URL and the plan remains unavailable to stream playback", async () => {
    db.update(mediaItems).set({ locFileId: null, locUrl: "https://publisher.example/episode.mp3" }).where(eq(mediaItems.id, itemId)).run();
    expect(await processPodcastCopy(itemId)).toMatchObject({ state: "queued" });
    expect(lastRequest).toMatchObject({ kind: "media.segments", input: { url: "https://publisher.example/episode.mp3" } });
    expect((lastRequest as { input: Record<string, unknown> }).input).not.toHaveProperty("path");
    expect(skipPlanFor(itemId, adult)).toMatchObject({ ranges: [] });
  });
});
