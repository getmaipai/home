// MEDIA-PODCASTS-01: the Podcasts routes that sit beside the shared media-app ones (data, progress, queue). Everything under
// /api/plugins/podcasts; adults and admins only where noted. The shows an admin follows live in `feeds` (purpose podcast) and `media_sources`.
import type { Context } from "hono";
import { allowedSources, queryItems, readableIn } from "@/lib/media/appHost";
import { correctedStamp, getProgress, writeProgress } from "@/lib/media/progress";
import { coerceNumber } from "@/lib/media/appHost";
import { queuePodcastAutoRules, getPodcastTranscript, pollPodcastNow, saveEpisode, subscribePodcast, unsaveEpisode, updatePodcastSource } from "@/lib/media/podcasts";
import { jsonBody } from "@/lib/validation";
import { gateMediaApp } from "@/middleware/mediaAppGate";
import { apiRouter, refuseWith } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import type { PersonRow } from "@/types";
import { mediaBandOf } from "@/lib/media/band";
import { getHouseholdSettingValue } from "@/lib/settings";
import { minorQueryHit } from "@/lib/retrieval/minorQueryCheck";
import { deleteCollection, resolveCollection } from "@/lib/media/collections";
import { personFilters, saveFilter, viewOf } from "@/lib/media/podcastFilters";
import { artProxyAddress, directoryAllowed, fetchDirectoryArt, searchDirectory, topShows, directoryShowForFeed } from "@/lib/media/podcastDirectory";
import { podcastSnipLabel, podcastSnipRowsForRoute } from "@/lib/media/podcastApp";
import { previewEpisodeAddress, previewPodcastFeed } from "@/lib/media/podcasts";
import { guardedFetch, type DnsLookup } from "@maipai/core/src/ssrfGuard";
import { lookup } from "node:dns/promises";
import { mediaItems } from "@/db/schema";
import { mediaSources, mediaProductions } from "@/db/schema";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { isOwnerOrAdmin } from "@/lib/access";


type DirectoryRow = { id: string; title: string; author: string; summary: string; thumbnail: string | null; feed_url: string; action_label?: string };

/** The Find shows rows for the page's shelf: the search when words are typed, else Apple's top list. Not allowed, or no answer, is an empty list (the page says so). */
export async function podcastDirectoryRows(person: PersonRow, q: string, scope = "search"): Promise<DirectoryRow[]> {
  const band = mediaBandOf(person);
  const allowed = directoryAllowed({ band }, { enabled: getHouseholdSettingValue("podcasts.directory.enabled") === true, teens: getHouseholdSettingValue("podcasts.directory.teens") === true });
  const words = q.trim();
  const admin = (isOwnerOrAdmin(person)) && band === "adult";
  const local = words.length >= 2 ? queryItems(person, "podcasts", { limit: 200 }).filter((item) => `${item.title} ${item.subtitle ?? ""} ${item.description ?? ""}`.toLocaleLowerCase().includes(words.toLocaleLowerCase())).slice(0, 12).map((item) => ({ id: item.id, title: item.title, author: item.subtitle ?? "", summary: item.description ?? "", thumbnail: item.artwork ? `/api/media/items/${encodeURIComponent(item.id)}/art` : null, feed_url: "", ...(admin ? { action_label: "Listen" } : {}) })) : [];
  if (scope === "search" && words === "") return [];
  if (!allowed || words !== "" && minorQueryHit(words, band)) return local;
  const result = scope === "top" ? await topShows() : words !== "" ? await searchDirectory(words) : { ok: true as const, shows: [] };
  if (!result.ok) return local;
  const directory = result.shows.map((show) => ({ id: show.id, title: show.title, author: show.author, summary: show.genre ?? "", thumbnail: artProxyAddress(show.art), feed_url: show.feed_url, ...(admin ? { action_label: "Follow" } : {}) }));
  return [...local, ...directory];
}

