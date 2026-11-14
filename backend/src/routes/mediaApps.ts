// MEDIA-VIDEOS-01: the route factory every media app mounts under /api/plugins/<appId>, ahead of the generic
// `POST /:id/data/:dataId` in routes/plugins.ts (app.ts mounts it first). It answers only an installed, visible media app: for any other
// package, or an id it does not know, it passes on, so the generic route (and its 404) still decide. The rules live in
// lib/media/appHost.ts; this file is the wire.
import { jsonBody } from "@/lib/validation";
import { ImageEditError, applyPreview, editErrorFrom } from "@/lib/imageEdit";
import { MediaOpRequest, startLibraryOp } from "@/lib/mediaOps/http";
import { studioApply, studioComment, studioMarkup, studioRun } from "@/lib/mediaOps/studio";
import { studioReference } from "@/lib/mediaOps/studioReference";
import { gateMediaApp } from "@/middleware/mediaAppGate";
import { apiRouter, respond, refuseWith } from "@/lib/openapi";
import { runMediaOp } from "@/lib/mediaOps/registry";
import { VIDEO_CLEARER_OP } from "@/lib/mediaOps/ids";
import { appRouteAllowed } from "@/lib/apps";
import { requireAuth } from "@/middleware/auth";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { hashSessionToken } from "@/lib/session";
import "@/lib/media/podcastApp"; // registers the Podcasts data ids and item view with the shared host
import "@/lib/media/musicApp"; // registers the Music lyrics fields with the shared host
import "@/lib/media/videoCreateApp"; // registers Videos' Create data ids (recipes, making, creations)
import "@/lib/media/radioRecordings"; // adds the Recordings scope to Music's existing radio data id
import { showSaveRows } from "@/lib/media/podcastParity";
import { videoPlaylistRoutes } from "./videoPlaylists";
import { changeVideoPlaylistMembers, videoPlaylistFor } from "@/lib/videos/playlists";
import { podcastRoutes, podcastDirectoryRows, podcastShowRows, podcastShowEpisodeRows, podcastShowSeasonRows, podcastTranscriptRows } from "./podcastApp";
import { radioRoutes, radioDirectoryRows, radioSavedRows, radioStationRow, radioCountryRows, radioGenreRows } from "./radioApp";
import { fetchRadioArt, radioArtCard } from "@/lib/media/radioArt";
import { radioDirectoryAllowed, radioDirectoryHasFavicon } from "@/lib/media/radioDirectory";
import { listSavedStations } from "@/lib/media/radio";
import { radioRecordingRows } from "@/lib/media/radioRecordings";
import { mediaBandOf } from "@/lib/media/band";
import { changePlaylistMembers, musicPlaylistOps, playlistFor } from "@/lib/media/musicPlaylists";
import { reportKeptSongs, clearMusicSearches, musicQueueAction, recentMusicSongs, pinMusicItem, recordMusicSearch } from "@/lib/media/musicLibrary";
import { getHouseholdSettingValue } from "@/lib/settings";
import { anotherTakeFor, bodyOfVideoJob, makeAudienceOf, makeVideoFor, readMakeBody } from "@/lib/videos/make";
import { makePictureFor, readPictureMakeBody } from "@/lib/pictures/make";
import { getPictureJob } from "@/lib/pictures/jobs";
import { makeItMaxBody } from "@/lib/videos/editTool";
import { startSpatialSound } from "@/lib/videos/spatialStart";
import { isReshape, startReshape, startSharpen } from "@/lib/videos/clipEditStart";
import { studioAdd } from "@/lib/videos/studio";
import { startStudioExport } from "@/lib/videos/studioExport";
import { setFavoriteFile } from "@/lib/videos/favorites";
import { meetsMinRole } from "@/lib/plugins";
import { adultMarkJobBody } from "@/lib/adultMarkRoute";
import { videoJobLockState, LOCKED_START_LINE } from "@/lib/videos/lock";
import { cancelVideoJob, getVideoJobByFileFor, getVideoJobFor } from "@/lib/videos/jobs";
import { editMediaItem } from "@/lib/media/mediaEdit";
import { saveMediaCover } from "@/lib/media/mediaCover";
import { lookupLyricsFor } from "@/lib/media/lyricsAction";
import { requestRealign } from "@/lib/music/libraryAlign";
import { musicPlaylistAction, startMusicQueue, coerceNumber, mediaAppData, saveProgress, setListed, setWatchlist, changeVideoCreationShare, changeMusicCreationShare, MEDIA_APP_IDS, itemViewFor, madeFileFor, type DataParams, type MediaAppId } from "@/lib/media/appHost";

