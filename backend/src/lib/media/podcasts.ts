// MEDIA-PODCASTS-01 (design note sections 4 Podcasts, 8, 9, 12): podcasts are `feed` records with `purpose: "podcast"`, read by the ONE
// shelf poller (conditional GET, one request per host, backoff, the SSRF guard: lib/shelf/shelfPoller.ts). The poller hands a podcast
// feed's body to `ingestPodcastFeed`, which turns the episodes into `media-item` rows (kind podcast_episode, stream-only `{url}` until
// saved) under a `media-source` of kind `feed`. Nothing here opens its own connection: the enclosure download for Save and the show's
// picture go through the poller's `guardedGet`, so the guard, the pacing and the honest user agent are the same.
import { and, eq, isNull } from "drizzle-orm";
import { generateOpml, parseFeed, parseOpml } from "feedsmith";
import { db } from "@/db";
import { syncFileReferences } from "@/lib/fileContent";
import { attachments, mediaItems, mediaProgress, mediaSources, people, podcastTranscripts } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newMediaItemId, newMediaSourceId } from "@/lib/id";
import { checkFeedAddress } from "@/lib/shelf/feedAddresses";
import { createFeed, deleteFeed, findFeedByUrl, getFeed, listFeeds, MIN_POLL_INTERVAL_S, type FeedRecord } from "@/lib/shelf/feedStore";
import { guardedGet, pollFeed, RateLimited, RedirectLimitError, readBytesLimited, type PollDeps } from "@/lib/shelf/shelfPoller";
import { SsrfBlockedError } from "@maipai/core/src/ssrfGuard";
import { getStackClient } from "@/lib/stackEngine";
import type { StackJob } from "@maipai/spec/stack/ts/stack-job.js";
import type { PersonRow } from "@/types";
import { isMediaAdmin, liveSourceById, readableItem } from "./access";
import { bandOkAtIngest, mediaBandOf } from "./band";
import { createFetchedFile, createFetchedFileFromResponse, removeFetchedFile } from "./fetchedFiles";
import { mediaTypeOfExtension } from "./kinds";
import { itemFromRow, itemToRow, MediaItem, sourceFromRow, type MediaItemRow, type MediaSource } from "./model";
import { checkStorageCap } from "@/lib/storage/usage";
import { mayManagePodcastCopy, trashPodcastCopy } from "@/lib/trash/podcastCopies";
import { trackBackgroundWork } from "@/lib/backgroundWork";
import { reportShelfEvent } from "@/lib/shelf/shelfEvents";
import { archivePath, removeSource } from "./sources";

const MAX_EPISODES_PER_FEED = 200;
const MAX_ENCLOSURE_BYTES = 400 * 1024 * 1024;
const MAX_ART_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const ENCLOSURE_RATE = { prefix: "enclosure", capacity: 5, refillPerSecond: 1 / 10 } as const;
const TRANSCRIPT_RATE = { prefix: "podcast-transcript", capacity: 5, refillPerSecond: 1 / 10 } as const;
const ART_RATE = { prefix: "art", capacity: 5, refillPerSecond: 1 / 10 } as const;

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 409 | 422 | 502; error: string };

// ---- what a route-triggered poll or save uses -------------------------------------------------------------------------------------

let routeDeps: PollDeps = {};
/** Tests point the route-triggered poll, Save and the art fetch at a localhost fixture; production uses the real guarded fetch. */
export function __setPodcastFetchDepsForTests(deps: PollDeps): void { routeDeps = deps; }
export const podcastFetchDeps = (): PollDeps => routeDeps;

// ---- parsing ----------------------------------------------------------------------------------------------------------------------

export interface ParsedEpisode {
  guid: string;
  title: string;
  description: string;
  link: string | null;
  enclosureUrl: string;
  mediaType: string;
  size: number | null;
  durationS: number | null;
  publishedAt: string | null;
  /** True or false when the episode says; null when it does not (the show's flag applies). */
  explicit: boolean | null;
  season: number | null;
  episode: number | null;
  chapters: Array<{ start_s: number; title: string; source: "embedded" | "description" }>;
  transcriptUrl: string | null;
  transcriptType: string | null;
}

export interface ParsedShow {
  title: string;
  author: string | null;
  description: string;
  imageUrl: string | null;
  explicit: boolean;
  episodes: ParsedEpisode[];
}

type Json = Record<string, any>;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: "...", ndash: "-" };

/** Show notes as plain lines: block tags become line breaks, the rest of the markup is dropped, entities are decoded. */
export function plainNotes(html: string, max = 4000): string {
  const text = html
    .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6])\s*\/?>/gi, "\n").replace(/<\s*li[^>]*>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1]!.toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ");
  const lines = text.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim());
  const joined = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return joined.length > max ? `${joined.slice(0, max - 1).trimEnd()}…` : joined;
}

/** `0:00 Intro` lines of the show notes as chapters (only a list of three or more that starts near zero and climbs). */
export function chaptersFromNotes(notes: string): ParsedEpisode["chapters"] {
  const found: ParsedEpisode["chapters"] = [];
  for (const line of notes.split("\n")) {
    const match = /^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-:.]?\s*(.{2,120})$/.exec(line);
    if (!match) continue;
    const parts = match[1]!.split(":").map(Number);
    const start = parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + parts[1]!;
    found.push({ start_s: start, title: match[2]!.trim(), source: "description" });
  }
  const ordered = found.every((chapter, index) => index === 0 || chapter.start_s > found[index - 1]!.start_s);
  return found.length >= 3 && ordered && found[0]!.start_s <= 5 ? found : [];
}

function seconds(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parts = value.trim().split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part) || part < 0) || parts.length > 3) return null;
    return Math.round(parts.reduce((total, part) => total * 60 + part, 0));
  }
  return null;
}

function explicitOf(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(yes|true|explicit)$/i.test(value.trim())) return true;
    if (/^(no|false|clean)$/i.test(value.trim())) return false;
  }
  return null;
}

