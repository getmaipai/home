// RADIO-02 / RADIO-04: the Radio routes under /api/plugins/music/radio. The directory (popular, search) is a network lookup that only
// an adult, or a teen, may start, and only while the household switch is on; a child plays what a parent saved and nothing else.
// A minor's search words pass the household-name check before they leave the home (PRIVACY.md); a teen is never shown a station
// tagged as adult content. Saved stations are `media-source` records of kind station (lib/media/radio.ts).
import type { Context } from "hono";
import type { PersonRow } from "@/types";
import { mediaAppAllowed } from "@/lib/media/appHost";
import { mediaBandOf } from "@/lib/media/band";
import { addStation, directoryRowsFor, listSavedStations, removeStation, savedStationFor, type SavedStation } from "@/lib/media/radio";
import { nowPlayingOf, openStationStream, type StreamDeps } from "@/lib/media/radioStream";
import { findStations, radioDirectoryAllowed, type DirectoryStation } from "@/lib/media/radioDirectory";
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

// RADIO-02 (Radio pages): the rows the schema pages bind. Art is left out on purpose: station pictures live on other hosts and the page
// may load same-origin images only (CSP img-src 'self'), so the tiles show the kit's placeholder until a proxy is built.
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

const subtitleOf = (station: { country_code: string | null; tags: string[]; hls: boolean }): string =>
  station.hls ? "Not supported yet" : [countryName(station.country_code), station.tags.slice(0, 2).join(", ")].filter(Boolean).join(" · ");

export type RadioRow = { id: string; kind: "station"; title: string; summary: string; thumbnail: null; url: string; favicon: string; tags_csv: string; country_code: string; codec: string; bitrate_kbps: string; action_label: string };
const rowOf = (station: DirectoryStation | SavedStation, label: string): RadioRow => ({
  id: station.id, kind: "station", title: station.name, summary: subtitleOf(station), thumbnail: null, url: station.url, favicon: station.favicon ?? "", tags_csv: station.tags.join(","),
  country_code: station.country_code ?? "", codec: station.codec ?? "", bitrate_kbps: station.bitrate_kbps === null ? "" : String(station.bitrate_kbps), action_label: label,
});

/** Saved stations for the page: a child sees exactly what a parent saved for them. */
export const radioSavedRows = (person: PersonRow): RadioRow[] => listSavedStations(person).map((station) => rowOf(station, "Remove"));

/** Find rows for the page. Off, a child, an adult-tag filter or a down directory all give an empty list (the page says so), never an error. */
export async function radioDirectoryRows(person: PersonRow, query: { q: string; country: string; tag: string }): Promise<RadioRow[]> {
  const band = mediaBandOf(person);
  if (!radioDirectoryAllowed({ band }, getHouseholdSettingValue("radio.directory.enabled") === true)) return [];
  const any = (value: string) => (value === "all" ? "" : value.trim());
  const name = query.q.trim(), country = any(query.country), tag = any(query.tag);
  if (minorQueryHit([name, tag].filter(Boolean).join(" "), band)) return [];
  const result = name === "" && country === "" && tag === "" ? await findStations({ kind: "popular" }) : await findStations({ kind: "search", name, country, tag });
  return result.ok ? directoryRowsFor(person, result.stations).map((station) => rowOf(station, station.added ? "Added" : "Add")) : [];
}

let streamDeps: StreamDeps = {};
/** Tests point the station fetch at an injected upstream; production uses the pinned guarded fetch. */
export function __setRadioStreamDepsForTests(deps: StreamDeps): void { streamDeps = deps; }

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
    if (minorQueryHit([name, tag].filter(Boolean).join(" "), band)) return c.json({ ok: true as const, stations: [], note: MINOR_QUERY_PERSONAL_NOTE }, 200);
    const result = await findStations({ kind: "search", name, country, tag });
    return result.ok ? c.json({ ok: true as const, stations: directoryRowsFor(person, result.stations) }, 200) : c.json({ error: result.error }, result.status);
  });

  routes.get("/stations", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    return c.json({ ok: true as const, stations: listSavedStations(person) }, 200);
  });

  routes.post("/stations", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    const body = await bodyOf(c);
    const fromDirectory = body.from === "directory";
    // Adding a directory row is part of the directory: the same switch and band decide. Adding by name and address is not a lookup,
    // so it needs no switch, but a child still cannot do it (a parent names the child as the target).
    if (fromDirectory && !gate(c).allowed) return c.json({ error: NOT_ON }, 403);
    const result = addStation(person, {
      name: str(body.name), url: str(body.url), favicon: typeof body.favicon === "string" && body.favicon !== "" ? body.favicon : null, tags: Array.isArray(body.tags) ? (body.tags as string[]) : typeof body.tags === "string" ? body.tags.split(",") : [],
      country_code: typeof body.country_code === "string" && body.country_code !== "" ? body.country_code : null, codec: typeof body.codec === "string" && body.codec !== "" ? body.codec : null,
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
    const opened = await openStationStream(person.id, station, streamDeps, c.req.raw.signal);
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