type Body = Record<string, unknown>;

/** VIDEO-STUDIO-07: Another take and Make it Max on a clip the Studio exported. */
const EDITED_CLIP_LINE = "This clip was made by editing others, so it has no words to make again. Open the original clip and try there.";

/** Which browser or device is asking: the paired device, else the hashed session (the key progress already uses). */
function deviceKeyOf(c: Context): string {
  const deviceId = c.get("deviceId") as string | undefined;
  return deviceId ? `d:${deviceId}` : `s:${hashSessionToken(getCookie(c, "session") ?? "-")}`;
}

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
    sort: typeof body.sort === "string" && body.sort !== "" ? body.sort : undefined,
    kind: typeof body.kind === "string" && body.kind !== "" ? body.kind : undefined,
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
  gateMediaApp(routes, appId, ["/data/*", "/actions/*", "/progress", "/watchlist", "/playlist", "/queue", "/watch-later", "/like", ...(appId === "audio" ? ["/library/*", "/radio/*", "/pin", "/recent-searches", "/offline"] : []), ...(appId === "video" ? ["/playlists/*", "/history/*", "/moment", "/moment/*"] : [])]);

  if (appId === "audio") {
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
    const isRadioDirectoryScope = appId === "audio" && c.req.param("dataId") === "radio";
    if (!appRouteAllowed(person, appId, "data", c.req.param("dataId"), undefined, "open")) return next();
    // PODCAST-PORT-01: the directory is a network lookup, so it is answered here (async) beside the sync host data. Same gates as its routes.
    if (appId === "podcasts" && c.req.param("dataId") === "directory") {
      const body = await jsonBody(c);
      if (body.scope === "show") {
        const rows = await podcastShowRows(person, typeof body.id === "string" ? body.id : "", "show") as Array<{ followed?: boolean }>;
        // PODCAST-PARITY-01: the page's Follow and Following billboards each ask for their own state; the other draws nothing.
        return c.json((body.follow === "yes" ? rows.filter((row) => row.followed === true) : body.follow === "no" ? rows.filter((row) => row.followed !== true) : rows) as never, 200);
      }
      if (body.scope === "show-episodes") return c.json(await podcastShowEpisodeRows(person, typeof body.id === "string" ? body.id : "", { sort: body.sort, season: body.season }) as never, 200);
      // APPS-PARITY: the player's transcript reader (rows {start_s, text}); publisher text is fetched on request, same guard and rate limit as the transcript route.
      if (body.scope === "transcript") return c.json(await podcastTranscriptRows(person, typeof body.id === "string" ? body.id : "") as never, 200);
      if (body.scope === "show-saved") return c.json(showSaveRows(person, typeof body.id === "string" ? body.id : "") as never, 200);
      if (body.scope === "show-seasons") return c.json(await podcastShowSeasonRows(person, typeof body.id === "string" ? body.id : "") as never, 200);
      return c.json(withLimit(body, await podcastDirectoryRows(person, typeof body.q === "string" ? body.q : "", typeof body.scope === "string" ? body.scope : "search", typeof body.shelf === "string" ? body.shelf : undefined, typeof body.kind === "string" ? body.kind : undefined)) as never, 200);
    }
    // RADIO-02: Music's Radio pages. The directory is a network lookup (async); the rest are sync rows. Same gates as the radio routes.
    if (appId === "audio") {
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
    // CLIPS-FEED-01: the Clips page is open to every role and binds `recipes`; a null from the hook would fall through to the package runner (a 502), so a person below
    // the Create floor asking for any scope but `short` is answered 404 here.
    if (appId === "video" && c.req.param("dataId") === "recipes" && !meetsMinRole(person.role, "adult") && (await jsonBody(c)).scope !== "short") return c.json({ error: "no such data" }, 404);
    const value = mediaAppData(person, appId, c.req.param("dataId"), { ...paramsOf(await jsonBody(c)), ...(appId === "audio" ? { device: deviceKeyOf(c) } : {}) });
    if (value === null) return next();
    return c.json(value as never, 200);
  });

  for (const [path, op] of [["share-add", "add"], ["share-remove", "remove"], ["share-private", "private"]] as const) {
    routes.post(`/actions/${path}`, requireAuth, async (c, next) => {
      const person = c.get("person");
      if (appId !== "video" && appId !== "audio") return next();
      if (!appRouteAllowed(person, appId, "actions", path)) return next();
      const body = await jsonBody(c);
      const id = typeof body.id === "string" ? body.id : "";
      const target = typeof body.person_id === "string" ? body.person_id : undefined;
      // MEDIA-PARITY-02: on a playlist's page the same share panel adds and removes its members.
      const result = appId === "video" ? (videoPlaylistFor(person, id) ? changeVideoPlaylistMembers(person, op, id, target) : changeVideoCreationShare(person, op, id, target)) : (playlistFor(person, id) ? changePlaylistMembers(person, op, id, target) : changeMusicCreationShare(person, op, id, target));
      return respond(c, result);
    });
  }

  // VIDEO-CREATE-01: the Make a video form's submit. The page may only call under /api/plugins/video, so the action lives here; the rule is lib/videos/make.ts.
  routes.post("/actions/make", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "video") return next();
    if (!appRouteAllowed(person, appId, "actions", "make")) return next();
    const read = readMakeBody(await jsonBody(c));
    if (!read.ok) return c.json({ error: read.error, code: "bad_arguments" }, 422);
    const made = await makeVideoFor(person, read.body);
    return made.ok ? c.json({ ok: true as const, id: made.job.id, state: made.job.state, notice: made.notice }, 200) : c.json({ error: made.error, code: made.code }, made.status);
  });

  // VIDEO-CREATE-01 (V1b): Another take on the newest Create clip: the same words and choices, a new seed.
  routes.post("/actions/another", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "video") return next();
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
    if (appId !== "video") return next();
    if (!appRouteAllowed(person, appId, "actions", "add")) return next();
    const added = await studioAdd(person, await jsonBody(c));
    return added.ok ? c.json(added.piece as never, 200) : c.json({ error: added.line, code: added.code }, added.status);
  });

  // VIDEO-STUDIO-07: the Studio's Export. The plan the page posted becomes a NEW clip through the edit job trim, join and mix use (the old clip stays);
  // the reply is the job's id, which the page's export card follows. The rules are lib/videos/studioExport.ts.
  routes.post("/actions/export", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "video") return next();
    if (!appRouteAllowed(person, appId, "actions", "export")) return next();
    const started = await startStudioExport(person, await jsonBody(c));
    return started.ok ? c.json({ ok: true as const, id: started.job.id, state: started.job.state }, 200) : c.json({ error: started.line, code: started.code }, started.status);
  });

  // VIDEO-UI-06: the Create feed's Stop. Only the person's own Create clip (no chat behind it); a finished clip stays finished.
  routes.post("/actions/cancel", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "video") return next();
    if (!appRouteAllowed(person, appId, "actions", "cancel")) return next();
    const body = await jsonBody(c);
    const job = typeof body.id === "string" ? getVideoJobFor(person, body.id) : null;
    if (!job || job.conversationId || videoJobLockState(person, job) !== "open") return c.json({ error: "That video isn't available any more.", code: "gone" }, 404);
    const stopped = await cancelVideoJob(person, job.id);
    return c.json({ ok: true as const, id: job.id, state: stopped?.state ?? job.state }, 200);
  });

  routes.post("/actions/adult-mark", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "video") return next();
    if (!appRouteAllowed(person, appId, "actions", "adult-mark")) return next();
    const body = await jsonBody(c);
    if (typeof body.id !== "string" || (body.action !== "clear" && body.action !== "mark") || (body.ticket !== undefined && typeof body.ticket !== "string")) return c.json({ error: "Invalid action." }, 400);
    const result = adultMarkJobBody(c, person, { id: body.id, action: body.action, ...(typeof body.ticket === "string" ? { ticket: body.ticket } : {}) });
    if (!result.ok) return refuseWith(c, result);
    return c.json({ made_audience: result.made_audience, lock: result.lock }, 200);
  });

  // VIDEO-UI-06: Make it Max on a finished Create clip. The checks and the body are the ones the chat tool's make_it_max uses (makeItMaxBody), and the make is
  // makeVideoFor, so the Max grant, the ready Max model, the words-only rule, the age and surface gate and the one-clip-at-a-time rule are the same.
  routes.post("/actions/max", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "video") return next();
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

  // SPATIAL-REACH: Spatial sound on a finished Create clip. The same start as the chat card's menu route (startSpatialSound): the edit gate (adults only), the
  // person's own open clip, the no-sound line and the finished-clip check are written once, there. The new clip is an edit row of the same feed.
  routes.post("/actions/spatial-sound", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "video") return next();
    if (!appRouteAllowed(person, appId, "actions", "spatial-sound")) return next();
    const body = await jsonBody(c);
    const started = await startSpatialSound(person, typeof body.id === "string" ? body.id : "", { surround: body.surround === true || body.surround === "true", side: body.side });
    if (!started.ok) return c.json({ error: started.error, code: started.code, ...(started.locked ? { locked: true } : {}) }, started.status as never);
    return c.json({ ok: true as const, id: started.job.id, state: started.job.state }, 200);
  });

  // PHOSPHENE-PARITY-01: "Make it vertical / portrait / square / widescreen" and "Sharpen 2x" on a finished Create clip. The same start as the chat tool's reframe and
  // upscale (clipEditStart): the edit gate (adults only), the person's own open clip and the finished-clip check are written once, there. The original is kept.
  routes.post("/actions/reshape", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "video") return next();
    if (!appRouteAllowed(person, appId, "actions", "reshape")) return next();
    const body = await jsonBody(c);
    if (!isReshape(body.shape)) return c.json({ error: "Choose vertical, portrait, square or wide.", code: "bad_shape" }, 400);
    const started = await startReshape(person, typeof body.id === "string" ? body.id : "", body.shape);
    if (!started.ok) return c.json({ error: started.error, code: started.code, ...(started.locked ? { locked: true } : {}) }, started.status as never);
    return c.json({ ok: true as const, id: started.job.id, state: started.job.state }, 200);
  });

  routes.post("/actions/sharpen", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "video") return next();
    if (!appRouteAllowed(person, appId, "actions", "sharpen")) return next();
    const body = await jsonBody(c);
    const started = await startSharpen(person, typeof body.id === "string" ? body.id : "");
    if (!started.ok) return c.json({ error: started.error, code: started.code, ...(started.locked ? { locked: true } : {}) }, started.status as never);
    return c.json({ ok: true as const, id: started.job.id, state: started.job.state }, 200);
  });

  // MAKE-CLEARER-01: "Make clearer" (Quick, Better or Best) on a finished Create clip: the one registry operation, so the feed, the video Studio and chat start the same edit.
  // A level that is not ready answers 503 with its plain line (the Best level, until the Stack has the AI restore); the original clip is kept.
  routes.post("/actions/clearer", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "video") return next();
    if (!appRouteAllowed(person, appId, "actions", "clearer")) return next();
    const body = await jsonBody(c);
    const level = typeof body.level === "string" ? body.level : "quick";
    try {
      const started = await runMediaOp(person, VIDEO_CLEARER_OP, { source: { kind: "video", via: "file", id: typeof body.id === "string" ? body.id : "" }, args: { level } });
      return c.json({ ok: true as const, id: started.job.id, state: started.job.state }, 200);
    } catch (error) {
      const mapped = error instanceof ImageEditError ? error : editErrorFrom(error);
      return c.json({ error: mapped.message, code: mapped.code, ...(mapped.status === 423 ? { locked: true } : {}) }, mapped.status as never);
    }
  });

  // VIDEO-UI-06: the Favorite heart (the feed's player and My clips' tiles). `id` is the clip's job (the feed) or its Library file (My clips); a clip the person
  // cannot see in their own Library is a 404. `favorite` true or false sets the mark; left out, the mark is flipped.
  routes.post("/actions/favorite", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "video") return next();
    if (!appRouteAllowed(person, appId, "actions", "favorite")) return next();
    const body = await jsonBody(c);
    const id = typeof body.id === "string" ? body.id : "";
    const job = id ? getVideoJobFor(person, id) : null;
    const fileId = job ? (job.state === "done" && videoJobLockState(person, job) === "open" ? job.files[0]?.id : undefined) : id && madeFileFor(person, "video", id) ? id : undefined;
    if (!fileId) return c.json({ error: "That video isn't available any more.", code: "gone" }, 404);
    const asked = body.favorite === true || body.favorite === "true" ? true : body.favorite === false || body.favorite === "false" ? false : undefined;
    return c.json({ ok: true as const, id, favorite: setFavoriteFile(person, fileId, asked) }, 200);
  });

  routes.post("/actions/lyrics", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "audio") return next();
    if (!appRouteAllowed(person, appId, "actions", "lyrics")) return next();
    const body = await jsonBody(c);
    const id = typeof body.id === "string" ? body.id : typeof body.media_id === "string" ? body.media_id : "";
    const result = await lookupLyricsFor(person, id);
    return respond(c, result);
  });

  // MUSIC-GEN-20c: the player's "Lyrics look off" action; the same function as POST /api/music/library/:id/lyrics-realign.
  routes.post("/actions/lyrics-realign", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "audio") return next();
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
    if (appId !== "audio") return next();
    const body = await jsonBody(c);
    const result = musicPlaylistOps(person, body) ?? musicPlaylistAction(person, body);
    return result.ok ? c.json({ ok: true as const, ...result.value }, 200) : refuseWith(c, result);
  });

  routes.post("/queue", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "audio") return next();
    const body = await jsonBody(c);
    // PARITY-01: an `op` (play_next or add) edits the queue the stage's Up next list reads; without one the queue is started as before.
    const result = body.op !== undefined ? musicQueueAction(person, body) : startMusicQueue(person, body);
    return respond(c, result);
  });

  if (appId === "audio") {
    routes.post("/offline", requireAuth, async (c) => respond(c, reportKeptSongs(c.get("person"), deviceKeyOf(c), await jsonBody(c))));
    routes.get("/recent-songs", requireAuth, (c) => c.json({ songs: recentMusicSongs(c.get("person")) }, 200));
    routes.post("/pin", requireAuth, async (c) => respond(c, pinMusicItem(c.get("person"), await jsonBody(c))));
    routes.post("/recent-searches", requireAuth, async (c) => {
      const body = await jsonBody(c);
      return respond(c, body.op === "clear" ? clearMusicSearches(c.get("person")) : recordMusicSearch(c.get("person"), body));
    });
  }

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
  if (appId === "video") routes.route("/", videoPlaylistRoutes());

  return routes;
}

