// MEDIA-PODCASTS-01: the Podcasts routes that sit beside the shared media-app ones (data, progress, queue). Everything under
// /api/plugins/podcasts; adults and admins only where noted. The shows an admin follows live in `feeds` (purpose podcast) and `media_sources`.
import type { Context } from "hono";
import { readableIn } from "@/lib/media/appHost";
import { correctedStamp, getProgress, writeProgress } from "@/lib/media/progress";
import { coerceNumber, mediaAppAllowed } from "@/lib/media/appHost";
import { queuePodcastAutoRules, exportOpml, getPodcastTranscript, importOpml, pollPodcastNow, saveEpisode, searchPodcastTranscripts, subscribePodcast, unsaveEpisode, unsubscribePodcast, updatePodcastSource } from "@/lib/media/podcasts";
import { apiRouter } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import type { PersonRow } from "@/types";
import { mediaBandOf } from "@/lib/media/band";
import { getHouseholdSettingValue } from "@/lib/settings";
import { MINOR_QUERY_PERSONAL_NOTE, minorQueryHit } from "@/lib/retrieval/minorQueryCheck";
import { deleteCollection, resolveCollection } from "@/lib/media/collections";
import { personFilters, saveFilter, viewOf } from "@/lib/media/podcastFilters";
import { artProxyAddress, directoryAllowed, fetchDirectoryArt, searchDirectory, topShows } from "@/lib/media/podcastDirectory";

type Body = Record<string, unknown>;
const bodyOf = async (c: Context): Promise<Body> => {
  const parsed = await c.req.raw.json().catch(() => ({}));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Body) : {};
};
const fail = (c: Context, result: { status: number; error: string }) => c.json({ error: result.error }, result.status as 400);

type DirectoryRow = { id: string; title: string; summary: string; thumbnail: string | null; feed_url: string };

/** The Find shows rows for the page's shelf: the search when words are typed, else Apple's top list. Not allowed, or no answer, is an empty list (the page says so). */
export async function podcastDirectoryRows(person: PersonRow, q: string): Promise<DirectoryRow[]> {
  const band = mediaBandOf(person);
  if (!directoryAllowed({ band }, { enabled: getHouseholdSettingValue("podcasts.directory.enabled") === true, teens: getHouseholdSettingValue("podcasts.directory.teens") === true })) return [];
  const words = q.trim();
  if (words !== "" && minorQueryHit(words, band)) return [];
  const result = words === "" ? await topShows() : await searchDirectory(words);
  if (!result.ok) return [];
  return result.shows.map((show) => ({ id: show.id, title: show.title, summary: [show.author, show.genre].filter(Boolean).join(" · "), thumbnail: artProxyAddress(show.art), feed_url: show.feed_url }));
}