const text = (value: unknown): string => (typeof value === "string" ? value : value && typeof value === "object" && typeof (value as Json).value === "string" ? (value as Json).value : "");
const whole = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : typeof value === "string" && /^\d{1,5}$/.test(value.trim()) ? Number(value) : null);

function isoOf(value: unknown, nowMs: number): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const at = new Date(value).getTime();
  return Number.isNaN(at) || at > nowMs + 86_400_000 ? null : new Date(at).toISOString();
}

function episodeOf(raw: Json, nowMs: number, showExplicit: boolean): ParsedEpisode | null {
  const enclosure = (raw.enclosures as Json[] | undefined)?.find((candidate) => typeof candidate.url === "string") ?? null;
  const enclosureUrl = enclosure ? String(enclosure.url).trim() : "";
  const title = plainNotes(text(raw.title), 300).replace(/\n/g, " ");
  if (!enclosureUrl || !title || !/^https?:\/\//i.test(enclosureUrl)) return null;
  const guid = (text(raw.guid) || enclosureUrl).trim();
  const notes = plainNotes(text(raw.description) || text(raw.content?.encoded) || text(raw.itunes?.summary));
  const typeHeader = typeof enclosure?.type === "string" ? enclosure.type.split(";")[0]!.trim().toLowerCase() : "";
  const ext = /\.([a-z0-9]{2,5})(?:$|\?)/i.exec(new URL(enclosureUrl).pathname + "?")?.[1]?.toLowerCase() ?? "";
  const mediaType = /^(audio|video)\/[a-z0-9.+-]+$/.test(typeHeader) ? typeHeader : mediaTypeOfExtension(ext).startsWith("audio/") || mediaTypeOfExtension(ext).startsWith("video/") ? mediaTypeOfExtension(ext) : "audio/mpeg";
  const inline = ((raw.psc?.chapters as Json[] | undefined) ?? []).map((chapter) => ({ start_s: seconds(chapter.start) ?? -1, title: plainNotes(text(chapter.title), 120), source: "embedded" as const })).filter((chapter) => chapter.start_s >= 0 && chapter.title);
  return {
    guid, title, description: notes, link: typeof raw.link === "string" && /^https?:\/\//i.test(raw.link) ? raw.link : null, enclosureUrl, mediaType,
    size: typeof enclosure?.length === "number" && enclosure.length > 0 ? Math.round(enclosure.length) : null, durationS: seconds(raw.itunes?.duration),
    publishedAt: isoOf(raw.pubDate ?? raw.published ?? raw.dc?.date, nowMs), explicit: explicitOf(raw.itunes?.explicit) ?? (showExplicit ? true : null),
    season: whole(raw.itunes?.season), episode: whole(raw.itunes?.episode), chapters: inline.length > 0 ? inline : chaptersFromNotes(notes),
    transcriptUrl: (raw.podcast?.transcripts as Json[] | undefined)?.map((t) => typeof t.url === "string" && /^https:\/\//i.test(t.url) ? t.url : null).find(Boolean) ?? null,
    transcriptType: (raw.podcast?.transcripts as Json[] | undefined)?.find((t) => typeof t.url === "string" && /^https:\/\//i.test(t.url))?.type ?? null,
  };
}

/** A podcast feed's show and episodes, newest first. Throws when the body is not a feed. */
export function parsePodcastFeed(body: string, nowMs: number): ParsedShow {
  const parsed = parseFeed(body) as { format: string; feed: Json };
  const feed = parsed.feed;
  let rawItems: Json[] = [];
  if (parsed.format === "rss" || parsed.format === "rdf") rawItems = (feed.items ?? []) as Json[];
  else if (parsed.format === "atom") {
    rawItems = ((feed.entries ?? []) as Json[]).map((entry) => {
      const links = (entry.links ?? []) as Json[];
      return { ...entry, enclosures: links.filter((link) => link.rel === "enclosure").map((link) => ({ url: link.href, type: link.type, length: link.length })), link: links.find((link) => link.rel === "alternate")?.href, pubDate: entry.published ?? entry.updated, description: text(entry.summary) || text(entry.content) };
    });
  } else if (parsed.format === "json") {
    rawItems = ((feed.items ?? []) as Json[]).map((item) => ({ ...item, enclosures: ((item.attachments ?? []) as Json[]).map((a) => ({ url: a.url, type: a.mime_type, length: a.size_in_bytes })), guid: item.id, link: item.url, pubDate: item.date_published, description: text(item.content_html) || text(item.content_text), itunes: { duration: (item.attachments as Json[] | undefined)?.[0]?.duration_in_seconds } }));
  }
  const showExplicit = explicitOf(feed.itunes?.explicit) === true;
  const episodes = rawItems.map((item) => episodeOf(item, nowMs, showExplicit)).filter((episode): episode is ParsedEpisode => episode !== null);
  episodes.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  const image = typeof feed.itunes?.image === "string" ? feed.itunes.image : typeof feed.image?.url === "string" ? feed.image.url : typeof feed.icon === "string" ? feed.icon : null;
  return {
    title: plainNotes(text(feed.title), 200).replace(/\n/g, " ") || "Podcast", author: typeof feed.itunes?.author === "string" ? feed.itunes.author : typeof feed.author?.name === "string" ? feed.author.name : null,
    description: plainNotes(text(feed.description) || text(feed.itunes?.summary), 600), imageUrl: image && /^https:\/\//i.test(image) ? image : null, explicit: showExplicit, episodes: episodes.slice(0, MAX_EPISODES_PER_FEED),
  };
}

// ---- sources ----------------------------------------------------------------------------------------------------------------------

export function sourceRowForFeed(feedId: string): typeof mediaSources.$inferSelect | undefined {
  return db.select().from(mediaSources).where(and(eq(mediaSources.feedId, feedId), eq(mediaSources.kind, "feed"), isNull(mediaSources.deletedAt))).get();
}

/** Used by the poller: a podcast feed is polled while it has a live, unpaused source (the news shelf's tick-boxes do not apply). */
export function podcastFeedIsWanted(feed: FeedRecord): boolean {
  if (!feed.enabled) return false;
  const row = sourceRowForFeed(feed.id);
  return !!row && !row.paused;
}

export function podcastPollIntervalS(feed: FeedRecord): number | null {
  const row = sourceRowForFeed(feed.id);
  return row ? Math.max(MIN_POLL_INTERVAL_S, row.pollMinutes * 60) : null;
}

export interface SubscribeInput {
  url: string;
  visibleTo?: "household" | string[];
  pollMinutes?: number;
}

/** The hosts of the podcast feeds (the privacy page: each feed host is contacted with a conditional GET and no identity). */
export function podcastFeedHosts(): string[] {
  const hosts = new Set<string>();
  for (const feed of listFeeds("podcast")) if (podcastFeedIsWanted(feed)) hosts.add(new URL(feed.url).hostname.toLowerCase());
  return [...hosts].sort();
}

/** An admin follows a show: a feed record (purpose podcast) and a media source pointing at it. The first poll is queued at once. */
export function subscribePodcast(actor: PersonRow, input: SubscribeInput, nowIso = new Date().toISOString()): Outcome<{ source: MediaSource; feed: FeedRecord }> {
  if (!isMediaAdmin(actor) || mediaBandOf(actor) !== "adult") return { ok: false, status: 403, error: "Only an adult admin can add a show. Ask the person who runs this home." };
  const checked = checkFeedAddress(input.url.trim());
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  let feed = findFeedByUrl(checked.url);
  if (feed && feed.purpose !== "podcast") return { ok: false, status: 409, error: "That address is already one of the news feeds. A podcast feed needs its own address." };
  if (feed && sourceRowForFeed(feed.id)) return { ok: false, status: 409, error: "That show is already added. Open Shows to see it." };
  const pollMinutes = Math.min(Math.max(Math.round(input.pollMinutes ?? 60), 15), 24 * 60);
  feed ??= createFeed({ url: checked.url, title: checked.host, publisher: checked.host, band: "adult", pollIntervalS: pollMinutes * 60, provenance: `person:${actor.id}`, nowIso, purpose: "podcast" });
  const id = newMediaSourceId();
  db.insert(mediaSources).values({
    id, kind: "feed", scope: "household", ownerPersonId: actor.id, label: checked.host, feedId: feed.id, pollMinutes, visibleTo: JSON.stringify(input.visibleTo ?? "household"),
    createdAt: nowIso, hlc: nextHlc(), provenance: `person:${actor.id}`,
  }).run();
  return { ok: true, value: { source: sourceFromRow(db.select().from(mediaSources).where(eq(mediaSources.id, id)).get()!), feed: getFeed(feed.id)! } };
}

/** An admin stops following a show: the feed stops being polled and the source goes to the trash. Saved copies stay in Storage. */
export function unsubscribePodcast(actor: PersonRow, sourceId: string): Outcome<{ id: string }> {
  if (!isMediaAdmin(actor) || mediaBandOf(actor) !== "adult") return { ok: false, status: 403, error: "Only an adult admin can remove a show." };
  const row = db.select().from(mediaSources).where(and(eq(mediaSources.id, sourceId), eq(mediaSources.kind, "feed"), isNull(mediaSources.deletedAt))).get();
  if (!row) return { ok: false, status: 404, error: "That show is not in your list." };
  // Older copies could be deduped across sources. Include referenced art as well as files created for this source.
  const referencedArt = new Set(db.select({ artwork: mediaItems.artwork }).from(mediaItems).where(eq(mediaItems.sourceId, row.id)).all()
    .map((item) => item.artwork ? (JSON.parse(item.artwork) as { file_id?: string }).file_id : undefined));
  const artIds = new Set(db.select().from(attachments).where(and(eq(attachments.origin, "fetched"), eq(attachments.provenance, "podcast:art"))).all()
    .filter((file) => file.mediaSourceId === row.id || referencedArt.has(file.id)).map((file) => file.id));
  removeSource(row.id);
  db.update(mediaItems).set({ artwork: null, hlc: nextHlc() }).where(eq(mediaItems.sourceId, row.id)).run();
  // One scan for the files every remaining item still uses, not one per picture.
  const stillUsed = new Set<string>();
  for (const item of db.select({ artwork: mediaItems.artwork, fileId: mediaItems.locFileId }).from(mediaItems).all()) {
    if (item.fileId) stillUsed.add(item.fileId);
    const art = item.artwork ? (JSON.parse(item.artwork) as { file_id?: string }).file_id : undefined;
    if (art) stillUsed.add(art);
  }
  for (const artId of artIds) if (!stillUsed.has(artId)) removeFetchedFile(artId);
  if (row.feedId) deleteFeed(row.feedId);
  return { ok: true, value: { id: row.id } };
}

export interface SourcePatch {
  speed?: number | null;
  skip_intro_s?: number;
  skip_outro_s?: number;
  auto?: { save?: "none" | "audio"; keep_latest?: number | null; remove_watched?: boolean };
  paused?: boolean;
  visible_to?: "household" | string[];
}

/** Per-show settings: speed, skip seconds, the keep rules (auto), pause, and who the show is for. */
export function updatePodcastSource(actor: PersonRow, sourceId: string, patch: SourcePatch): Outcome<MediaSource> {
  if (!isMediaAdmin(actor) || mediaBandOf(actor) !== "adult") return { ok: false, status: 403, error: "Only an adult admin can change a show's settings." };
  const row = db.select().from(mediaSources).where(and(eq(mediaSources.id, sourceId), eq(mediaSources.kind, "feed"), isNull(mediaSources.deletedAt))).get();
  if (!row) return { ok: false, status: 404, error: "That show is not in your list." };
  const set: Partial<typeof mediaSources.$inferInsert> = { hlc: nextHlc() };
  if (patch.speed !== undefined) {
    if (patch.speed !== null && (!Number.isFinite(patch.speed) || patch.speed < 0.5 || patch.speed > 3)) return { ok: false, status: 400, error: "Speed must be between 0.5 and 3, such as 1.2." };
    set.speed = patch.speed;
  }
  for (const [key, column] of [["skip_intro_s", "skipIntroS"], ["skip_outro_s", "skipOutroS"]] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0 || value > 600) return { ok: false, status: 400, error: "Skip seconds must be a whole number from 0 to 600." };
    set[column] = value;
  }
  if (patch.auto) {
    const current = JSON.parse(row.auto) as Record<string, unknown>;
    const next = { ...current };
    if (patch.auto.save !== undefined) next.save = patch.auto.save;
    if (patch.auto.keep_latest !== undefined) {
      if (patch.auto.keep_latest !== null && (!Number.isInteger(patch.auto.keep_latest) || patch.auto.keep_latest < 1 || patch.auto.keep_latest > 25)) return { ok: false, status: 400, error: "Keep the newest 1 to 25 episodes." };
      next.keep_latest = patch.auto.keep_latest;
    }
    if (patch.auto.remove_watched !== undefined) next.remove_watched = patch.auto.remove_watched;
    set.auto = JSON.stringify(next);
  }
  if (patch.paused !== undefined) set.paused = patch.paused;
  if (patch.visible_to !== undefined) set.visibleTo = JSON.stringify(patch.visible_to);
  db.update(mediaSources).set(set).where(eq(mediaSources.id, sourceId)).run();
  return { ok: true, value: sourceFromRow(db.select().from(mediaSources).where(eq(mediaSources.id, sourceId)).get()!) };
}

// ---- ingest -----------------------------------------------------------------------------------------------------------------------

function personById(id: string | null): PersonRow | null {
  return id ? db.select().from(people).where(eq(people.id, id)).get() ?? null : null;
}

async function fetchShowArt(source: MediaSource, imageUrl: string, deps: PollDeps, nowMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await guardedGet(imageUrl, deps, () => nowMs, controller.signal, { accept: "image/*", bucket: ART_RATE });
    if (response.status !== 200) { await response.body?.cancel().catch(() => undefined); return null; }
    const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) { await response.body?.cancel().catch(() => undefined); return null; }
    const bytes = await readBytesLimited(response, MAX_ART_BYTES);
    const owner = personById(source.owner_person_id);
    if (!bytes || !owner || !liveSourceById(source.id)) return null;
    const stored = createFetchedFile(owner, { mediaType: type, bytes, mediaSourceId: source.id, note: "podcast:art" });
    return stored.ok ? stored.value.id : null;
  } catch {
    return null; // a missing picture never fails the feed
  } finally {
    clearTimeout(timer);
  }
}

