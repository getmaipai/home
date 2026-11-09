// PODCAST-PARITY-01 (2026-11-09): the pieces that bring Podcasts closer to Apple Podcasts using only what the pinned spec already allows:
// the show page's Latest / Top / Seasons order, Following and unfollowing, the Library's Followed / Unfollowed / Downloaded filter,
// Listen Now's Latest episode rows with their queue and played fields, and Mark played. Everything is read from this hub's own data;
// nothing here makes a request. Unfollowing PAUSES the show (its saved copies and history stay, no new episodes arrive), so a show
// the household stops following is listed as Unfollowed and Follow brings it back.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mediaSources } from "@/db/schema";
import type { PersonRow } from "@/types";
import { findFeedByUrl } from "@/lib/shelf/feedStore";
import { checkFeedAddress } from "@/lib/shelf/feedAddresses";
import { collectionIds, readableIn, type MediaRow } from "./appHost";
import { isMediaAdmin } from "./access";
import { mediaBandOf } from "./band";
import { correctedStamp, getProgress, getProgressMany, writeProgress } from "./progress";
import { removeItemFrom, resolveCollection } from "./collections";
import type { MediaItem, MediaSource } from "./model";
import { pollPodcastNow, sourceRowForFeed, subscribePodcast, updatePodcastSource, type Outcome } from "./podcasts";

export type EpisodeSort = "latest" | "top" | "seasons";
export const episodeSortOf = (value: unknown): EpisodeSort => (value === "top" || value === "seasons" ? value : "latest");

/** What the sort needs from an episode: a real one in the library, or one read from a directory preview. */
export interface SortableEpisode { id: string; published: string; season: number | null; episode: number | null }

const seasonNumber = (value: unknown): number | null => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** The seasons a show has, newest season first. A show that names none has none. */
export function seasonsOf(episodes: readonly SortableEpisode[]): Array<{ id: string; label: string }> {
  const seen = [...new Set(episodes.map((e) => e.season).filter((season): season is number => season !== null))].sort((a, b) => b - a);
  return seen.map((season) => ({ id: String(season), label: `Season ${season}` }));
}

/**
 * Latest is newest first. Top puts what this person listened to first (their own listening only, kept on this hub), then the newest.
 * Seasons shows one season, episode 1 first; with none chosen it is the newest season.
 */
export function orderEpisodes<T extends SortableEpisode>(personId: string, episodes: readonly T[], sort: EpisodeSort, season?: unknown): T[] {
  const newest = (a: T, b: T) => b.published.localeCompare(a.published);
  if (sort === "top") {
    const heard = new Map(getProgressMany(personId, episodes.map((e) => e.id)).map((p) => [p.media_id, p.updated_at]));
    return [...episodes].sort((a, b) => Number(heard.has(b.id)) - Number(heard.has(a.id)) || (heard.get(b.id) ?? "").localeCompare(heard.get(a.id) ?? "") || newest(a, b));
  }
  if (sort === "seasons") {
    const seasons = seasonsOf(episodes);
    const wanted = seasonNumber(season) ?? (seasons[0] ? Number(seasons[0].id) : null);
    if (wanted === null) return [];
    return episodes.filter((e) => e.season === wanted).sort((a, b) => (a.episode ?? Number.MAX_SAFE_INTEGER) - (b.episode ?? Number.MAX_SAFE_INTEGER) || a.published.localeCompare(b.published));
  }
  return [...episodes].sort(newest);
}

// ---- follow and unfollow ----

/** Follow: a show this home stopped following comes back (and is checked now); a new one is added as before. */
export function followPodcast(actor: PersonRow, url: string): Outcome<{ source_id: string }> {
  const added = subscribePodcast(actor, { url });
  if (added.ok) return { ok: true, value: { source_id: added.value.source.id } };
  if (added.status !== 409) return added;
  const checked = checkFeedAddress(url.trim());
  const feed = checked.ok ? findFeedByUrl(checked.url) : null;
  const row = feed ? sourceRowForFeed(feed.id) : undefined;
  if (!row || !row.paused) return added;
  const resumed = updatePodcastSource(actor, row.id, { paused: false });
  if (!resumed.ok) return resumed;
  void pollPodcastNow(feed!.id);
  return { ok: true, value: { source_id: row.id } };
}