export function podcastRoutes() {
  const routes = apiRouter();

  routes.get("/transcript/:media_id", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "podcasts")) return next();
    const result = await getPodcastTranscript(person, c.req.param("media_id"));
    return result.ok ? c.json({ ok: true as const, ...result.value }, 200) : fail(c, result);
  });

  routes.get("/transcripts/search", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "podcasts")) return next();
    const query = (c.req.query("q") ?? "").trim().slice(0, 120);
    return c.json({ ok: true as const, hits: searchPodcastTranscripts(person, query) }, 200);
  });

  routes.post("/save", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "podcasts")) return next();
    const body = await bodyOf(c);
    const id = typeof body.media_id === "string" ? body.media_id : "";
    if (!readableIn(person, "podcasts", id)) return c.json({ error: "That episode is not in your podcasts." }, 404);
    const off = body.on === false || body.on === "false";
    const result = off ? unsaveEpisode(person, id) : await saveEpisode(person, id);
    return result.ok ? c.json({ ok: true as const, on: !off, label: off ? "Not saved" : "Saved" }, 200) : fail(c, result);
  });

  routes.post("/bookmark", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "podcasts")) return next();
    const body = await bodyOf(c);
    const item = typeof body.media_id === "string" ? readableIn(person, "podcasts", body.media_id) : null;
    if (!item) return c.json({ error: "That episode is not in your podcasts." }, 404);
    const current = getProgress(person.id, item.id);
    const here = current && "seconds" in current.position ? current.position.seconds : 0;
    const at = coerceNumber(body.at_s) ?? here;
    const label = typeof body.label === "string" && body.label.trim() !== "" ? body.label.trim().slice(0, 120) : null;
    const now = new Date();
    const outcome = writeProgress(person, item, { position: current?.position ?? { seconds: at }, marks: [{ at_s: Math.max(0, Math.round(at)), label }], stamp: correctedStamp({ serverNow: now }) }, { now, immediate: true });
    return outcome.ok ? c.json({ ok: true as const, at_s: Math.max(0, Math.round(at)), label: "Bookmarked" }, 200) : c.json({ error: "That place could not be saved." }, 422);
  });

  routes.post("/subscribe", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "podcasts")) return next();
    const body = await bodyOf(c);
    const result = subscribePodcast(person, { url: typeof body.url === "string" ? body.url : "", visibleTo: Array.isArray(body.visible_to) ? (body.visible_to as string[]) : "household" });
    if (!result.ok) return fail(c, result);
    void pollPodcastNow(result.value.feed.id);
    return c.json({ ok: true as const, source_id: result.value.source.id, label: "Added to Shows" }, 200);
  });

  routes.post("/unsubscribe", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "podcasts")) return next();
    const body = await bodyOf(c);
    const result = unsubscribePodcast(person, typeof body.source_id === "string" ? body.source_id : "");
    return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
  });

  routes.post("/source", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "podcasts")) return next();
    const body = await bodyOf(c);
    const auto = body.auto && typeof body.auto === "object" ? (body.auto as Body) : undefined;
    const result = updatePodcastSource(person, typeof body.source_id === "string" ? body.source_id : "", {
      ...(body.speed !== undefined ? { speed: body.speed === null ? null : coerceNumber(body.speed) ?? NaN } : {}),
      ...(body.skip_intro_s !== undefined ? { skip_intro_s: coerceNumber(body.skip_intro_s) ?? NaN } : {}),
      ...(body.skip_outro_s !== undefined ? { skip_outro_s: coerceNumber(body.skip_outro_s) ?? NaN } : {}),
      ...(typeof body.paused === "boolean" ? { paused: body.paused } : {}),
      ...(body.visible_to === "household" || Array.isArray(body.visible_to) ? { visible_to: body.visible_to as "household" | string[] } : {}),
      ...(auto ? { auto: { ...(auto.save === "none" || auto.save === "audio" ? { save: auto.save } : {}), ...(auto.keep_latest !== undefined ? { keep_latest: auto.keep_latest === null ? null : coerceNumber(auto.keep_latest) ?? NaN } : {}), ...(typeof auto.remove_watched === "boolean" ? { remove_watched: auto.remove_watched } : {}) } } : {}),
    });
    if (!result.ok) return fail(c, result);
    // A changed keep rule takes effect now, not at the next poll.
    if (auto) queuePodcastAutoRules(result.value.id);
    return c.json({ ok: true as const }, 200);
  });

  // PODCAST-PORT-03: saved episode filters, each the person's own private media-collection of kind filter. A filter only narrows the
  // episodes the person can already read, so the child and band gates are the Episodes page's own.
  routes.get("/filters", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "podcasts")) return next();
    return c.json({ ok: true as const, filters: personFilters(person).map((collection) => viewOf(person, collection)) }, 200);
  });

  routes.post("/filters", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "podcasts")) return next();
    const result = saveFilter(person, await bodyOf(c));
    return result.ok ? c.json({ ok: true as const, filter: result.filter, label: "Filter saved" }, 200) : fail(c, result);
  });

  routes.delete("/filters/:id", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "podcasts")) return next();
    const own = resolveCollection(person.id, c.req.param("id"));
    if (!own || own.kind !== "filter") return c.json({ error: "That filter is not yours or no longer exists. Reload the page." }, 404);
    deleteCollection(own);
    return c.json({ ok: true as const, label: "Filter deleted" }, 200);
  });

  routes.post("/opml/import", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "podcasts")) return next();
    const body = await bodyOf(c);
    const result = importOpml(person, typeof body.opml === "string" ? body.opml : "");
    if (!result.ok) return fail(c, result);
    // createFeed marks every imported feed due. The normal tick takes at most ten.
    return c.json({ ok: true as const, added: result.value.added, already: result.value.already, skipped: result.value.skipped }, 200);
  });

  routes.get("/opml/export", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, "podcasts")) return next();
    if (person.role !== "owner" && person.role !== "admin") return c.json({ error: "Only an admin can export the show list." }, 403);
    return new Response(exportOpml(), { status: 200, headers: { "content-type": "text/x-opml; charset=utf-8", "content-disposition": 'attachment; filename="podcasts.opml"', "cache-control": "no-store" } });
  });

  // PODCAST-PORT-01: finding new shows. Off until the household switch is on; adults, teens only with their own switch, never a child.
  // A minor's search words pass the household-name check before they leave the home (PRIVACY.md).
  const directoryGate = (c: Context) => {
    const person = c.get("person");
    const band = mediaBandOf(person);
    const allowed = directoryAllowed({ band }, { enabled: getHouseholdSettingValue("podcasts.directory.enabled") === true, teens: getHouseholdSettingValue("podcasts.directory.teens") === true });
    return { person, band, allowed };
  };
  const NOT_ON = "Finding new podcasts is not turned on for you. Ask the person who runs this home.";

  routes.get("/directory/search", requireAuth, async (c, next) => {
    if (!mediaAppAllowed(c.get("person"), "podcasts")) return next();
    const { band, allowed } = directoryGate(c);
    if (!allowed) return c.json({ error: NOT_ON }, 403);
    const q = (c.req.query("q") ?? "").trim();
    if (minorQueryHit(q, band)) return c.json({ ok: true as const, shows: [], note: MINOR_QUERY_PERSONAL_NOTE }, 200);
    const result = await searchDirectory(q);
    return result.ok ? c.json({ ok: true as const, shows: result.shows }, 200) : c.json({ error: result.error }, result.status);
  });

  routes.get("/directory/top", requireAuth, async (c, next) => {
    if (!mediaAppAllowed(c.get("person"), "podcasts")) return next();
    if (!directoryGate(c).allowed) return c.json({ error: NOT_ON }, 403);
    const result = await topShows();
    return result.ok ? c.json({ ok: true as const, shows: result.shows }, 200) : c.json({ error: result.error }, result.status);
  });

  routes.get("/directory/art", requireAuth, async (c, next) => {
    if (!mediaAppAllowed(c.get("person"), "podcasts")) return next();
    if (!directoryGate(c).allowed) return c.body(null, 403);
    const art = await fetchDirectoryArt(c.req.query("u") ?? "");
    if (!art) return c.body(null, 404);
    return new Response(art.bytes, { status: 200, headers: { "content-type": art.type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'", "cross-origin-resource-policy": "same-origin" } });
  });

  return routes;
}