function rowFor(sourceId: string, guid: string): MediaItemRow | undefined {
  return db.select().from(mediaItems).where(and(eq(mediaItems.sourceId, sourceId), eq(mediaItems.externalId, guid))).get();
}

function recordFor(source: MediaSource, feed: FeedRecord, show: ParsedShow, episode: ParsedEpisode, existing: MediaItemRow | undefined, artFileId: string | null, nowIso: string): MediaItem {
  const verdict = bandOkAtIngest({ explicit: episode.explicit === true, title: episode.title, description: episode.description, also: [show.title, show.author] });
  const band = existing?.verifiedByPersonId ? (existing.bandOk as MediaItem["band_ok"]) : verdict.band;
  const saved = existing?.locFileId ?? null;
  return MediaItem.parse({
    id: existing?.id ?? newMediaItemId(), kind: "podcast_episode", title: episode.title, subtitle: show.title, description: episode.description || null, source_id: source.id, parent_id: null,
    location: saved ? { file_id: saved } : { url: episode.enclosureUrl }, media_type: episode.mediaType, duration_s: episode.durationS, size: existing?.size ?? episode.size, width: null, height: null, video_codec: null, audio_codec: null,
    playable: episode.mediaType.startsWith("audio/") ? "original" : "unknown", artwork: existing?.artwork ? JSON.parse(existing.artwork) : artFileId ? { file_id: artFileId } : null, previews: null, chapters: episode.chapters, subtitles: [],
    series: null, season: episode.season, episode: episode.episode, artist: show.author, album: null, album_artist: null, track_no: null, disc_no: null, year: episode.publishedAt ? Number(episode.publishedAt.slice(0, 4)) : null,
    genre: null, author: show.author, narrator: null, series_index: null, locator_kind: "none",
    external: { extractor: "rss", id: episode.guid, url: episode.link, channel_id: feed.id, channel_name: show.title, published_at: episode.publishedAt },
    advisory: { explicit: episode.explicit === true, source: verdict.advisorySource }, band_ok: band, verified_by_person_id: existing?.verifiedByPersonId ?? null, added_at: existing?.addedAt ?? nowIso,
    fingerprint: existing?.fingerprint ?? null, hidden: existing?.hidden ?? false, deleted_at: existing?.deletedAt ?? null, trash_until: existing?.trashUntil ?? null, created_at: existing?.createdAt ?? nowIso, hlc: nextHlc(), provenance: `feed:${feed.id}`,
  });
}