/** Mounted once per media app id in app.ts, before `pluginsRoutes`. */
export const mediaAppRoutes: ReadonlyArray<{ id: MediaAppId; routes: ReturnType<typeof createMediaAppRoutes> }> = MEDIA_APP_IDS.map((id) => ({ id, routes: createMediaAppRoutes(id) }));

/**
 * IMG-OPS-02: the Image app's page actions. Image is not a media-library app (no items, progress or likes), so it does not join MEDIA_APPS; it only needs its
 * actions served under /api/plugins/image like the media apps' are. `op` is the same start as POST /api/media-ops/{id} (startLibraryOp), so a page and the
 * route give one answer; `op-apply` saves a previewed result as a new Library picture (the same applyPreview). Each is behind the app gate and the page floor.
 */
export function createImageAppRoutes() {
  const routes = apiRouter();
  gateMediaApp(routes, "image", ["/actions/make", "/actions/op", "/actions/op-apply", "/actions/studio-run", "/actions/studio-comment", "/actions/studio-apply", "/actions/studio-markup", "/actions/studio-reference"]);
  routes.post("/actions/make", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!appRouteAllowed(person, "image", "actions", "make")) return next();
    const read = readPictureMakeBody(await jsonBody(c));
    if (!read.ok) return c.json({ error: read.error, code: "bad_arguments" }, 422);
    const made = await makePictureFor(person, read.body);
    return made.ok ? c.json({ ok: true as const, id: made.ids[0], ids: made.ids, state: getPictureJob(person, made.ids[0]!)?.state ?? "queued", notice: made.notice }, 200) : c.json({ error: made.error, code: made.code }, made.status);
  });
  routes.post("/actions/op", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!appRouteAllowed(person, "image", "actions", "op")) return next();
    const body = await jsonBody(c);
    const op = typeof body.op === "string" ? body.op : "";
    const read = MediaOpRequest.safeParse(body);
    if (!op || !read.success) return c.json({ error: "Say which operation to run and on which Library picture (op and file_id), then try again.", code: "bad_arguments" }, 422);
    const started = await startLibraryOp(person, op, read.data, c.req.raw.signal);
    return started.ok ? c.json(started.progress as never, 200) : c.json({ error: started.error, code: started.code }, started.status as never);
  });
  routes.post("/actions/op-apply", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!appRouteAllowed(person, "image", "actions", "op-apply")) return next();
    const body = await jsonBody(c);
    try {
      if (typeof body.token !== "string" || body.token === "") throw new ImageEditError(422, "That result expired. Run the operation again.", "expired");
      return c.json({ version: await applyPreview(person, body.token, typeof body.label === "string" ? body.label : undefined) } as never, 200);
    } catch (error) {
      const mapped = error instanceof ImageEditError ? error : editErrorFrom(error);
      return c.json({ error: mapped.message, code: mapped.code }, mapped.status as never);
    }
  });
  // IMG-STUDIO-02: the Studio page's calls (lib/mediaOps/studio.ts). Each answers in the shape the kit's `image_editor` handler names, or with one plain line.
  const studio = { "studio-run": studioRun, "studio-comment": studioComment, "studio-apply": studioApply, "studio-markup": studioMarkup, "studio-reference": studioReference } as const;
  for (const [name, handler] of Object.entries(studio)) {
    routes.post(`/actions/${name}`, requireAuth, async (c, next) => {
      const person = c.get("person");
      if (!appRouteAllowed(person, "image", "actions", name)) return next();
      try { return c.json((await handler(person, await jsonBody(c), c.req.raw.signal)) as never, 200); }
      catch (error) {
        const mapped = error instanceof ImageEditError ? error : editErrorFrom(error);
        return c.json({ error: mapped.message, code: mapped.code }, mapped.status as never);
      }
    });
  }
  return routes;
}
export const imageAppRoutes = createImageAppRoutes();
