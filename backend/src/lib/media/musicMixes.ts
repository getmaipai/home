// Music's Listen now extras: a time-of-day greeting and "made for you" shelves. Everything is built from this person's own
// play counts and the library they may already read (musicLibrary applies the usual source, band and explicit gates);
// nothing is fetched, and a child or guest (noDiscovery) gets no mixes and no most-played list.
import type { PersonRow } from "@/types";
import { getSettingValueForPerson } from "@/lib/settings";
import { validTimeZone, wallClockParts } from "@/lib/wallClock";
import { hubTimeZone } from "@/lib/news/dayParts";
import { noDiscovery } from "./access";
import { albumKey, artistKey, groupTracks } from "./music";
import { recentProgress } from "./progress";
import { albumTile, itemsInOrder, musicLibrary, rowsOf, trackRows } from "./appHost";
import type { MediaItem } from "./model";

const MAX_MIXES = 4;
const MOST_PLAYED = 10;
const JUMP_BACK = 8;
const DAYLIST_SIZE = 12;
const DAYLIST_MIN = 3;
const REPLAY_SIZE = 25;
const YEAR_MS = 365 * 24 * 3600 * 1000;

/** Same boundaries as Home's greeting (before 12 morning, before 17 afternoon), read in the person's own time zone. */
export function musicGreeting(person: PersonRow, now: Date = new Date(), zone?: string): { id: string; title: string; channel: string; summary: string; kind: "track"; thumbnail: null; backdrop: null; duration_s: null; copy_label: string } {
  const setting = getSettingValueForPerson(person.id, "time.time_zone");
  const hour = wallClockParts(now, zone ?? (validTimeZone(setting) ? setting : hubTimeZone())).hour;
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return { id: "greeting", title: `Good ${part}, ${person.displayName}`, channel: "Here is some music for you.", summary: "", kind: "track", thumbnail: null, backdrop: null, duration_s: null, copy_label: "" };
}

/** Own play weight by song id: every song with a progress row counts at least once (as the artist Popular list does), more for repeat plays or finishes. */
function ownPlays(person: PersonRow): Map<string, number> {
  return new Map(recentProgress(person.id, 1000).map((progress) => [progress.media_id, Math.max(progress.plays, progress.finishes, 1)]));
}

function jumpBackIn(person: PersonRow) {
  const groups = groupTracks(musicLibrary(person), "album");
  const keys: string[] = [];
  for (const item of itemsInOrder(person, "audio", recentProgress(person.id, 120).map((progress) => progress.media_id), 60)) {
    const key = albumKey(item);
    if (!keys.includes(key) && groups.has(key)) keys.push(key);
  }
  return keys.slice(0, JUMP_BACK).map((key) => albumTile(person, key, groups.get(key)!));
}

function mostPlayed(person: PersonRow) {
  if (noDiscovery(person)) return [];
  const plays = ownPlays(person);
  const ranked = musicLibrary(person).filter((item) => plays.has(item.id)).sort((a, b) => plays.get(b.id)! - plays.get(a.id)! || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, MOST_PLAYED);
  return trackRows(person, ranked);
}

/** Up to four radio mixes, alternating the top genre and top artist by this person's own plays. */
function madeForYou(person: PersonRow) {
  if (noDiscovery(person)) return [];
  const plays = ownPlays(person);
  const played = musicLibrary(person).filter((item) => plays.has(item.id));
  const rank = (keyOf: (item: MediaItem) => string | null) => {
    const groups = new Map<string, MediaItem[]>();
    for (const item of played) {
      const key = keyOf(item);
      if (key) groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const total = (items: readonly MediaItem[]) => items.reduce((sum, item) => sum + plays.get(item.id)!, 0);
    return [...groups].sort((a, b) => total(b[1]) - total(a[1]) || a[0].localeCompare(b[0])).map(([key, items]) => ({ key, items }));
  };
  const genres = rank((item) => item.genre?.trim() || null).map((entry) => ({ ...entry, label: entry.key, seed: "genre" }));
  const artists = rank((item) => artistKey(item)).map((entry) => ({ ...entry, label: entry.key, seed: "artist" }));
  const order: typeof genres = [];
  for (let i = 0; i < Math.max(genres.length, artists.length); i++) { if (genres[i]) order.push(genres[i]!); if (artists[i]) order.push(artists[i]!); }
  return order.slice(0, MAX_MIXES).map((entry) => {
    const top = [...entry.items].sort((a, b) => plays.get(b.id)! - plays.get(a.id)! || a.id.localeCompare(b.id));
    const cover = top.find((item) => item.artwork) ?? top[0]!;
    return { ...rowsOf(person, [cover])[0]!, id: `radio:${entry.seed}:${entry.key}`, title: `${entry.label} mix`, channel: null, kind: "track" as const, queue_mode: "radio" };
  });
}

type DayPart = "morning" | "afternoon" | "evening" | "night";
function dayPartOf(hour: number): DayPart {
  return hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 22 ? "evening" : "night";
}

/**
 * A "Daylist": the songs this person tends to play at this time of day, ranked by their own plays. A song counts toward a part of the
 * day by the hour (in their own time zone) it was last played. Needs a few songs to feel like a mix; none for a child or guest.
 */
export function daylistRows(person: PersonRow, now: Date = new Date(), zone?: string) {
  if (noDiscovery(person)) return [];
  const setting = getSettingValueForPerson(person.id, "time.time_zone");
  const tz = zone ?? (validTimeZone(setting) ? setting : hubTimeZone());
  const part = dayPartOf(wallClockParts(now, tz).hour);
  const inPart = new Set(recentProgress(person.id, 1000).filter((progress) => dayPartOf(wallClockParts(new Date(progress.updated_at), tz).hour) === part).map((progress) => progress.media_id));
  const plays = ownPlays(person);
  const ranked = musicLibrary(person).filter((item) => inPart.has(item.id)).sort((a, b) => plays.get(b.id)! - plays.get(a.id)! || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, DAYLIST_SIZE);
  return ranked.length >= DAYLIST_MIN ? trackRows(person, ranked) : [];
}

/** A "Replay": the songs this person played most over the past year, from their own play counts only; none for a child or guest. */
export function replayRows(person: PersonRow, now: Date = new Date()) {
  if (noDiscovery(person)) return [];
  const since = now.getTime() - YEAR_MS;
  const recent = new Set(recentProgress(person.id, 1000).filter((progress) => Date.parse(progress.updated_at) >= since).map((progress) => progress.media_id));
  const plays = ownPlays(person);
  const ranked = musicLibrary(person).filter((item) => recent.has(item.id)).sort((a, b) => plays.get(b.id)! - plays.get(a.id)! || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, REPLAY_SIZE);
  return trackRows(person, ranked);
}

/** The Listen now rows, asked as the history data with one of these scopes (the manifest has no room for another data id). */
export const MIX_SCOPES = ["greeting", "jump-back", "most-played", "made", "daylist", "replay"] as const;
export function musicMixData(person: PersonRow, scope: string | undefined): unknown[] | null {
  if (scope === "greeting") return [musicGreeting(person)];
  if (scope === "jump-back") return jumpBackIn(person);
  if (scope === "most-played") return mostPlayed(person);
  if (scope === "made") return madeForYou(person);
  if (scope === "daylist") return daylistRows(person);
  if (scope === "replay") return replayRows(person);
  return null;
}