/** The poller's hand-off for a podcast feed: show and episodes into the media library. Idempotent; a trashed or removed episode stays gone. */
export async function ingestPodcastFeed(feed: FeedRecord, body: string, deps: PollDeps, nowMs: number): Promise<void> {
  const row = sourceRowForFeed(feed.id);
  if (!row) return;
  const source = sourceFromRow(row);
  const show = parsePodcastFeed(body, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  if (source.label === new URL(feed.url).hostname || source.label !== show.title) {
    db.update(mediaSources).set({ label: show.title, hlc: nextHlc() }).where(eq(mediaSources.id, source.id)).run();
  }
  const archive = new Set(source.archive);
  let artFileId = db.select({ artwork: mediaItems.artwork }).from(mediaItems).where(and(eq(mediaItems.sourceId, source.id), isNull(mediaItems.deletedAt))).all().map((item) => (item.artwork ? (JSON.parse(item.artwork) as { file_id?: string }).file_id : undefined)).find((id) => id) ?? null;
  if (!artFileId && show.imageUrl) artFileId = await fetchShowArt(source, show.imageUrl, deps, nowMs);
  for (const episode of show.episodes) {
    if (archive.has(episode.guid)) continue; // deleted stays gone
    const existing = rowFor(source.id, episode.guid);
    if (existing?.deletedAt) continue;
    const record = recordFor(source, feed, show, episode, existing, artFileId, nowIso);
    const values = itemToRow(record, { lastSeenScan: null, missingSince: null, pages: null, probeFailedFp: null });
    // The saved copy's location survives a re-poll: file_id and url are separate columns, so Unsave can go back to streaming.
    values.locUrl = episode.enclosureUrl;
    values.locFileId = existing?.locFileId ?? null;
    if (existing) db.update(mediaItems).set({ ...values, id: existing.id }).where(eq(mediaItems.id, existing.id)).run();
    else db.insert(mediaItems).values(values).run();
    if (episode.transcriptUrl) {
      const transcript = db.select().from(podcastTranscripts).where(eq(podcastTranscripts.itemId, record.id)).get();
      const hlc = nextHlc(), transcriptValues = { itemId: record.id, transcriptUrl: episode.transcriptUrl, source: transcript?.source ?? null, text: transcript?.text ?? null, segments: transcript?.segments ?? "[]", jobId: transcript?.jobId ?? null, updatedAt: nowIso, hlc };
      db.insert(podcastTranscripts).values(transcriptValues).onConflictDoUpdate({ target: podcastTranscripts.itemId, set: transcriptValues }).run();
    }
  }
  db.update(mediaSources).set({ lastCheckedAt: nowIso, lastStatus: "ok", failures: 0, backoffUntil: null }).where(eq(mediaSources.id, source.id)).run();
  queuePodcastAutoRules(source.id, deps, nowMs);
}

export interface TranscriptSegment { start_s: number; text: string }
export interface PodcastTranscript { text: string; segments: TranscriptSegment[]; source: "publisher" | "whisper" }
const TRANSCRIPT_MAX_BYTES = 12 * 1024 * 1024;
const TRANSCRIPT_TEXT_MAX = 2_000_000;
const transcriptOf = (row: MediaItemRow): PodcastTranscript | null => {
  const stored = db.select().from(podcastTranscripts).where(eq(podcastTranscripts.itemId, row.id)).get();
  if (typeof stored?.text !== "string") return null;
  let segments: TranscriptSegment[];
  try { const parsed: unknown = JSON.parse(stored.segments); if (!Array.isArray(parsed)) return null; segments = parsed as TranscriptSegment[]; } catch { return null; }
  return { text: stored.text, segments, source: stored.source === "publisher" ? "publisher" : "whisper" };
};
function storeTranscript(row: MediaItemRow, transcript: PodcastTranscript): void {
  const hlc = nextHlc(), current = db.select().from(podcastTranscripts).where(eq(podcastTranscripts.itemId, row.id)).get();
  const values = { itemId: row.id, transcriptUrl: current?.transcriptUrl ?? null, source: transcript.source, text: transcript.text.slice(0, TRANSCRIPT_TEXT_MAX), segments: JSON.stringify(transcript.segments), jobId: current?.jobId ?? null, updatedAt: new Date().toISOString(), hlc };
  db.insert(podcastTranscripts).values(values).onConflictDoUpdate({ target: podcastTranscripts.itemId, set: values }).run();
}
function parseTranscriptDocument(input: string, mime: string): PodcastTranscript {
  const segments: TranscriptSegment[] = [];
  const clean = (s: string) => plainNotes(s, TRANSCRIPT_TEXT_MAX).replace(/\s+/g, " ").trim();
  if (/json/i.test(mime) || /^\s*\{/.test(input)) {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const raw = Array.isArray(parsed.segments) ? parsed.segments : Array.isArray(parsed.transcript) ? parsed.transcript : [];
    for (const entry of raw) if (entry && typeof entry === "object") {
      const segment = entry as Record<string, unknown>, start = Number(segment.start ?? segment.start_s ?? segment.offset);
      const value = clean(String(segment.text ?? segment.content ?? ""));
      if (Number.isFinite(start) && start >= 0 && value) segments.push({ start_s: Math.floor(start), text: value });
    }
    if (!segments.length && typeof parsed.text === "string") segments.push({ start_s: 0, text: clean(parsed.text) });
  } else {
    const vtt = input.replace(/^\uFEFF/, "").split(/\r?\n\s*\r?\n/);
    for (const block of vtt) {
      const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const timing = lines.findIndex((line) => /\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->/.test(line));
      if (timing < 0) continue;
      const stamp = /^(?:(\d+):)?(\d{2}):(\d{2})[.,]\d{3}/.exec(lines[timing]!);
      if (!stamp) continue;
      const start = Number(stamp[1] ?? 0) * 3600 + Number(stamp[2]) * 60 + Number(stamp[3]);
      const value = clean(lines.slice(timing + 1).join(" "));
      if (value) segments.push({ start_s: start, text: value });
    }
    if (!segments.length) { const value = clean(input); if (value) segments.push({ start_s: 0, text: value }); }
  }
  segments.sort((a, b) => a.start_s - b.start_s);
  const text = segments.map((segment) => segment.text).join(" ").slice(0, TRANSCRIPT_TEXT_MAX);
  if (!text) throw new Error("empty transcript");
  return { text, segments, source: "publisher" };
}

/** Publisher transcript first; otherwise submit one Stack media.fetch job. Search only scans stored episode segments. */
export async function getPodcastTranscript(actor: PersonRow, itemId: string, deps: PollDeps = routeDeps): Promise<Outcome<{ transcript?: PodcastTranscript; job_id?: string }>> {
  const item = readableItem(actor, itemId);
  const row = item ? itemRow(itemId) : undefined;
  if (!row || row.kind !== "podcast_episode") return { ok: false, status: 404, error: "That episode is not available to you." };
  if (mediaBandOf(actor) === "child") return { ok: false, status: 403, error: "Transcripts are available to teens and adults." };
  const stored = transcriptOf(row);
  if (stored) return { ok: true, value: { transcript: stored } };
  const transcriptRow = db.select().from(podcastTranscripts).where(eq(podcastTranscripts.itemId, row.id)).get();
  const publisherUrl = transcriptRow?.transcriptUrl ?? null;
  if (publisherUrl) {
    try {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000);
      try {
    const response = await guardedGet(publisherUrl, deps, Date.now, controller.signal, { maxRedirects: 5, accept: "text/vtt, application/json, application/xml, text/plain;q=0.9, */*;q=0.5", bucket: TRANSCRIPT_RATE });
        if (response.status === 200) {
          const bytes = await readBytesLimited(response, TRANSCRIPT_MAX_BYTES);
          if (bytes) {
            const parsed = parseTranscriptDocument(new TextDecoder().decode(bytes), response.headers.get("content-type") ?? "");
            storeTranscript(row, parsed);
            return { ok: true, value: { transcript: parsed } };
          }
        }
        await response.body?.cancel().catch(() => undefined);
      } finally { clearTimeout(timer); }
    } catch { /* publisher failures fall through to the Stack's existing fetch job */ }
  }
  try {
    if (!row.locUrl) return { ok: false, status: 422, error: "This episode has no audio address to transcribe." };
    if (typeof transcriptRow?.jobId === "string") return { ok: true, value: { job_id: transcriptRow.jobId } };
    const job: StackJob = await getStackClient().submitJob({ kind: "media.fetch", input: { url: row.locUrl, kind: "audio", person_initiated: true, subtitles: true, quality: "best", max_items: 1 } });
    const hlc = nextHlc(), values = { itemId: row.id, transcriptUrl: transcriptRow?.transcriptUrl ?? null, source: transcriptRow?.source ?? null, text: transcriptRow?.text ?? null, segments: transcriptRow?.segments ?? "[]", jobId: job.id, updatedAt: new Date().toISOString(), hlc };
    db.insert(podcastTranscripts).values(values).onConflictDoUpdate({ target: podcastTranscripts.itemId, set: values }).run();
    return { ok: true, value: { job_id: job.id } };
  } catch {
    return { ok: false, status: 502, error: "The transcript could not be fetched and the Stack could not start transcription. Try again later." };
  }
}

export function searchPodcastTranscripts(actor: PersonRow, query: string): Array<{ episode_id: string; title: string; start_s: number; text: string }> {
  const words = query.trim().toLocaleLowerCase();
  if (words.length < 2 || mediaBandOf(actor) === "child") return [];
  const rows = db.select().from(mediaItems).where(eq(mediaItems.kind, "podcast_episode")).all();
  const hits: Array<{ episode_id: string; title: string; start_s: number; text: string }> = [];
  for (const row of rows) {
    if (!readableItem(actor, row.id)) continue;
    const transcript = transcriptOf(row);
    if (!transcript) continue;
    const segment = transcript.segments.find((part) => part.text.toLocaleLowerCase().includes(words));
    if (segment) hits.push({ episode_id: row.id, title: row.title, start_s: segment.start_s, text: segment.text });
  }
  return hits;
}

// ---- save, unsave, the keep rules ---------------------------------------------------------------------------------------------------

export const mayManageSaves = (person: PersonRow): boolean => person.role !== "guest" && mediaBandOf(person) === "adult";

function itemRow(id: string): MediaItemRow | undefined {
  return db.select().from(mediaItems).where(eq(mediaItems.id, id)).get();
}

export interface SaveOptions {
  /** The keep rules saved it (they may remove it again); a person's own Save is manual and never removed by them. */
  auto?: boolean;
  deps?: PollDeps;
  now?: () => number;
}

/** Fetches the episode's enclosure through the poller's guarded GET into the household file store (origin fetched) and points the item at it. */
export async function saveEpisode(actor: PersonRow, itemId: string, options: SaveOptions = {}): Promise<Outcome<MediaItem>> {
  const row = itemRow(itemId);
  const source = row ? liveSourceById(row.sourceId) : null;
  if (!row || row.deletedAt || row.kind !== "podcast_episode" || !source || source.kind !== "feed") return { ok: false, status: 404, error: "That episode is not in your podcasts." };
  if (!mayManageSaves(actor)) return { ok: false, status: 403, error: "Only an adult can save an episode on the hub. You can still play it." };
  if (!options.auto && !readableItem(actor, row.id)) return { ok: false, status: 404, error: "That episode is not available to you. Choose an episode from your Podcasts list." };
  if (row.locFileId && !db.select({ id: attachments.id }).from(attachments).where(eq(attachments.id, row.locFileId)).get()) {
    // The copy's file is gone (its owner left the household): forget the dangling reference and save afresh.
    db.update(mediaItems).set({ locFileId: null, fingerprint: null, hlc: nextHlc() }).where(eq(mediaItems.id, row.id)).run();
    row.locFileId = null;
  }
  if (row.locFileId) {
    // A person's own Save of a copy the keep rules made turns it into a manual one, which the rules never remove.
    if (!options.auto) db.update(attachments).set({ provenance: "podcast:manual" }).where(and(eq(attachments.id, row.locFileId), eq(attachments.origin, "fetched"))).run();
    return { ok: true, value: itemFromRow(row) };
  }
  if (!row.locUrl) return { ok: false, status: 422, error: "This episode has no address to save from." };
  const owner = options.auto ? personById(source.owner_person_id) ?? actor : actor;
  const preflight = checkStorageCap(owner.role, owner.id, row.size ?? 1);
  if (!preflight.ok) return { ok: false, status: 403, error: preflight.error! };
  const deps = options.deps ?? routeDeps;
  const now = options.now ?? Date.now;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await guardedGet(httpsPodcastAddress(row.locUrl), deps, now, controller.signal, { maxRedirects: 5, accept: "audio/*, video/*;q=0.8, */*;q=0.5", bucket: ENCLOSURE_RATE });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, status: 502, error: `The show's server would not send the episode (it answered ${response.status}). Try again later.` };
    }
    const header = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const mediaType = /^(audio|video)\//.test(header) ? header : row.mediaType;
    const stored = await createFetchedFileFromResponse(owner, { mediaType, mediaSourceId: source.id, note: options.auto ? "podcast:auto" : "podcast:manual" }, response, MAX_ENCLOSURE_BYTES);
    if (!stored.ok) return { ok: false, status: stored.status === 403 ? 403 : 422, error: stored.error };
    const current = itemRow(row.id);
    if (!current || current.deletedAt || !liveSourceById(source.id) || (current.locFileId && current.locFileId !== stored.value.id)) {
      if (!db.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.locFileId, stored.value.id)).get()) removeFetchedFile(stored.value.id);
      return { ok: false, status: 409, error: "The episode changed while it was downloading. Open Podcasts and try Save again." };
    }
    db.update(mediaItems).set({ locFileId: stored.value.id, size: stored.value.size, fingerprint: stored.value.sha256, mediaType, hlc: nextHlc() }).where(eq(mediaItems.id, row.id)).run();
    syncFileReferences(stored.value.id);
    return { ok: true, value: itemFromRow(itemRow(row.id)!) };
  } catch (error) {
    if (error instanceof RedirectLimitError) return { ok: false, status: 502, error: "The episode server sent more than five redirects or left out the next address. Try again later or ask the show for a direct episode link." };
    if (error instanceof SsrfBlockedError) return { ok: false, status: 422, error: "That episode lives at an address the hub does not fetch from (it must be a public https address). It still plays from the show's server." };
    if (error instanceof RateLimited) return { ok: false, status: 502, error: "The hub just fetched from that server. Wait a few seconds and press Save again." };
    return { ok: false, status: 502, error: "The hub could not download the episode. Check the internet connection and try again." };
  } finally {
    clearTimeout(timer);
  }
}

