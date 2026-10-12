// KS-05: the feeds table's own CRUD. Every read crosses @maipai/spec's
// generated Feed validator (a row is always the spec shape) and every write
// stamps a fresh hlc, the same style as lib/projects/store.ts.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { feeds } from "@/db/schema";
import { newFeedId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import type { AgeBand } from "@/lib/ageBand";
import { Feed } from "@maipai/spec/gen/ts/feed.js";

export type FeedRow = typeof feeds.$inferSelect;
export type FeedRecord = Feed;

export const MIN_POLL_INTERVAL_S = 900;

function toRecord(row: FeedRow): FeedRecord | null {
  const parsed = Feed.safeParse({
    id: row.id,
    url: row.url,
    title: row.title,
    publisher: row.publisher,
    band: row.band,
    ...(row.packageId ? { package_id: row.packageId } : {}),
    ...(row.personId ? { person_id: row.personId } : {}),
    ...(row.etag ? { etag: row.etag } : {}),
    ...(row.lastModified ? { last_modified: row.lastModified } : {}),
    poll_interval_s: row.pollIntervalS,
    next_poll_at: row.nextPollAt,
    fail_count: row.failCount,
    ...(row.quietUntil ? { quiet_until: row.quietUntil } : {}),
    enabled: row.enabled,
    hlc: row.hlc,
    provenance: row.provenance,
  });
  return parsed.success ? parsed.data : null;
}

export function listFeeds(): FeedRecord[] {
  return db.select().from(feeds).all().map(toRecord).filter((feed): feed is FeedRecord => feed !== null);
}

export function getFeed(id: string): FeedRecord | null {
  const row = db.select().from(feeds).where(eq(feeds.id, id)).get();
  return row ? toRecord(row) : null;
}

export function findFeedByUrl(url: string): FeedRecord | null {
  const row = db.select().from(feeds).where(eq(feeds.url, url)).get();
  return row ? toRecord(row) : null;
}

export interface NewFeed {
  url: string;
  title: string;
  publisher: string;
  band: AgeBand;
  packageId?: string | null;
  pollIntervalS: number;
  provenance: string;
  nowIso: string;
}

export function createFeed(input: NewFeed): FeedRecord {
  const record = Feed.parse({
    id: newFeedId(),
    url: input.url,
    title: input.title,
    publisher: input.publisher,
    band: input.band,
    ...(input.packageId ? { package_id: input.packageId } : {}),
    poll_interval_s: Math.max(MIN_POLL_INTERVAL_S, Math.floor(input.pollIntervalS)),
    next_poll_at: input.nowIso,
    fail_count: 0,
    enabled: true,
    hlc: nextHlc(),
    provenance: input.provenance,
  });
  db.insert(feeds).values({
    id: record.id, url: record.url, title: record.title, publisher: record.publisher, band: record.band,
    packageId: record.package_id ?? null, personId: null, etag: null, lastModified: null,
    pollIntervalS: record.poll_interval_s, nextPollAt: record.next_poll_at, failCount: 0, quietUntil: null,
    enabled: true, hlc: record.hlc, provenance: record.provenance, createdAt: input.nowIso, updatedAt: input.nowIso,
  }).run();
  return record;
}

export interface FeedPatch {
  title?: string;
  publisher?: string;
  band?: AgeBand;
  enabled?: boolean;
  pollIntervalS?: number;
  etag?: string | null;
  lastModified?: string | null;
  nextPollAt?: string;
  failCount?: number;
  quietUntil?: string | null;
}

export function updateFeed(id: string, patch: FeedPatch, nowIso: string): void {
  const set: Partial<typeof feeds.$inferInsert> = { hlc: nextHlc(), updatedAt: nowIso };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.publisher !== undefined) set.publisher = patch.publisher;
  if (patch.band !== undefined) set.band = patch.band;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.pollIntervalS !== undefined) set.pollIntervalS = Math.max(MIN_POLL_INTERVAL_S, Math.floor(patch.pollIntervalS));
  if (patch.etag !== undefined) set.etag = patch.etag;
  if (patch.lastModified !== undefined) set.lastModified = patch.lastModified;
  if (patch.nextPollAt !== undefined) set.nextPollAt = patch.nextPollAt;
  if (patch.failCount !== undefined) set.failCount = patch.failCount;
  if (patch.quietUntil !== undefined) set.quietUntil = patch.quietUntil;
  db.update(feeds).set(set).where(eq(feeds.id, id)).run();
}

export function deleteFeed(id: string): void {
  db.delete(feeds).where(eq(feeds.id, id)).run();
}
