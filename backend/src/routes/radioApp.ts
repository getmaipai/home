// RADIO-02 / RADIO-04: the Radio routes under /api/plugins/music/radio. The directory (popular, search) is a network lookup that only
// an adult, or a teen, may start, and only while the household switch is on; a child plays what a parent saved and nothing else.
// A minor's search words pass the household-name check before they leave the home (PRIVACY.md); a teen is never shown a station
// tagged as adult content. Saved stations are `media-source` records of kind station (lib/media/radio.ts).
import type { Context } from "hono";
import type { PersonRow } from "@/types";
import { mediaAppAllowed } from "@/lib/media/appHost";
import { mediaBandOf } from "@/lib/media/band";
import { addStation, directoryRowsFor, listSavedStations, removeStation, savedStationFor, stationVisibleAtBand, type SavedStation } from "@/lib/media/radio";
import { nowPlayingOf, openStationStream, type StreamDeps } from "@/lib/media/radioStream";
import { decodeHlsResource, openHlsResource } from "@/lib/media/radioHls";
import { findStations, radioDirectoryAllowed, radioDirectoryHasFavicon, rememberPreviewStations, previewStationFor, type DirectoryStation } from "@/lib/media/radioDirectory";
import { checkFeedAddress } from "@/lib/shelf/feedAddresses";
import { assertNotPrivateHost } from "@maipai/core/src/ssrfGuard";
import { fetchRadioArt } from "@/lib/media/radioArt";
import { radioRecordingRows, startRadioRecording, stopRadioRecording } from "@/lib/media/radioRecordings";
import { MINOR_QUERY_PERSONAL_NOTE, minorQueryHit } from "@/lib/retrieval/minorQueryCheck";
import { getHouseholdSettingValue } from "@/lib/settings";
import { apiRouter } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";

type Body = Record<string, unknown>;
const bodyOf = async (c: Context): Promise<Body> => {
  const parsed = await c.req.raw.json().catch(() => ({}));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Body) : {};
};
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const NOT_ON = "Finding radio stations is not turned on for you. Ask the person who runs this home.";

// RADIO-02 (Radio pages): station art is allowlisted and served from Home.
const COUNTRIES: ReadonlyArray<readonly [string, string]> = [
  ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"], ["IE", "Ireland"], ["DE", "Germany"], ["FR", "France"],
  ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"], ["SE", "Sweden"], ["NO", "Norway"], ["BR", "Brazil"], ["MX", "Mexico"], ["AR", "Argentina"],
  ["JP", "Japan"], ["IN", "India"], ["ZA", "South Africa"], ["NZ", "New Zealand"], ["PL", "Poland"],
];
const GENRES = ["jazz", "rock", "pop", "classical", "country", "electronic", "hip hop", "news", "talk", "ambient", "blues", "folk", "metal", "oldies", "reggae", "sports"];
const countryName = (code: string | null): string => (code ? (COUNTRIES.find(([c]) => c === code)?.[1] ?? code) : "");

/** Pick lists for the filters, as picker rows. */
export const radioCountryRows = () => COUNTRIES.map(([id, label]) => ({ id, label }));
export const radioGenreRows = () => GENRES.map((genre) => ({ id: genre, label: genre.replace(/^./, (ch) => ch.toUpperCase()) }));

const subtitleOf = (station: { country_code: string | null; tags: string[] }): string =>
  [countryName(station.country_code), station.tags.slice(0, 2).join(", ")].filter(Boolean).join(" · ");

export type RadioRow = { id: string; kind: "station"; title: string; summary: string; thumbnail: string | null; url: string; preview_url?: string; favicon: string; tags_csv: string; country_code: string; codec: string; bitrate_kbps: string; language: string; homepage: string; action_label: string };
const rowOf = (station: DirectoryStation | SavedStation, label: string): RadioRow => ({
  id: station.id, kind: "station", title: station.name, summary: [subtitleOf(station), station.bitrate_kbps ? `${station.bitrate_kbps} kbps` : "", station.codec?.toUpperCase() ?? ""].filter(Boolean).join(" · "), thumbnail: station.favicon ? `/api/plugins/music/radio/art?u=${encodeURIComponent(station.favicon)}&n=${encodeURIComponent(station.name)}` : `/api/plugins/music/radio/card?n=${encodeURIComponent(station.name)}`, url: station.url, favicon: station.favicon ?? "", tags_csv: station.tags.join(","),
  country_code: station.country_code ?? "", codec: station.codec ?? "", bitrate_kbps: station.bitrate_kbps === null ? "" : String(station.bitrate_kbps), language: "language" in station && station.language ? station.language : "", homepage: "homepage" in station && station.homepage ? station.homepage : "", action_label: label,
});