/** One existing directory data id serves both directory previews and followed show details. */
export async function podcastShowRows(person: PersonRow, id: string, scope: string): Promise<unknown[]> {
  const adult = mediaBandOf(person) === "adult";
  const canFollow = adult && isOwnerOrAdmin(person);
  const source = allowedSources(person).find((row) => row.id === id && (row.kind === "feed" || row.kind === "production"));
  if (source) {
    const items = queryItems(person, "podcasts", { where: eq(mediaItems.sourceId, source.id), limit: 200 }).sort((a, b) => (b.external?.published_at ?? "").localeCompare(a.external?.published_at ?? ""));
    const first = items[0];
    const production = source.kind === "production" && source.production_id ? db.select().from(mediaProductions).where(eq(mediaProductions.id, source.production_id)).get() : null;
    const show = production?.show ? JSON.parse(production.show) as { schedule?: { every: string; at: string } | null; state?: { stage?: string } | null } : null;
    const scheduleLabel = show?.schedule ? ` · ${show.schedule.every === "1d" ? "Daily" : "Weekly"} at ${show.schedule.at}` : "";
    return [{ id: source.id, title: source.label, author: source.kind === "production" ? "Made here" : first?.artist ?? "", genre: first?.genre ?? "", description: `${source.kind === "production" ? `Made here${scheduleLabel}` : first?.description ?? ""}`, thumbnail: first ? `/api/media/items/${encodeURIComponent(first.id)}/art` : null, followed: true, can_follow: source.kind === "feed" && canFollow, feed_url: source.url ?? "", ...(source.kind === "production" ? { production_id: source.production_id, stage: show?.state?.stage ?? null, action_label: production?.ownerPersonId === person.id ? show?.state?.stage && show.state.stage !== "done" ? "Making today's episode" : "Make today's episode" : undefined } : {}) }];
  }
  if (mediaBandOf(person) === "child") return [];
  const address = id;
  if (!directoryShowForFeed(address)) return [];
  const result = await previewPodcastFeed(person, address);
  if (!result.ok) return [];
  const show = result.value.show;
  const directory = directoryShowForFeed(address);
  return [{ id: address, title: show.title || directory?.title, author: show.author || directory?.author, genre: directory?.genre ?? "", description: show.description, thumbnail: directory?.art ? artProxyAddress(directory.art) : null, followed: false, can_follow: canFollow, feed_url: address }];
}

function podcastDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export async function podcastShowEpisodeRows(person: PersonRow, id: string): Promise<unknown[]> {
  const source = allowedSources(person).find((row) => row.id === id && (row.kind === "feed" || row.kind === "production"));
  if (source) {
    const items = queryItems(person, "podcasts", { where: eq(mediaItems.sourceId, source.id), limit: 200 }).sort((a, b) => (b.external?.published_at ?? "").localeCompare(a.external?.published_at ?? ""));
    const showArt = items[0]?.artwork ? `/api/media/items/${encodeURIComponent(items[0].id)}/art` : null;
    return items.map((item) => ({ id: item.id, title: item.title, summary: source.kind === "production" ? item.added_at.slice(0, 10) : podcastDate(item.external?.published_at), description: item.description?.slice(0, 140) ?? "", date: source.kind === "production" ? item.added_at.slice(0, 10) : podcastDate(item.external?.published_at), duration_s: item.duration_s, thumbnail: item.artwork ? `/api/media/items/${encodeURIComponent(item.id)}/art` : showArt, followed: true, ...(source.kind === "production" ? { action_label: "Made here" } : {}) }));
  }
  if (mediaBandOf(person) === "child" || !directoryShowForFeed(id)) return [];
  const result = await previewPodcastFeed(person, id);
  if (!result.ok) return [];
  const directory = directoryShowForFeed(id);
  const artwork = directory?.art ? artProxyAddress(directory.art) : null;
  return result.value.show.episodes.map((episode, index) => ({ id: `${encodeURIComponent(id)}#${index}`, title: episode.title, summary: podcastDate(episode.publishedAt), description: episode.description.slice(0, 140), date: podcastDate(episode.publishedAt), duration_s: episode.durationS, thumbnail: artwork, followed: false, kind: "podcast_episode" }));
}

