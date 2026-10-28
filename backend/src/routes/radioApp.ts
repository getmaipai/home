// RADIO-02 / RADIO-04: the Radio routes under /api/plugins/music/radio. The directory (popular, search) is a network lookup that only
// an adult, or a teen, may start, and only while the household switch is on; a child plays what a parent saved and nothing else.
// A minor's search words pass the household-name check before they leave the home (PRIVACY.md); a teen is never shown a station
// tagged as adult content. Saved stations are `media-source` records of kind station (lib/media/radio.ts).
import type { Context } from "hono";
import { mediaAppAllowed } from "@/lib/media/appHost";
import { mediaBandOf } from "@/lib/media/band";
import { addStation, directoryRowsFor, listSavedStations, removeStation } from "@/lib/media/radio";
import { findStations, radioDirectoryAllowed } from "@/lib/media/radioDirectory";
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
      name: str(body.name), url: str(body.url), favicon: typeof body.favicon === "string" ? body.favicon : null, tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
      country_code: typeof body.country_code === "string" ? body.country_code : null, codec: typeof body.codec === "string" ? body.codec : null,
      bitrate_kbps: typeof body.bitrate_kbps === "number" ? body.bitrate_kbps : null, for_person_id: typeof body.for_person_id === "string" ? body.for_person_id : null, fromDirectory,
    });
    return result.ok ? c.json({ ok: true as const, station: result.value, label: "Added to Your stations" }, 200) : c.json({ error: result.error }, result.status as 400);
  });

  routes.delete("/stations/:id", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "music")) return next();
    const result = removeStation(person, c.req.param("id"));
    return result.ok ? c.json({ ok: true as const }, 200) : c.json({ error: result.error }, result.status as 404);
  });

  return routes;
}