/** Saved stations for the page: a child sees exactly what a parent saved for them. */
export const radioSavedRows = (person: PersonRow): RadioRow[] => listSavedStations(person).map((station) => ({ ...rowOf(station, "Remove"), action_label: "Remove" }));

/** Station page data resolves saved stations first, then only directory stations recently shown to this household. */
export function radioStationRow(person: PersonRow, id: string): (RadioRow & { description: string; saved: boolean; homepage: string; play_label: string; remove_label: string; record_label: string }) | null {
  const saved = listSavedStations(person).find((station) => station.id === id);
  const station = saved ?? previewStationFor("household", id);
  if (!station || !stationVisibleAtBand(person, station.tags)) return null;
  const facts = [countryName(station.country_code), "language" in station ? station.language : null, station.codec?.toUpperCase() ?? "", station.bitrate_kbps ? `${station.bitrate_kbps} kbps` : "", station.tags.join(", "), "homepage" in station ? station.homepage : null].filter((part): part is string => typeof part === "string" && part !== "").join(" · ");
  const homepage = "homepage" in station && typeof station.homepage === "string" ? station.homepage : "";
  return { ...rowOf(station, saved ? "Remove" : "Add to Your stations"), summary: facts, description: facts ? `Live radio from ${facts}.` : "Live radio station.", saved: !!saved, homepage, action_label: saved ? "Added to Your stations" : "Add to Your stations", play_label: saved ? "Play" : "Preview", remove_label: saved ? "Remove" : "", record_label: saved ? "Record" : "" };
}

/** Find rows for the page. Off, a child, an adult-tag filter or a down directory all give an empty list (the page says so), never an error. */
export type RadioScope = "directory" | "popular" | "genre-rock" | "genre-jazz" | "genre-chill" | "genre-classical" | "genre-news" | "genre-hip-hop" | "world-us" | "world-gb" | "world-jp";
const SCOPE_QUERY: Partial<Record<RadioScope, { kind: "popular" } | { kind: "search"; tag?: string; country?: string }>> = {
  popular: { kind: "popular" }, "genre-rock": { kind: "search", tag: "rock" }, "genre-jazz": { kind: "search", tag: "jazz" },
  "genre-chill": { kind: "search", tag: "chill" }, "genre-classical": { kind: "search", tag: "classical" }, "genre-news": { kind: "search", tag: "news" },
  "genre-hip-hop": { kind: "search", tag: "hip hop" }, "world-us": { kind: "search", country: "US" }, "world-gb": { kind: "search", country: "GB" }, "world-jp": { kind: "search", country: "JP" },
};
export async function radioDirectoryRows(person: PersonRow, query: { q: string; country: string; tag: string; scope?: RadioScope }): Promise<RadioRow[]> {
  const band = mediaBandOf(person);
  if (/^https?:\/\//i.test(query.q.trim())) {
    const band = mediaBandOf(person);
    if (band !== "adult") return [];
    const checked = checkFeedAddress(query.q.trim());
    if (!checked.ok) return [];
    return [{ id: "address", kind: "station", title: "Add this address", summary: checked.url, thumbnail: null, url: checked.url, favicon: "", tags_csv: "", country_code: "", codec: "", bitrate_kbps: "", language: "", homepage: "", action_label: "Add" }];
  }
  if (!radioDirectoryAllowed({ band }, getHouseholdSettingValue("radio.directory.enabled") === true)) return [];
  const any = (value: string) => (value === "all" ? "" : value.trim());
  const scopeQuery = query.scope && query.scope !== "directory" ? SCOPE_QUERY[query.scope] : undefined;
  const name = query.q.trim(), country = any(query.country), tag = any(query.tag);
  if (minorQueryHit([name, tag].filter(Boolean).join(" "), band)) return [];
  if (query.scope === "directory" && name === "" && country === "" && tag === "") return [];
  const result = scopeQuery ? await findStations(scopeQuery) : name === "" && country === "" && tag === "" ? await findStations({ kind: "popular" }) : await findStations({ kind: "search", name, country, tag });
  if (!result.ok) return [];
  rememberPreviewStations("household", result.stations);
  return directoryRowsFor(person, result.stations).map((station) => ({ ...rowOf(station, station.added ? "Added" : "Add"), preview_url: `/api/plugins/music/radio/preview/${encodeURIComponent(station.id)}` }));
}

let streamDeps: StreamDeps = {};
/** Tests point the station fetch at an injected upstream; production uses the pinned guarded fetch. */
export function __setRadioStreamDepsForTests(deps: StreamDeps): void { streamDeps = deps; }
export function radioAddressDeps(): StreamDeps { return streamDeps; }