export function podcastRoutes() {
  const routes = apiRouter();
  gateMediaApp(routes, "podcasts", ["/data/directory", "/preview/*", "/transcript/*", "/save", "/bookmark", "/snips", "/subscribe", "/source", "/filters", "/filters/*", "/directory/*", "/shows", "/shows/*"]);

  // TALENT-04: the package's own doors to the show maker (a package page may only call routes under /api/plugins/podcasts/).
  routes.post("/shows", requireAuth, async (c) => {
    const person = c.get("person");
    const body = await jsonBody(c);
    try {
      const { createShow } = await import("@/lib/talent/shows");
      const { createShowSchema } = await import("@/routes/talent");
      const input = createShowSchema.parse(body) as import("@/lib/talent/shows").CreateShowInput;
      return c.json(await createShow(person, input), 201);
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : "The show could not be created. Check its fields and try again." }, 400); }
  });
  routes.post("/shows/:id/episodes", requireAuth, async (c) => {
    const person = c.get("person");
    const { getShow, makeEpisode } = await import("@/lib/talent/shows");
    const production = getShow(person, c.req.param("id"));
    if (!production || production.owner_person_id !== person.id) return c.json({ error: "That show is not available to you. Open one of your shows and try again." }, 404);
    if (production.show?.state?.started_at && Date.now() - Date.parse(production.show.state.started_at) < 7_200_000 && production.show.state.stage !== "done") return c.json({ error: "An episode is being made right now. Wait for it to finish." }, 409);
    void makeEpisode(person, production.id).catch(() => {});
    return c.json({ production_id: production.id, stage: production.show?.state?.stage ?? "brief" }, 202);
  });

  routes.post("/data/directory", requireAuth, async (c, next) => {
    const person = c.get("person");
    const body = await jsonBody(c);
    return c.json(await podcastDirectoryRows(person, typeof body.q === "string" ? body.q : "", typeof body.scope === "string" ? body.scope : "search"), 200);
  });

  /** A host that answers on both address families is reached over IPv4 first: a home network with no working IPv6 route would otherwise fail on the first (IPv6) address. */
const lookupPreferringV4: DnsLookup = async (hostname) => {
  try { const found = await lookup(hostname, { family: 4 }); return { address: found.address, family: 4 }; } catch { const found = await lookup(hostname); return { address: found.address, family: found.family as 4 | 6 }; }
};