/** Back to streaming: the item points at the show again and the copy is removed when nothing else uses it. */
export function unsaveEpisode(actor: PersonRow, itemId: string): Outcome<MediaItem> {
  if (!mayManageSaves(actor)) return { ok: false, status: 403, error: "Only an adult can remove a saved episode." };
  const row = itemRow(itemId);
  if (!row || row.deletedAt || row.kind !== "podcast_episode") return { ok: false, status: 404, error: "That episode is not in your podcasts." };
  if (row.locFileId && !mayManagePodcastCopy(actor, row.locFileId)) return { ok: false, status: 403, error: "Only the person who saved this copy or an adult admin can remove it. Ask them to remove it." };
  if (row.locFileId) releaseCopy(row);
  return { ok: true, value: itemFromRow(itemRow(row.id)!) };
}

function releaseCopy(row: MediaItemRow): void {
  const file = row.locFileId ? db.select({ id: attachments.id }).from(attachments).where(eq(attachments.id, row.locFileId)).get() : null;
  if (file) { trashPodcastCopy(row); return; }
  // A dangling reference (the file left with its owner) has nothing to trash: just clear it.
  db.update(mediaItems).set({ locFileId: null, fingerprint: null, hlc: nextHlc() }).where(eq(mediaItems.id, row.id)).run();
}