export function radioRoutes() {
  const routes = apiRouter();

  const gate = (c: Context) => {
    const person = c.get("person");
    return { person, allowed: radioDirectoryAllowed({ band: mediaBandOf(person) }, getHouseholdSettingValue("radio.directory.enabled") === true) };
  };

  routes.get("/popular", requireAuth, async (c, next) => {
    if (!mediaAppAllowed(c.get("person"), "music")) return next();
    const { person, allowed } = gate(c);
    if (!allowed) return c.json({ error: NOT_ON }, 403);
    const result = await findStations({ kind: "popular" });
    if (result.ok) rememberPreviewStations("household", result.stations);
    return result.ok ? c.json({ ok: true as const, stations: directoryRowsFor(person, result.stations) }, 200) : c.json({ error: result.error }, result.status);
  });

  routes.get("/search", requireAuth, async (c, next) => {
    if (!mediaAppAllowed(c.get("person"), "music")) return next();
    const { person, allowed } = gate(c);
    if (!allowed) return c.json({ error: NOT_ON }, 403);
    const band = mediaBandOf(person);
    const name = (c.req.query("q") ?? "").trim();
    const country = (c.req.query("country") ?? "").trim();
    const tag = (c.req.query("tag") ?? "").trim();
    if (/^https?:\/\//i.test(name)) {
      if (band !== "adult") return c.json({ ok: true as const, stations: [] }, 200);
      const checked = checkFeedAddress(name);
      if (!checked.ok) return c.json({ ok: true as const, stations: [] }, 200);
      return c.json({ ok: true as const, stations: [{ id: "address", name: "Add this address", url: checked.url, tags: [], favicon: null }] }, 200);
    }
    if (minorQueryHit([name, tag].filter(Boolean).join(" "), band)) return c.json({ ok: true as const, stations: [], note: MINOR_QUERY_PERSONAL_NOTE }, 200);
    const result = await findStations({ kind: "search", name, country, tag });
    if (result.ok) rememberPreviewStations("household", result.stations);
    return result.ok ? c.json({ ok: true as const, stations: directoryRowsFor(person, result.stations) }, 200) : c.json({ error: result.error }, result.status);
  });

  routes.get("/stations", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    return c.json({ ok: true as const, stations: listSavedStations(person) }, 200);
  });

  routes.post("/recordings/:id/start", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    const station = savedStationFor(person, c.req.param("id"));
    if (!station) return c.json({ error: "That station is not in your list." }, 404);
    const result = await startRadioRecording(person, station, str((await bodyOf(c)).length));
    return result.ok ? c.json(result.value, 200) : c.json({ error: result.error }, result.status);
  });

  routes.post("/recordings/:id/stop", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    const result = await stopRadioRecording(person, c.req.param("id"));
    return result.ok ? c.json(result.value, 200) : c.json({ error: result.error }, result.status);
  });

  routes.post("/stations", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    const body = await bodyOf(c);
    const fromDirectory = body.from === "directory";
    // Adding a directory row is part of the directory: the same switch and band decide. Adding by name and address is not a lookup,
    // so it needs no switch, but a child still cannot do it (a parent names the child as the target).
    if (fromDirectory && !gate(c).allowed) return c.json({ error: NOT_ON }, 403);
    if (!fromDirectory && !body.for_person_id && str(body.name) === "Add this address") {
      if (mediaBandOf(person) !== "adult") return c.json({ error: "Only an adult can add a station by address." }, 403);
      const checked = checkFeedAddress(str(body.url));
      if (!checked.ok) return c.json({ error: "Use a public https stream address." }, 400);
      try { await assertNotPrivateHost(new URL(checked.url).hostname); } catch { return c.json({ error: "That station address points to a private device, so it cannot be added." }, 400); }
    }
    const result = addStation(person, {
      name: str(body.name), url: str(body.url), favicon: typeof body.favicon === "string" && body.favicon !== "" ? body.favicon : null, tags: Array.isArray(body.tags) ? (body.tags as string[]) : typeof body.tags === "string" ? body.tags.split(",") : [],
      country_code: typeof body.country_code === "string" && body.country_code !== "" ? body.country_code : null, codec: typeof body.codec === "string" && body.codec !== "" ? body.codec : null,
      language: typeof body.language === "string" ? body.language : null, homepage: typeof body.homepage === "string" ? body.homepage : null,
      bitrate_kbps: typeof body.bitrate_kbps === "number" ? body.bitrate_kbps : typeof body.bitrate_kbps === "string" && /^\d+$/.test(body.bitrate_kbps) ? Number(body.bitrate_kbps) : null, for_person_id: typeof body.for_person_id === "string" ? body.for_person_id : null, fromDirectory,
    });
    return result.ok ? c.json({ ok: true as const, station: result.value, label: "Added to Your stations" }, 200) : c.json({ error: result.error }, result.status as 400);
  });

  // RADIO-03: playing a saved station. Same-origin audio; the person's own saved list decides what plays (a child: what a parent saved),
  // so no directory switch is needed and an unsaved id is a 404. A station address never comes from the request.
  routes.get("/stream/:id", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    const station = savedStationFor(person, c.req.param("id"));
    if (!station) return c.json({ error: "That station is not in your list. Open Radio and pick one of Your stations." }, 404);
    if (station.hls) {
      const opened = await openHlsResource(person.id, station, station.url, streamDeps, c.req.raw.signal);
      return opened.ok ? opened.response : c.json({ error: opened.error }, opened.status);
    }
    const opened = await openStationStream(person.id, station, streamDeps, c.req.raw.signal);
    return opened.ok ? opened.response : c.json({ error: opened.error }, opened.status);
  });

  routes.get("/preview/:id", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    if (!radioDirectoryAllowed({ band: mediaBandOf(person) }, getHouseholdSettingValue("radio.directory.enabled") === true)) return c.json({ error: NOT_ON }, 403);
    const station = previewStationFor("household", c.req.param("id"));
    if (!station || (mediaBandOf(person) !== "adult" && /adult|porn|xxx|erotic/i.test(station.tags.join(" ")))) return c.json({ error: "That preview is no longer available. Find the station again." }, 404);
    const opened = station.hls
      ? await openHlsResource(person.id, { ...station, for_person_id: null, added_by_person_id: null }, station.url, streamDeps, c.req.raw.signal)
      : await openStationStream(person.id, { ...station, for_person_id: null, added_by_person_id: null }, streamDeps, c.req.raw.signal);
    return opened.ok ? opened.response : c.json({ error: opened.error }, opened.status);
  });
  routes.post("/preview", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    if (!radioDirectoryAllowed({ band: mediaBandOf(person) }, getHouseholdSettingValue("radio.directory.enabled") === true)) return c.json({ error: NOT_ON }, 403);
    const id = str((await bodyOf(c)).id);
    const station = previewStationFor("household", id);
    if (!station || (mediaBandOf(person) !== "adult" && /adult|porn|xxx|erotic/i.test(station.tags.join(" ")))) return c.json({ error: "That preview is no longer available. Find the station again." }, 404);
    const opened = station.hls
      ? await openHlsResource(person.id, { ...station, for_person_id: null, added_by_person_id: null }, station.url, streamDeps, c.req.raw.signal)
      : await openStationStream(person.id, { ...station, for_person_id: null, added_by_person_id: null }, streamDeps, c.req.raw.signal);
    return opened.ok ? opened.response : c.json({ error: opened.error }, opened.status);
  });

  // RADIO-06: playlists and segment bytes remain same-origin. The token is a URL rewritten into a playlist; the route
  // still resolves a saved station first, then the proxy checks every destination and redirect hop.
  routes.get("/hls/:id/resource/:token", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    const id = c.req.param("id");
    const saved = savedStationFor(person, id);
    const preview = !saved && radioDirectoryAllowed({ band: mediaBandOf(person) }, getHouseholdSettingValue("radio.directory.enabled") === true) ? previewStationFor("household", id) : null;
    const station = saved ?? (preview && (mediaBandOf(person) === "adult" || !/adult|porn|xxx|erotic/i.test(preview.tags.join(" "))) ? { ...preview, for_person_id: null, added_by_person_id: null } : null);
    if (!station) return c.json({ error: "That station is not in your list. Open Radio and pick one of Your stations." }, 404);
    const address = decodeHlsResource(c.req.param("token"));
    if (!address) return c.json({ error: "That playlist resource is not available." }, 404);
    const opened = await openHlsResource(person.id, station, address, streamDeps, c.req.raw.signal);
    return opened.ok ? opened.response : c.json({ error: opened.error }, opened.status);
  });

  // The song the station says is on now, kept in memory while a stream is open. Same gate as the stream; nothing is stored.
  routes.get("/now/:id", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    const station = savedStationFor(person, c.req.param("id"));
    if (!station) return c.json({ error: "That station is not in your list. Open Radio and pick one of Your stations." }, 404);
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true as const, title: nowPlayingOf(station.id) }, 200);
  });

  routes.delete("/stations/:id", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    const result = removeStation(person, c.req.param("id"));
    return result.ok ? c.json({ ok: true as const }, 200) : c.json({ error: result.error }, result.status as 404);
  });

  return routes;
}
