// RADIO-02 / RADIO-04: saved radio stations. A station is a `media-source` record of kind `station` (spec-v0.1.261): the name is
// `label`, the stream address is `url`, the rest of what the directory told us is `station`. Every station is scope person: the
// owner is the person who listens, so a child's list is exactly what a parent saved for them (a child never adds one). A minor
// never gets a station tagged adult content, in the directory rows or the saved list (the same check at both doors).
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mediaSources, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newMediaSourceId } from "@/lib/id";
import { checkFeedAddress } from "@/lib/shelf/feedAddresses";
import type { PersonRow } from "@/types";
import { isMediaAdmin, sourceVisibleTo } from "./access";
import { mediaBandOf } from "./band";
import { sourceFromRow, sourcesFromRows, type MediaSource } from "./model";
import { removeSource } from "./sources";
import type { DirectoryStation } from "./radioDirectory";

export type RadioOutcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 409; error: string };

const ADULT_TAG = /adult|porn|xxx|erotic/i;
/** Whether any tag marks the station as adult content. */
export const adultTagged = (tags: readonly string[]): boolean => tags.some((tag) => ADULT_TAG.test(tag));

/** A teen or child never sees an adult-tagged station (a guest reads as a child). */
export function stationVisibleAtBand(actor: PersonRow, tags: readonly string[]): boolean {
  return mediaBandOf(actor) === "adult" || !adultTagged(tags);
}

const hlsAddress = (url: string): boolean => /\.m3u8(\?|$)/i.test(url);
const sameAddress = (a: string, b: string): boolean => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

export interface SavedStation {
  id: string;
  name: string;
  url: string;
  favicon: string | null;
  tags: string[];
  country_code: string | null;
  codec: string | null;
  bitrate_kbps: number | null;
  /** HLS playlists are stored but not playable yet (RADIO-06): the page says "not supported yet". */
  hls: boolean;
  /** The person this station is saved for. */
  for_person_id: string | null;
  added_by_person_id: string | null;
}

function savedOf(source: MediaSource): SavedStation | null {
  if (source.kind !== "station" || !source.url) return null;
  const detail = source.station;
  return {
    id: source.id, name: source.label, url: source.url, favicon: detail?.favicon_url ?? null, tags: detail?.tags ?? [], country_code: detail?.country_code ?? null,
    codec: detail?.codec ?? null, bitrate_kbps: detail?.bitrate_kbps ?? null, hls: hlsAddress(source.url), for_person_id: source.owner_person_id,
    added_by_person_id: source.provenance.startsWith("person:") ? source.provenance.slice("person:".length) : null,
  };
}