/** Unfollow: the show stops checking for new episodes and moves to Unfollowed. Saved copies, queue and history stay. */
export function unfollowPodcast(actor: PersonRow, sourceId: string): Outcome<{ source_id: string }> {
  if (!isMediaAdmin(actor) || mediaBandOf(actor) !== "adult") return { ok: false, status: 403, error: "Only an adult admin can stop following a show. Ask the person who runs this home." };
  const row = db.select().from(mediaSources).where(and(eq(mediaSources.id, sourceId), eq(mediaSources.kind, "feed"), isNull(mediaSources.deletedAt))).get();
  if (!row) return { ok: false, status: 404, error: "That show is not in your list. Open Shows and try again." };
  const done = updatePodcastSource(actor, row.id, { paused: true });
  return done.ok ? { ok: true, value: { source_id: row.id } } : done;
}

export const isFollowed = (source: Pick<MediaSource, "kind" | "paused">): boolean => source.kind === "production" || !source.paused;

// ---- the Library filter ----

export type ShowFilter = "all" | "followed" | "unfollowed" | "downloaded";
/** No choice yet is Followed: the Library and "Your shows" open on the shows this home follows. */
export const showFilterOf = (scope: string | undefined): ShowFilter => (scope === "unfollowed" || scope === "downloaded" || scope === "all" ? scope : "followed");
export function showMatches(filter: ShowFilter, source: Pick<MediaSource, "kind" | "paused">, savedCopies: number): boolean {
  if (filter === "all") return true;
  if (filter === "downloaded") return savedCopies > 0;
  return filter === "followed" ? isFollowed(source) : !isFollowed(source);
}

// ---- Listen Now rows: date, length, queue and played ----

const FRESH_DAYS = 30;
const dateLabel = (value: string | null | undefined): string => {
  const date = value ? new Date(value) : null;
  return !date || Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
};

/** The fields a row's actions and badge read: "New" until played (for a month after it came out), "Played" once finished, else the saved label. */
export function episodeFields(person: PersonRow, items: readonly MediaItem[], nowMs = Date.now()): Map<string, Record<string, unknown>> {
  const queued = new Set(collectionIds(person, "queue"));
  const progress = new Map(getProgressMany(person.id, items.map((i) => i.id)).map((p) => [p.media_id, p]));
  const out = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    const published = item.external?.published_at ?? item.added_at;
    const played = progress.get(item.id)?.completed === true;
    const seen = progress.get(item.id);
    const heard = !!seen && (seen.completed || (("seconds" in seen.position ? seen.position.seconds : 0) > 0));
    const fresh = nowMs - Date.parse(published) < FRESH_DAYS * 86_400_000;
    const saved = !(item.location as { url?: string }).url;
    const isQueued = queued.has(item.id);
    out.set(item.id, {
      date: dateLabel(published), played, queued: isQueued,
      queue_label: isQueued ? "Remove from queue" : "Add to queue", queue_next: !isQueued,
      played_label: played ? "Mark unplayed" : "Mark played", played_next: !played,
      badge: played ? "Played" : !heard && fresh ? "New" : saved ? "Saved" : "",
    });
  }
  return out;
}

export const withEpisodeFields = (person: PersonRow, items: readonly MediaItem[], rows: readonly MediaRow[]): MediaRow[] => {
  const fields = episodeFields(person, items);
  return rows.map((row) => ({ ...row, ...(fields.get(row.id) ?? {}) }));
};

// ---- Mark played ----

/** Marks an episode finished (it leaves the queue, as finishing it does) or unplayed (back to the start). Only this person's own record changes. */
export function setPlayed(person: PersonRow, mediaId: unknown, on: unknown): Outcome<{ on: boolean; label: "Marked played" | "Marked unplayed" }> {
  const item = typeof mediaId === "string" ? readableIn(person, "podcasts", mediaId) : null;
  if (!item) return { ok: false, status: 404, error: "That episode is not in your podcasts. Open Episodes and try again." };
  const want = !(on === false || on === "false");
  const current = getProgress(person.id, item.id);
  const duration = item.duration_s ?? current?.duration_s ?? null;
  const result = writeProgress(person, item, {
    position: { seconds: want ? duration ?? (current && "seconds" in current.position ? current.position.seconds : 0) : 0 },
    duration_s: duration, completed: want, stamp: correctedStamp({ serverNow: new Date() }),
  }, { immediate: true });
  if (!result.ok) return { ok: false, status: 422, error: "That episode could not be updated. Try again." };
  if (want) {
    const queue = resolveCollection(person.id, "queue");
    if (queue?.items.some((entry) => entry.media_id === item.id)) removeItemFrom(queue, item.id);
  }
  return { ok: true, value: { on: want, label: want ? "Marked played" : "Marked unplayed" } };
}