/** Prefer secure enclosure playback and download, including old feeds that still list http addresses. */
export function httpsPodcastAddress(address: string): string {
  return address.replace(/^http:\/\//i, "https://");
}

/** "Deleted stays gone" for a feed item: its guid joins the source's archive so no later poll brings it back. */
export function archiveEpisode(row: Pick<MediaItemRow, "sourceId" | "externalId" | "locFileId" | "id">): void {
  if (row.externalId) archivePath(row.sourceId, row.externalId);
}

function completedByEveryone(itemId: string): boolean {
  const rows = db.select().from(mediaProgress).where(eq(mediaProgress.mediaId, itemId)).all();
  return rows.length > 0 && rows.every((progress) => progress.completed);
}

/** Runs after each poll: save the newest N, and remove auto-saved copies that fell outside the newest N or that everyone has played. */
type AutoOutcome = { saved: number; removed: number };
const autoInFlight = new Map<string, Promise<AutoOutcome>>();
const autoQueue = new Map<string, { deps: PollDeps; nowMs: number }>();
let autoWorker: Promise<void> | null = null;

/** One bounded, serial background lane. Polling only enqueues; downloads start on a later event-loop turn. A request for a source
 * whose run is in progress is queued again, so a rule change made during a download still applies once that run ends. */
export function queuePodcastAutoRules(sourceId: string, deps: PollDeps = routeDeps, nowMs = Date.now()): void {
  autoQueue.set(sourceId, { deps, nowMs });
  if (autoWorker) return;
  autoWorker = trackBackgroundWork(runAutoQueue());
}
async function runAutoQueue(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (;;) {
    const next = autoQueue.entries().next();
    // Cleared in the same synchronous step that finds the queue empty, so a later enqueue always starts a new worker.
    if (next.done) { autoWorker = null; return; }
    const [id, job] = next.value;
    autoQueue.delete(id);
    try {
      await autoInFlight.get(id)?.catch(() => undefined);
      await applyAutoRules(id, job.deps, job.nowMs);
    } catch { reportShelfEvent("podcast_keep_failed"); }
  }
}
export async function drainPodcastAutoRules(): Promise<void> {
  while (autoWorker) await autoWorker;
}

/** Coalesce callers for a source, including a rule change during a queued download. */
export function applyAutoRules(sourceId: string, deps: PollDeps = routeDeps, nowMs = Date.now()): Promise<AutoOutcome> {
  const active = autoInFlight.get(sourceId);
  if (active) return active;
  const work = runAutoRules(sourceId, deps, nowMs).finally(() => { autoInFlight.delete(sourceId); });
  autoInFlight.set(sourceId, work);
  return work;
}
async function runAutoRules(sourceId: string, deps: PollDeps, nowMs: number): Promise<AutoOutcome> {
  const source = liveSourceById(sourceId);
  const outcome = { saved: 0, removed: 0 };
  if (!source || source.kind !== "feed" || (source.auto.save === "none" && !source.auto.remove_watched)) return outcome;
  const owner = personById(source.owner_person_id);
  if (!owner || !mayManageSaves(owner)) return outcome;
  const rows = db.select().from(mediaItems).where(and(eq(mediaItems.sourceId, sourceId), isNull(mediaItems.deletedAt), eq(mediaItems.hidden, false))).all()
    .sort((a, b) => publishedOf(b).localeCompare(publishedOf(a)));
  const keep = source.auto.keep_latest ?? (source.auto.save === "audio" ? 1 : 0);
  const newest = new Set(rows.slice(0, keep).map((row) => row.id));
  if (source.auto.save === "audio") {
    for (const row of rows) {
      if (!newest.has(row.id) || row.locFileId) continue;
      if (source.auto.remove_watched && completedByEveryone(row.id)) continue;
      const result = await saveEpisode(owner, row.id, { auto: true, deps, now: () => nowMs });
      if (result.ok) outcome.saved++;
      else break; // a failing server or a full disk: stop here, the next poll tries again
    }
  }
  // Never prune a copy a person saved by hand: only files the keep rules made.
  for (const row of rows) {
    if (!row.locFileId) continue;
    const file = db.select({ provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, row.locFileId)).get();
    if (file?.provenance !== "podcast:auto") continue;
    const outside = source.auto.save === "audio" && !newest.has(row.id);
    const played = source.auto.remove_watched && completedByEveryone(row.id);
    if (outside || played) { releaseCopy(row); outcome.removed++; }
  }
  return outcome;
}

const publishedOf = (row: MediaItemRow): string => (row.external ? ((JSON.parse(row.external) as { published_at?: string | null }).published_at ?? row.addedAt) : row.addedAt);

// ---- polling on demand --------------------------------------------------------------------------------------------------------------

/** The first look at a new show (and "Check now"): a normal poll of this one feed, through the same guard and pacing. */
export function pollPodcastNow(feedId: string): Promise<unknown> {
  const feed = getFeed(feedId);
  return feed ? pollFeed(feed, routeDeps) : Promise.resolve(null);
}

// ---- OPML ---------------------------------------------------------------------------------------------------------------------------

export interface OpmlResult {
  added: number;
  already: number;
  skipped: Array<{ url: string; reason: string }>;
  /** New shows are already due; the normal ten-feed tick polls them without fan-out. */
  feedIds: string[];
}

function outlinesOf(nodes: Json[] | undefined, out: Array<{ url: string; title: string }>): void {
  for (const node of nodes ?? []) {
    const url = typeof node.xmlUrl === "string" ? node.xmlUrl : typeof node.url === "string" && node.type === "rss" ? node.url : null;
    if (url) out.push({ url, title: String(node.title ?? node.text ?? "") });
    outlinesOf(node.outlines, out);
  }
}

/** Every feed address in an OPML file. Throws a plain sentence when the file is not OPML. */
export function parseOpmlAddresses(opml: string): Array<{ url: string; title: string }> {
  let parsed: Json;
  try { parsed = parseOpml(opml) as Json; } catch { throw new Error("That file is not an OPML list. Export the list from your podcast app and choose that file."); }
  const out: Array<{ url: string; title: string }> = [];
  outlinesOf(parsed.body?.outlines, out);
  return out;
}

export function importOpml(actor: PersonRow, opml: string): Outcome<OpmlResult> {
  let addresses: Array<{ url: string; title: string }>;
  try { addresses = parseOpmlAddresses(opml); } catch (error) { return { ok: false, status: 400, error: (error as Error).message }; }
  if (addresses.length === 0) return { ok: false, status: 400, error: "That OPML list has no podcast feeds in it." };
  if (addresses.length > 200) return { ok: false, status: 400, error: `That list has ${addresses.length} shows and the limit is 200 at a time. Split the file and import it in parts.` };
  const result: OpmlResult = { added: 0, already: 0, skipped: [], feedIds: [] };
  for (const address of addresses) {
    const subscribed = subscribePodcast(actor, { url: address.url });
    if (subscribed.ok) { result.added++; result.feedIds.push(subscribed.value.feed.id); }
    else if (subscribed.status === 409) result.already++;
    else if (subscribed.status === 403) return subscribed;
    else result.skipped.push({ url: address.url, reason: subscribed.error });
  }
  return { ok: true, value: result };
}

/** The household's shows as an OPML file (feed addresses only: no listening history, no person). */
export function exportOpml(): string {
  const outlines = db.select().from(mediaSources).where(and(eq(mediaSources.kind, "feed"), isNull(mediaSources.deletedAt))).all().flatMap((row) => {
    const feed = row.feedId ? getFeed(row.feedId) : null;
    return feed ? [{ text: row.label, title: row.label, type: "rss", xmlUrl: feed.url }] : [];
  });
  return generateOpml({ head: { title: "MaiPai Home podcasts", dateCreated: new Date() }, body: { outlines } } as never);
}
