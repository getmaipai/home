// MEDIA-VIDEOS-01: the route factory every media app mounts under /api/plugins/<appId>, ahead of the generic
// `POST /:id/data/:dataId` in routes/plugins.ts (app.ts mounts it first). It answers only an installed, visible media app: for any other
// package, or an id it does not know, it passes on, so the generic route (and its 404) still decide. The rules live in
// lib/media/appHost.ts; this file is the wire.
import { jsonBody } from "@/lib/validation";
import { gateMediaApp } from "@/middleware/mediaAppGate";
import { apiRouter, respond, refuseWith } from "@/lib/openapi";
import { appRouteAllowed } from "@/lib/apps";
import { requireAuth } from "@/middleware/auth";
import { getCookie } from "hono/cookie";
import { hashSessionToken } from "@/lib/session";
import "@/lib/media/podcastApp"; // registers the Podcasts data ids and item view with the shared host
import "@/lib/media/musicApp"; // registers the Music lyrics fields with the shared host
import "@/lib/media/videoCreateApp"; // registers Videos' Create data ids (recipes, making, creations)
import "@/lib/media/radioRecordings"; // adds the Recordings scope to Music's existing radio data id
import { podcastRoutes, podcastDirectoryRows, podcastShowRows, podcastShowEpisodeRows } from "./podcastApp";
import { radioRoutes, radioDirectoryRows, radioSavedRows, radioStationRow, radioCountryRows, radioGenreRows } from "./radioApp";
import { fetchRadioArt, radioArtCard } from "@/lib/media/radioArt";
import { radioDirectoryAllowed, radioDirectoryHasFavicon } from "@/lib/media/radioDirectory";
import { listSavedStations } from "@/lib/media/radio";
import { radioRecordingRows } from "@/lib/media/radioRecordings";
import { mediaBandOf } from "@/lib/media/band";
import { getHouseholdSettingValue } from "@/lib/settings";
import { anotherTakeFor, bodyOfVideoJob, makeAudienceOf, makeVideoFor, readMakeBody } from "@/lib/videos/make";
import { makeItMaxBody } from "@/lib/videos/editTool";
import { studioAdd } from "@/lib/videos/studio";
import { startStudioExport } from "@/lib/videos/studioExport";
import { setFavoriteFile } from "@/lib/videos/favorites";
import { videoJobLockState, LOCKED_START_LINE } from "@/lib/videos/lock";
import { cancelVideoJob, getVideoJobByFileFor, getVideoJobFor } from "@/lib/videos/jobs";
import { editMediaItem } from "@/lib/media/mediaEdit";
import { saveMediaCover } from "@/lib/media/mediaCover";
import { lookupLyricsFor } from "@/lib/media/lyricsAction";
import { requestRealign } from "@/lib/music/libraryAlign";
import { cachedTranslation, fillTranslation, readableLyrics, translationLanguage } from "@/lib/music/lyricsTranslate";
import { musicPlaylistAction, startMusicQueue, coerceNumber, mediaAppData, saveProgress, setListed, setWatchlist, changeVideoCreationShare, changeMusicCreationShare, MEDIA_APP_IDS, itemViewFor, madeFileFor, type DataParams, type MediaAppId } from "@/lib/media/appHost";

type Body = Record<string, unknown>;

/** VIDEO-STUDIO-07: Another take and Make it Max on a clip the Studio exported. */
const EDITED_CLIP_LINE = "This clip was made by editing others, so it has no words to make again. Open the original clip and try there.";

function paramsOf(body: Body): DataParams {
  return {
    id: typeof body.id === "string" ? body.id : undefined,
    scope: typeof body.scope === "string" && body.scope !== "" ? body.scope : undefined,
    channel: typeof body.channel === "string" && body.channel !== "" ? body.channel : undefined,
    query: typeof body.q === "string" ? body.q.slice(0, 120) : undefined,
    series: typeof body.series === "string" ? body.series : undefined,
    season: coerceNumber(body.season),
    genre: typeof body.genre === "string" ? body.genre : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    copy: typeof body.copy === "string" ? body.copy : undefined,
    length: typeof body.length === "string" ? body.length : undefined,
    within: typeof body.within === "string" ? body.within : undefined,
    show: typeof body.show === "string" ? body.show : undefined,
    filter: typeof body.filter === "string" && body.filter !== "" ? body.filter : undefined,
    year: coerceNumber(body.year),
    view: typeof body.view === "string" && body.view !== "" ? body.view : undefined,
    type: typeof body.type === "string" && body.type !== "" ? body.type : undefined,
    favorites: body.favorites === true || body.favorites === "true",
    limit: coerceNumber(body.limit),
  };
}