// Playing an episode of a show the person has not followed: the bytes pass through here (every redirect hop checked), so the player
  // keeps to same-origin addresses. Range requests pass on, so seeking works. Nothing is stored.
  routes.get("/preview/:id", requireAuth, async (c, next) => {
    const person = c.get("person");
    const address = previewEpisodeAddress(person, c.req.param("id"));
    if (!address) return c.json({ error: "That episode is no longer available. Open the show again." }, 404);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10000);
    c.req.raw.signal.addEventListener("abort", () => abort.abort(), { once: true });
    try {
      const range = c.req.header("range");
      const upstream = await guardedFetch(address, { method: "GET", headers: { "User-Agent": "MaiPai-Home", Accept: "audio/*", ...(range ? { Range: range } : {}) }, signal: abort.signal, maxRedirects: 5 }, lookupPreferringV4);
      clearTimeout(timer);
      const type = (upstream.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if ((upstream.status !== 200 && upstream.status !== 206) || !(type.startsWith("audio/") || type === "application/octet-stream" || type === "video/mp4")) { upstream.body?.cancel().catch(() => {}); return c.json({ error: "The show did not give this episode. Try again later." }, 502); }
      const headers = new Headers({ "content-type": type === "application/octet-stream" ? "audio/mpeg" : type, "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin" });
      for (const name of ["content-length", "content-range"]) { const value = upstream.headers.get(name); if (value) headers.set(name, value); }
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch {
      clearTimeout(timer);
      return c.json({ error: "The show did not answer. Try again later." }, 502);
    }
  });

  routes.get("/transcript/:media_id", requireAuth, async (c, next) => {
    const person = c.get("person");
    const result = await getPodcastTranscript(person, c.req.param("media_id"));
    return result.ok ? c.json({ ok: true as const, ...result.value }, 200) : refuseWith(c, result);
  });

  routes.post("/save", requireAuth, async (c, next) => {
    const person = c.get("person");
    const body = await jsonBody(c);
    const id = typeof body.media_id === "string" ? body.media_id : "";
    if (!readableIn(person, "podcasts", id)) return c.json({ error: "That episode is not in your podcasts." }, 404);
    const off = body.on === false || body.on === "false";
    const result = off ? unsaveEpisode(person, id) : await saveEpisode(person, id);
    return result.ok ? c.json({ ok: true as const, on: !off, label: off ? "Not saved" : "Saved" }, 200) : refuseWith(c, result);
  });

  routes.post("/bookmark", requireAuth, async (c, next) => {
    const person = c.get("person");
    const body = await jsonBody(c);
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

  routes.post("/snips", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (mediaBandOf(person) === "child") return c.json({ error: "Snips are not available for child accounts." }, 403);
    const body = await jsonBody(c);
    const item = typeof body.media_id === "string" ? readableIn(person, "podcasts", body.media_id) : null;
    if (!item) return c.json({ error: "That episode is not in your podcasts." }, 404);
    const at = coerceNumber(body.start_s);
    const length = coerceNumber(body.length_s);
    if (at === null || at === undefined || at < 0 || length === null || length === undefined || !Number.isInteger(length) || length < 5 || length > 60) return c.json({ error: "Choose a start time and a clip length from 5 to 60 seconds." }, 400);
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length > 280) return c.json({ error: "A snip note can be up to 280 characters." }, 400);
    const current = getProgress(person.id, item.id);
    const mark = { at_s: Math.round(at), label: podcastSnipLabel(length, note) };
    const outcome = writeProgress(person, item, { position: current?.position ?? { seconds: at }, marks: [mark], stamp: correctedStamp({ serverNow: new Date() }) }, { immediate: true });
    return outcome.ok ? c.json({ ok: true, start_s: mark.at_s, length_s: length, note }, 201) : c.json({ error: "That snip could not be saved." }, 422);
  });

  routes.get("/snips", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (mediaBandOf(person) === "child") return c.json({ error: "Snips are not available for child accounts." }, 403);
    return c.json({ ok: true, rows: podcastSnipRowsForRoute(person) }, 200);
  });

  routes.delete("/snips", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (mediaBandOf(person) === "child") return c.json({ error: "Snips are not available for child accounts." }, 403);
    const body = await jsonBody(c);
    const mediaId = typeof body.media_id === "string" ? body.media_id : "";
    const at = coerceNumber(body.start_s);
    const label = typeof body.snip_label === "string" ? body.snip_label : "";
    const item = readableIn(person, "podcasts", mediaId);
    if (!item || at === null || at === undefined) return c.json({ error: "That snip is not yours or no longer exists." }, 404);
    const current = getProgress(person.id, item.id);
    const mark = current?.marks.find((candidate) => candidate.at_s === at && candidate.label?.startsWith("podcast-snip:") && (!label || candidate.label === label));
    if (!current || !mark) return c.json({ error: "That snip is not yours or no longer exists." }, 404);
    const outcome = writeProgress(person, item, { position: current.position, marks: [{ at_s: mark.at_s, label: `podcast-snip:deleted:${encodeURIComponent(mark.label ?? "")}` }], stamp: correctedStamp({ serverNow: new Date() }) }, { immediate: true });
    return outcome.ok ? c.json({ ok: true }, 200) : c.json({ error: "That snip could not be deleted." }, 422);
  });

  routes.post("/subscribe", requireAuth, async (c, next) => {
    const person = c.get("person");
    const body = await jsonBody(c);
    const result = subscribePodcast(person, { url: typeof body.url === "string" ? body.url : "", visibleTo: Array.isArray(body.visible_to) ? (body.visible_to as string[]) : "household" });
    if (!result.ok) return refuseWith(c, result);
    void pollPodcastNow(result.value.feed.id);
    return c.json({ ok: true as const, source_id: result.value.source.id, label: "Added to Shows" }, 200);
  });

  routes.post("/source", requireAuth, async (c, next) => {
    const person = c.get("person");
    const body = await jsonBody(c);
    const auto = body.auto && typeof body.auto === "object" ? (body.auto as Record<string, unknown>) : undefined;
    const result = updatePodcastSource(person, typeof body.source_id === "string" ? body.source_id : "", {
      ...(body.speed !== undefined ? { speed: body.speed === null ? null : coerceNumber(body.speed) ?? NaN } : {}),
      ...(body.skip_intro_s !== undefined ? { skip_intro_s: coerceNumber(body.skip_intro_s) ?? NaN } : {}),
      ...(body.skip_outro_s !== undefined ? { skip_outro_s: coerceNumber(body.skip_outro_s) ?? NaN } : {}),
      ...(typeof body.paused === "boolean" ? { paused: body.paused } : {}),
      ...(body.visible_to === "household" || Array.isArray(body.visible_to) ? { visible_to: body.visible_to as "household" | string[] } : {}),
      ...(auto ? { auto: { ...(auto.save === "none" || auto.save === "audio" ? { save: auto.save } : {}), ...(auto.keep_latest !== undefined ? { keep_latest: auto.keep_latest === null ? null : coerceNumber(auto.keep_latest) ?? NaN } : {}), ...(typeof auto.remove_watched === "boolean" ? { remove_watched: auto.remove_watched } : {}) } } : {}),
    });
    if (!result.ok) return refuseWith(c, result);
    // A changed keep rule takes effect now, not at the next poll.
    if (auto) queuePodcastAutoRules(result.value.id);
    return c.json({ ok: true as const }, 200);
  });

  // PODCAST-PORT-03: saved episode filters, each the person's own private media-collection of kind filter. A filter only narrows the
  // episodes the person can already read, so the child and band gates are the Episodes page's own.
  routes.get("/filters", requireAuth, async (c, next) => {
    const person = c.get("person");
    return c.json({ ok: true as const, filters: personFilters(person).map((collection) => viewOf(person, collection)) }, 200);
  });

  routes.post("/filters", requireAuth, async (c, next) => {
    const person = c.get("person");
    const result = saveFilter(person, await jsonBody(c));
    return result.ok ? c.json({ ok: true as const, filter: result.filter, label: "Filter saved" }, 200) : refuseWith(c, result);
  });

  routes.delete("/filters/:id", requireAuth, async (c, next) => {
    const person = c.get("person");
    const own = resolveCollection(person.id, c.req.param("id"));
    if (!own || own.kind !== "filter") return c.json({ error: "That filter is not yours or no longer exists. Reload the page." }, 404);
    deleteCollection(own);
    return c.json({ ok: true as const, label: "Filter deleted" }, 200);
  });

  // PODCAST-PORT-01: finding new shows. Adults, teens only with their own switch, never a child; the search itself runs through the
  // Find shows rows (`/data/directory`), which apply the same gate and the minor's household-name check (PRIVACY.md).
  const directoryOn = (c: Context): boolean => directoryAllowed({ band: mediaBandOf(c.get("person")) }, { enabled: getHouseholdSettingValue("podcasts.directory.enabled") === true, teens: getHouseholdSettingValue("podcasts.directory.teens") === true });

  routes.post("/directory/add", requireAuth, async (c, next) => {
    const body = await jsonBody(c);
    const result = subscribePodcast(c.get("person"), { url: typeof body.url === "string" ? body.url : "" });
    if (!result.ok) return refuseWith(c, result);
    void pollPodcastNow(result.value.feed.id);
    return c.json({ ok: true as const, source_id: result.value.source.id, label: "Added to Shows" }, 200);
  });

  routes.get("/directory/art", requireAuth, async (c, next) => {
    if (!directoryOn(c)) return c.body(null, 403);
    const art = await fetchDirectoryArt(c.req.query("u") ?? "");
    if (!art) return c.body(null, 404);
    return new Response(art.bytes, { status: 200, headers: { "content-type": art.type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'", "cross-origin-resource-policy": "same-origin" } });
  });

  return routes;
}