/** The stations saved for a person: their own (a child's are the ones a parent saved), minus adult-tagged ones for a minor. */
export function listSavedStations(actor: PersonRow): SavedStation[] {
  const rows = db.select().from(mediaSources).where(and(eq(mediaSources.kind, "station"), isNull(mediaSources.deletedAt))).all();
  return sourcesFromRows(rows)
    .filter((source) => sourceVisibleTo(source, actor) && source.owner_person_id === actor.id)
    .map(savedOf)
    .filter((station): station is SavedStation => station !== null && stationVisibleAtBand(actor, station.tags))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One saved station the person may play: their own (a child's are the ones a parent saved), never an adult-tagged one for a minor. */
export const savedStationFor = (actor: PersonRow, id: string): SavedStation | null => listSavedStations(actor).find((station) => station.id === id) ?? null;

/** The player's item for a saved station (RADIO-03): it plays from the hub's stream route and has no length, so the bar says Live. */
export function stationItemView(actor: PersonRow, id: string, nowPlaying: string | null): Record<string, unknown> | null {
  const station = savedStationFor(actor, id);
  if (!station) return null;
  const detail = [station.country_code, station.tags.slice(0, 2).join(", ")].filter(Boolean).join(" · ");
  return {
    id: station.id, kind: "station", title: station.name, channel: station.name, subtitle: nowPlaying ?? (detail || "Live radio"), src: `/api/plugins/music/radio/stream/${encodeURIComponent(station.id)}`,
    live: true, poster: null, description: "", chapters: [], captions: [], liked: false, watch_later: false, can_edit: false, cover_choices: [],
  };
}

/** The addresses a person already has, for the `added` flag on directory rows. */
export const savedAddressesOf = (actor: PersonRow): string[] => listSavedStations(actor).map((station) => station.url);

/** Directory rows for this person: adult-tagged stations are dropped for a minor, and each row says whether it is already saved. */
export function directoryRowsFor(actor: PersonRow, stations: readonly DirectoryStation[]): Array<DirectoryStation & { added: boolean }> {
  const saved = savedAddressesOf(actor);
  return stations
    .filter((station) => stationVisibleAtBand(actor, station.tags))
    .map((station) => ({ ...station, added: saved.some((address) => sameAddress(address, station.url)) }));
}

export interface AddStationInput {
  name: string;
  url: string;
  favicon?: string | null;
  tags?: string[];
  country_code?: string | null;
  codec?: string | null;
  bitrate_kbps?: number | null;
  /** The person the station is for. Omitted means the actor; a parent names one of the household's children. */
  for_person_id?: string | null;
  /** True when the row came from the directory (the address may be http, as the directory lists it). */
  fromDirectory?: boolean;
}

/** The person a station is saved for: the actor, or (a parent only) a child of the household. A child never adds one. */
function targetOf(actor: PersonRow, forId: string | null | undefined): RadioOutcome<PersonRow> {
  if (!forId || forId === actor.id) {
    if (mediaBandOf(actor) === "child") return { ok: false, status: 403, error: "A parent saves radio stations for you. Ask a parent to add one." };
    return { ok: true, value: actor };
  }
  const target = db.select().from(people).where(eq(people.id, forId)).get() as PersonRow | undefined;
  if (!target || target.role !== "child") return { ok: false, status: 403, error: "A parent can save stations for their own children only. Pick one of the children in this home." };
  if (!isMediaAdmin(actor) || mediaBandOf(actor) !== "adult") return { ok: false, status: 403, error: "Only a parent can save a station for a child." };
  return { ok: true, value: target };
}

const cleanTags = (tags: unknown): string[] =>
  Array.isArray(tags) ? [...new Set(tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== "" && tag.length <= 40))].slice(0, 8) : [];

export function addStation(actor: PersonRow, input: AddStationInput, nowIso = new Date().toISOString()): RadioOutcome<SavedStation> {
  const target = targetOf(actor, input.for_person_id);
  if (!target.ok) return target;
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (name === "") return { ok: false, status: 400, error: "Give the station a name, such as Cabin FM." };
  const address = input.url.trim();
  // The shelf's address guard: https, no login in the address, no device inside the home network. A directory row may list plain http,
  // so it is checked as its https twin and stored as the directory gave it.
  const checked = checkFeedAddress(input.fromDirectory ? address.replace(/^http:\/\//i, "https://") : address);
  if (!checked.ok) return { ok: false, status: 400, error: input.fromDirectory ? "That station's address points inside your home network or is not a web address, so it cannot be added." : "Use the station's public stream address, starting with https://. A device inside your home network cannot be added." };
  const url = input.fromDirectory && /^http:\/\//i.test(address) ? address : checked.url;
  const tags = cleanTags(input.tags);
  if (mediaBandOf(target.value) !== "adult" && adultTagged(tags)) return { ok: false, status: 403, error: "That station is marked for adults, so it cannot be saved for a teen or a child." };
  if (listSavedStations(target.value).some((station) => sameAddress(station.url, url))) return { ok: false, status: 409, error: "That station is already in the list. Open Your stations to play it." };
  const favicon = typeof input.favicon === "string" && /^https:\/\//i.test(input.favicon) ? input.favicon : null;
  const country = typeof input.country_code === "string" && /^[A-Z]{2}$/.test(input.country_code) ? input.country_code : null;
  const bitrate = typeof input.bitrate_kbps === "number" && Number.isInteger(input.bitrate_kbps) && input.bitrate_kbps >= 0 ? input.bitrate_kbps : null;
  const id = newMediaSourceId();
  db.insert(mediaSources).values({
    id, kind: "station", scope: "person", ownerPersonId: target.value.id, label: name, url,
    station: JSON.stringify({ live: true, favicon_url: favicon, tags, country_code: country, codec: typeof input.codec === "string" && input.codec.trim() !== "" ? input.codec.trim() : null, bitrate_kbps: bitrate }),
    visibleTo: JSON.stringify([target.value.id]), createdAt: nowIso, hlc: nextHlc(), provenance: `person:${actor.id}`,
  }).run();
  return { ok: true, value: savedOf(sourceFromRow(db.select().from(mediaSources).where(eq(mediaSources.id, id)).get()!))! };
}

/** A person removes their own station; a parent also removes one saved for a child. A child cannot remove (the list is the parent's). */
export function removeStation(actor: PersonRow, id: string): RadioOutcome<{ id: string }> {
  const row = db.select().from(mediaSources).where(and(eq(mediaSources.id, id), eq(mediaSources.kind, "station"), isNull(mediaSources.deletedAt))).get();
  const notFound = { ok: false, status: 404, error: "That station is not in your list." } as const;
  if (!row || !row.ownerPersonId) return notFound;
  if (row.ownerPersonId === actor.id) {
    if (mediaBandOf(actor) === "child") return { ok: false, status: 403, error: "A parent changes your radio stations. Ask a parent." };
  } else {
    const owner = db.select().from(people).where(eq(people.id, row.ownerPersonId)).get();
    if (!owner || owner.role !== "child" || !isMediaAdmin(actor) || mediaBandOf(actor) !== "adult") return notFound;
  }
  removeSource(id);
  return { ok: true, value: { id } };
}
