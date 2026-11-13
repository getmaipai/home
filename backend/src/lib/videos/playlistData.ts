// MEDIA-PARITY-02 (Videos): the data the new Videos pages bind. The package manifest is at the spec's cap of 16 data ids, so these answer by `scope` on two
// existing ids: `library` (playlists, playlist, playlist-header, playlist-people, shared-playlists, new-playlist, suggest) and `channels` (strip).
// Everything reads the household's own library and made clips through the same gates as the rest of the app; nothing here makes a request.
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";
import type { MediaCollection } from "@/lib/media/model";
import { artworkUrl, madeFiles, queryItems, type DataParams, type MediaRow } from "@/lib/media/appHost";
import { titleMatch } from "@/lib/media/textMatch";
import { mediaBandOf, trips } from "@/lib/media/band";
import { memberVideoPlaylists, ownVideoPlaylists, playlistEntryRows, videoMemberCandidates, videoPlaylistFor, videoPlaylistVisibility } from "./playlists";

export const SUGGEST_MAX = 8;
export const SUGGEST_MIN_CHARS = 2;

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

function tile(person: PersonRow, collection: MediaCollection): MediaRow & Record<string, unknown> {
  const rows = playlistEntryRows(person, collection);
  const first = rows[0];
  const owner = collection.person_id === person.id ? null : db.select({ name: people.displayName }).from(people).where(eq(people.id, collection.person_id)).get()?.name ?? null;
  return {
    id: collection.id, title: collection.title, channel: `${count(rows.length, "video")}${owner ? `, by ${owner}` : ""}`, summary: "", kind: "video",
    thumbnail: first?.thumbnail ?? null, backdrop: first?.thumbnail ?? null, duration_s: null, copy_label: owner ? "Shared" : "Saved",
  };
}

function header(person: PersonRow, id: string): unknown[] {
  const found = videoPlaylistFor(person, id);
  if (!found) return [];
  const { collection } = found;
  const rows = playlistEntryRows(person, collection);
  const owner = db.select().from(people).where(eq(people.id, collection.person_id)).get();
  return [{
    id: collection.id, title: collection.title, play_id: rows[0]?.id ?? "", share_id: encodeURIComponent(collection.id),
    creator: { name: owner?.displayName ?? "Someone" }, art: rows[0]?.thumbnail ?? null, meta: `Playlist · ${count(rows.length, "video")}`,
    visibility: videoPlaylistVisibility(person, collection), candidates: videoMemberCandidates(person, collection), made_at: collection.created_at,
  }];
}

/** Suggestions for the search field: the household's own video titles, channel names and made clips that match the typed words, best matches first.
 * Per person (their own gates), never more than SUGGEST_MAX, and nothing under SUGGEST_MIN_CHARS characters. */
export function videoSuggestions(person: PersonRow, query: string | undefined): Array<{ key: string; label: string }> {
  const needle = (query ?? "").trim().toLocaleLowerCase();
  if (needle.length < SUGGEST_MIN_CHARS) return [];
  const labels: string[] = [];
  const minor = mediaBandOf(person) !== "adult";
  for (const item of queryItems(person, "video", { where: titleMatch(needle), limit: 30 })) labels.push(item.title);
  for (const item of queryItems(person, "video", { limit: 500 })) if (item.subtitle) labels.push(item.subtitle);
  for (const file of madeFiles(person, "video")) labels.push(file.name);
  const seen = new Set<string>();
  const fits = labels.filter((label) => {
    const lower = label.toLocaleLowerCase();
    if (!lower.includes(needle) || seen.has(lower) || (minor && trips(label))) return false;
    seen.add(lower);
    return true;
  });
  const rank = (label: string) => (label.toLocaleLowerCase().startsWith(needle) ? 0 : 1);
  return fits.sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b)).slice(0, SUGGEST_MAX).map((label) => ({ key: label.toLocaleLowerCase(), label }));
}

/** The household's channels as avatar tiles: the name, how many videos, and the newest video's picture as the avatar. */
export function channelStrip(person: PersonRow): Array<MediaRow & Record<string, unknown>> {
  const byChannel = new Map<string, { count: number; art: string | null }>();
  for (const item of queryItems(person, "video", { limit: 500 })) {
    if (!item.subtitle) continue;
    const entry = byChannel.get(item.subtitle) ?? { count: 0, art: null };
    entry.count += 1;
    entry.art ??= artworkUrl(item);
    byChannel.set(item.subtitle, entry);
  }
  return [...byChannel].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => ({
    id: name, title: name, channel: count(entry.count, "video"), summary: "", kind: "video" as const, thumbnail: entry.art, backdrop: entry.art, avatar: entry.art, duration_s: null, copy_label: "Saved",
  }));
}

/** Adds `channel_avatar` (the channel's picture) to rows that name a channel the person can open; any other answer is returned as it came. */
export function withChannelAvatars<T>(person: PersonRow, answer: T): T {
  if (!Array.isArray(answer) || answer.length === 0) return answer;
  const rows = answer as Array<Record<string, unknown>>;
  if (!rows.every((row) => row && typeof row === "object" && typeof row.id === "string" && "title" in row)) return answer;
  const art = new Map(channelStrip(person).map((row) => [row.id, row.avatar as string | null]));
  return rows.map((row) => (typeof row.channel === "string" && art.get(row.channel) ? { ...row, channel_avatar: art.get(row.channel) } : row)) as T;
}

/** The scoped answers; null when the request is not one of them, so the ordinary data ids answer. */
export function videoScopedData(person: PersonRow, dataId: string, params: DataParams): unknown | null {
  if (dataId === "channels" && params.scope === "strip") return channelStrip(person);
  if (dataId !== "library" || !params.scope) return null;
  switch (params.scope) {
    case "playlists": return ownVideoPlaylists(person).map((c) => tile(person, c));
    case "shared-playlists": return memberVideoPlaylists(person).map((c) => tile(person, c));
    case "new-playlist": return [{ id: "new", title: "New playlist", channel: "Start an empty playlist", summary: "", kind: "video", thumbnail: null, backdrop: null, duration_s: null, copy_label: "Saved" }];
    case "playlist": { const found = params.id ? videoPlaylistFor(person, params.id) : null; return found ? playlistEntryRows(person, found.collection) : []; }
    case "playlist-header": return header(person, params.id ?? "");
    case "playlist-people": { const found = params.id ? videoPlaylistFor(person, params.id) : null; return found ? videoMemberCandidates(person, found.collection) : []; }
    case "suggest": return videoSuggestions(person, params.query);
    default: return null;
  }
}