/** A page that asks for a few rows (a billboard's six slides) gets at most that many. */
function withLimit<T>(body: Record<string, unknown>, rows: T[]): T[] {
  const limit = Number(body.limit);
  return Number.isInteger(limit) && limit > 0 ? rows.slice(0, Math.min(limit, 200)) : rows;
}

/** One media app's routes. `data/:dataId` serves the package's `contributes.data[]` ids; `progress`, `watch-later` and `like` are its actions. */
export function createMediaAppRoutes(appId: MediaAppId) {
  const routes = apiRouter();
  // AUDIT-DUP-ROUTES-01: one gate per path prefix; a person without the app is refused here, never passed to the next router.
  gateMediaApp(routes, appId, ["/data/*", "/actions/*", "/progress", "/watchlist", "/playlist", "/queue", "/watch-later", "/like", ...(appId === "music" ? ["/library/*", "/radio/*"] : [])]);

  if (appId === "music") {
    routes.get("/library/:id/lyrics-translation", requireAuth, async (c, next) => {
      const person = c.get("person");
      if (!appRouteAllowed(person, "music", "data", "library", undefined, "open")) return next();
      const id = c.req.param("id");
      const language = translationLanguage(person);
      if (!language) return c.body(null, 204);
      const lines = readableLyrics(person, id);
      if (!lines) return c.json({ error: "That song is not in the library." }, 404);
      const cached = cachedTranslation(id, language, lines);
      if (cached) return c.json({ language, lines: cached }, 200);
      void fillTranslation(id, language, lines).catch(() => {});
      return c.json({ pending: true as const }, 202);
    });
    const radio = radioRoutes();
    radio.get("/art", requireAuth, async (c, next) => {
    const person = c.get("person");
    const address = c.req.query("u") ?? "";
    const normalizedAddress = address.replace(/^http:\/\//i, "https://");
    const saved = listSavedStations(person).some((station) => station.favicon === normalizedAddress);
    if (!saved) {
      if (!radioDirectoryAllowed({ band: mediaBandOf(person) }, getHouseholdSettingValue("radio.directory.enabled") === true)) return c.body(null, 403);
      if (!radioDirectoryHasFavicon(normalizedAddress)) return c.body(null, 404);
    }
    const art = (await fetchRadioArt(normalizedAddress)) ?? radioArtCard(c.req.query("n") ?? "");
    return new Response(art.bytes, { status: 200, headers: { "content-type": art.type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'", "cross-origin-resource-policy": "same-origin" } });
    });
    radio.get("/card", requireAuth, async (c, next) => {
      const art = radioArtCard(c.req.query("n") ?? "");
      return new Response(art.bytes, { status: 200, headers: { "content-type": art.type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'", "cross-origin-resource-policy": "same-origin" } });
    });
    routes.route("/radio", radio);
  }

  routes.post("/data/:dataId", requireAuth, async (c, next) => {
    const person = c.get("person");
    // NEWS-00 review: a data id a raised page binds needs that page's floor; ids the media host serves that no page binds stay under the host's own rules.
    const isRadioDirectoryScope = appId === "music" && c.req.param("dataId") === "radio";
    if (!appRouteAllowed(person, appId, "data", c.req.param("dataId"), undefined, "open")) return next();
    // PODCAST-PORT-01: the directory is a network lookup, so it is answered here (async) beside the sync host data. Same gates as its routes.
    if (appId === "podcasts" && c.req.param("dataId") === "directory") {
      const body = await jsonBody(c);
      if (body.scope === "show") return c.json(await podcastShowRows(person, typeof body.id === "string" ? body.id : "", "show") as never, 200);
      if (body.scope === "show-episodes") return c.json(await podcastShowEpisodeRows(person, typeof body.id === "string" ? body.id : "") as never, 200);
      return c.json(withLimit(body, await podcastDirectoryRows(person, typeof body.q === "string" ? body.q : "", typeof body.scope === "string" ? body.scope : "search")) as never, 200);
    }
    // RADIO-02: Music's Radio pages. The directory is a network lookup (async); the rest are sync rows. Same gates as the radio routes.
    if (appId === "music") {
      if (c.req.param("dataId") === "radio") {
        const body = await jsonBody(c);
        const field = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");
        const scope = field("scope");
        if (scope === "station") {
          const row = radioStationRow(person, field("id"));
          return row ? c.json([row] as never, 200) : c.json([] as never, 200);
        }
        if (["directory", "popular", "genre-rock", "genre-jazz", "genre-chill", "genre-classical", "genre-news", "genre-hip-hop", "world-us", "world-gb", "world-jp"].includes(scope)) return c.json(withLimit(body, await radioDirectoryRows(person, { q: field("q"), country: field("country"), tag: field("tag"), scope: scope as import("./radioApp").RadioScope })) as never, 200);
        if (scope === "saved") return c.json(radioSavedRows(person) as never, 200);
        // MUSIC-LISTEN-05: Search matches stations already saved here by name, tag or country, from the local list only (never a radio-browser request per keystroke).
        if (scope === "saved-match") {
          const needle = field("q").trim().toLocaleLowerCase();
          return c.json((needle.length < 2 ? [] : radioSavedRows(person).filter((row) => `${row.title} ${row.summary ?? ""}`.toLocaleLowerCase().includes(needle))) as never, 200);
        }
        if (scope === "recordings") return c.json(radioRecordingRows(person) as never, 200);
        if (scope === "countries") return c.json({ as_of: new Date().toISOString(), rows: radioCountryRows() } as never, 200);
        if (scope === "genres") return c.json({ as_of: new Date().toISOString(), rows: radioGenreRows() } as never, 200);
      }
    }
    const value = mediaAppData(person, appId, c.req.param("dataId"), paramsOf(await jsonBody(c)));
    if (value === null) return next();
    return c.json(value as never, 200);
  });

  for (const [path, op] of [["share-add", "add"], ["share-remove", "remove"], ["share-private", "private"]] as const) {
    routes.post(`/actions/${path}`, requireAuth, async (c, next) => {
      const person = c.get("person");
      if (appId !== "videos" && appId !== "music") return next();
      if (!appRouteAllowed(person, appId, "actions", path)) return next();
      const body = await jsonBody(c);
      const id = typeof body.id === "string" ? body.id : "";
      const target = typeof body.person_id === "string" ? body.person_id : undefined;
      const result = appId === "videos" ? changeVideoCreationShare(person, op, id, target) : changeMusicCreationShare(person, op, id, target);
      return respond(c, result);
    });
  }

  // VIDEO-CREATE-01: the Make a video form's submit. The page may only call under /api/plugins/videos, so the action lives here; the rule is lib/videos/make.ts.
  routes.post("/actions/make", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "videos") return next();
    if (!appRouteAllowed(person, appId, "actions", "make")) return next();
    const read = readMakeBody(await jsonBody(c));
    if (!read.ok) return c.json({ error: read.error, code: "bad_arguments" }, 422);
    const made = await makeVideoFor(person, read.body);
    return made.ok ? c.json({ ok: true as const, id: made.job.id, state: made.job.state, notice: made.notice }, 200) : c.json({ error: made.error, code: made.code }, made.status);
  });

  // VIDEO-CREATE-01 (V1b): Another take on the newest Create clip: the same words and choices, a new seed.
  routes.post("/actions/another", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "videos") return next();
    if (!appRouteAllowed(person, appId, "actions", "another")) return next();
    const body = await jsonBody(c);
    const source = typeof body.id === "string" ? getVideoJobFor(person, body.id) ?? getVideoJobByFileFor(person, body.id) : null;
    if (!source || source.conversationId || source.state === "queued" || source.state === "running") return c.json({ error: "That video isn't available any more. Make a new one from the words above.", code: "gone" }, 404);
    // VIDEO-STUDIO-07: a clip made by editing others has no words of its own to make again; the original clip does.
    if (source.kind === "edit") return c.json({ error: EDITED_CLIP_LINE, code: "edited" }, 422);
    // ADULT-LOCK-02: another take of a locked clip needs an unlock first; nothing starts.
    if (videoJobLockState(person, source) !== "open") return c.json({ error: LOCKED_START_LINE, code: "locked", locked: true }, 423 as never);
    const made = await anotherTakeFor(person, source);
    return made.ok ? c.json({ ok: true as const, id: made.job.id, state: made.job.state, notice: made.notice }, 200) : c.json({ error: made.error, code: made.code }, made.status);
  });

  // VIDEO-STUDIO-07: the Studio's Add a clip, Add a voice and Add music. What the person picked comes back as a piece (`{ ref, src, label, duration_s }`);
  // a typed line is screened and spoken here, so no speech is made for a line the gate refuses. The rules are lib/videos/studio.ts.
  routes.post("/actions/add", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "videos") return next();
    if (!appRouteAllowed(person, appId, "actions", "add")) return next();
    const added = await studioAdd(person, await jsonBody(c));
    return added.ok ? c.json(added.piece as never, 200) : c.json({ error: added.line, code: added.code }, added.status);
  });

  // VIDEO-STUDIO-07: the Studio's Export. The plan the page posted becomes a NEW clip through the edit job trim, join and mix use (the old clip stays);
  // the reply is the job's id, which the page's export card follows. The rules are lib/videos/studioExport.ts.
  routes.post("/actions/export", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "videos") return next();
    if (!appRouteAllowed(person, appId, "actions", "export")) return next();
    const started = await startStudioExport(person, await jsonBody(c));
    return started.ok ? c.json({ ok: true as const, id: started.job.id, state: started.job.state }, 200) : c.json({ error: started.line, code: started.code }, started.status);
  });

  // VIDEO-UI-06: the Create feed's Stop. Only the person's own Create clip (no chat behind it); a finished clip stays finished.
  routes.post("/actions/cancel", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "videos") return next();
    if (!appRouteAllowed(person, appId, "actions", "cancel")) return next();
    const body = await jsonBody(c);
    const job = typeof body.id === "string" ? getVideoJobFor(person, body.id) : null;
    if (!job || job.conversationId || videoJobLockState(person, job) !== "open") return c.json({ error: "That video isn't available any more.", code: "gone" }, 404);
    const stopped = await cancelVideoJob(person, job.id);
    return c.json({ ok: true as const, id: job.id, state: stopped?.state ?? job.state }, 200);
  });

  // VIDEO-UI-06: Make it Max on a finished Create clip. The checks and the body are the ones the chat tool's make_it_max uses (makeItMaxBody), and the make is
  // makeVideoFor, so the Max grant, the ready Max model, the words-only rule, the age and surface gate and the one-clip-at-a-time rule are the same.
  routes.post("/actions/max", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "videos") return next();
    if (!appRouteAllowed(person, appId, "actions", "max")) return next();
    const body = await jsonBody(c);
    const source = typeof body.id === "string" ? getVideoJobFor(person, body.id) ?? getVideoJobByFileFor(person, body.id) : null;
    if (!source || source.conversationId || source.state !== "done") return c.json({ error: "That video isn't available any more. Make a new one from the words on the left.", code: "gone" }, 404);
    if (source.kind === "edit") return c.json({ error: EDITED_CLIP_LINE, code: "edited" }, 422);
    if (videoJobLockState(person, source) !== "open") return c.json({ error: LOCKED_START_LINE, code: "locked", locked: true }, 423 as never);
    const audience = makeAudienceOf(person);
    // A clip that started from a Library picture keeps it (as Another take does); makeItMaxBody refuses it unless the Max model can start from a picture.
    const start = source.kind === "animate" && source.request.source_file_id ? { start_frame: source.request.source_file_id } : {};
    const make = { ...bodyOfVideoJob(source), ...start };
    const max = await makeItMaxBody(person, audience.band, source, make);
    if (!max.ok) return c.json({ error: max.line, code: max.why }, max.why === "max_not_ready" ? 503 : 422);
    const made = await makeVideoFor(person, make, { audience });
    return made.ok ? c.json({ ok: true as const, id: made.job.id, state: made.job.state, notice: made.notice }, 200) : c.json({ error: made.error, code: made.code }, made.status);
  });

  // VIDEO-UI-06: the Favorite heart (the feed's player and My clips' tiles). `id` is the clip's job (the feed) or its Library file (My clips); a clip the person
  // cannot see in their own Library is a 404. `favorite` true or false sets the mark; left out, the mark is flipped.
  routes.post("/actions/favorite", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "videos") return next();
    if (!appRouteAllowed(person, appId, "actions", "favorite")) return next();
    const body = await jsonBody(c);
    const id = typeof body.id === "string" ? body.id : "";
    const job = id ? getVideoJobFor(person, id) : null;
    const fileId = job ? (job.state === "done" && videoJobLockState(person, job) === "open" ? job.files[0]?.id : undefined) : id && madeFileFor(person, "videos", id) ? id : undefined;
    if (!fileId) return c.json({ error: "That video isn't available any more.", code: "gone" }, 404);
    const asked = body.favorite === true || body.favorite === "true" ? true : body.favorite === false || body.favorite === "false" ? false : undefined;
    return c.json({ ok: true as const, id, favorite: setFavoriteFile(person, fileId, asked) }, 200);
  });

  routes.post("/actions/lyrics", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "music") return next();
    if (!appRouteAllowed(person, appId, "actions", "lyrics")) return next();
    const body = await jsonBody(c);
    const id = typeof body.id === "string" ? body.id : typeof body.media_id === "string" ? body.media_id : "";
    const result = await lookupLyricsFor(person, id);
    return respond(c, result);
  });

  // MUSIC-GEN-20c: the player's "Lyrics look off" action; the same function as POST /api/music/library/:id/lyrics-realign.
  routes.post("/actions/lyrics-realign", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "music") return next();
    if (!appRouteAllowed(person, appId, "actions", "lyrics-realign")) return next();
    const body = await jsonBody(c);
    const id = typeof body.id === "string" ? body.id : typeof body.media_id === "string" ? body.media_id : "";
    const { result } = requestRealign(person, id);
    return result.ok ? c.json({ ok: true as const, state: "queued" as const }, 202) : refuseWith(c, result);
  });

  routes.post("/actions/edit", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId === "books") return next();
    if (!appRouteAllowed(person, appId, "actions", "edit", undefined, "open")) return next();
    const result = editMediaItem(person, appId, await jsonBody(c));
    if (!result.ok) return respond(c, result);
    return c.json((itemViewFor(person, appId, String(result.value.id)) ?? result.value) as never, 200);
  });

  routes.post("/actions/cover", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId === "books") return next();
    if (!appRouteAllowed(person, appId, "actions", "cover", undefined, "open")) return next();
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const file = form.file;
    const result = await saveMediaCover(person, appId, typeof form.id === "string" ? form.id : "", file instanceof File ? file : null);
    return respond(c, result);
  });

  routes.post("/progress", requireAuth, async (c, next) => {
    const person = c.get("person");
    const result = saveProgress(person, appId, await jsonBody(c), new Date(), `s:${hashSessionToken(getCookie(c, "session")!)}`);
    return result.ok ? c.json({ ok: true as const, ...result.value }, 200) : refuseWith(c, result);
  });

  if (appId === "shows") routes.post("/watchlist", requireAuth, async (c, next) => {
    const person = c.get("person");
    const result = setWatchlist(person, await jsonBody(c));
    return result.ok ? c.json({ ok: true, ...result.value }, 200) : refuseWith(c, result);
  });

  routes.post("/playlist", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "music") return next();
    const result = musicPlaylistAction(person, await jsonBody(c));
    return result.ok ? c.json({ ok: true as const, ...result.value }, 200) : refuseWith(c, result);
  });

  routes.post("/queue", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "music") return next();
    const result = startMusicQueue(person, await jsonBody(c));
    return respond(c, result);
  });

  const lists: ReadonlyArray<readonly [string, "watch_later" | "liked" | "queue"]> = appId === "podcasts" ? [["queue", "queue"]] : [["watch-later", "watch_later"], ["like", "liked"]];
  for (const [path, kind] of lists) {
    routes.post(`/${path}`, requireAuth, async (c, next) => {
      const person = c.get("person");
      const body = await jsonBody(c);
      const result = setListed(person, appId, kind, body.media_id, body.on);
      return result.ok ? c.json({ ok: true as const, ...result.value }, 200) : refuseWith(c, result);
    });
  }

  if (appId === "podcasts") routes.route("/", podcastRoutes());

  return routes;
}

/** Mounted once per media app id in app.ts, before `pluginsRoutes`. */
export const mediaAppRoutes: ReadonlyArray<{ id: MediaAppId; routes: ReturnType<typeof createMediaAppRoutes> }> = MEDIA_APP_IDS.map((id) => ({ id, routes: createMediaAppRoutes(id) }));
