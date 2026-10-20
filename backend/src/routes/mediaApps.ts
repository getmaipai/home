// MEDIA-VIDEOS-01: the route factory every media app mounts under /api/plugins/<appId>, ahead of the generic
// `POST /:id/data/:dataId` in routes/plugins.ts (app.ts mounts it first). It answers only an installed, visible media app: for any other
// package, or an id it does not know, it passes on, so the generic route (and its 404) still decide. The rules live in
// lib/media/appHost.ts; this file is the wire.
import { apiRouter } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { appRouteAllowed } from "@/lib/apps";
import { getCookie } from "hono/cookie";
import { hashSessionToken } from "@/lib/session";
import "@/lib/media/podcastApp"; // registers the Podcasts data ids and item view with the shared host
import { podcastRoutes } from "./podcastApp";
import { musicPlaylistAction, startMusicQueue, coerceNumber, mediaAppAllowed, mediaAppData, saveProgress, setListed, setWatchlist, MEDIA_APP_IDS, type DataParams, type MediaAppId } from "@/lib/media/appHost";

type Body = Record<string, unknown>;

async function bodyOf(request: Request): Promise<Body> {
  const parsed = await request.json().catch(() => ({}));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Body) : {};
}

function paramsOf(body: Body): DataParams {
  return {
    id: typeof body.id === "string" ? body.id : undefined,
    scope: typeof body.scope === "string" && body.scope !== "" ? body.scope : undefined,
    channel: typeof body.channel === "string" && body.channel !== "" ? body.channel : undefined,
    series: typeof body.series === "string" ? body.series : undefined,
    season: coerceNumber(body.season),
    genre: typeof body.genre === "string" ? body.genre : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    limit: coerceNumber(body.limit),
  };
}

/** One media app's routes. `data/:dataId` serves the package's `contributes.data[]` ids; `progress`, `watch-later` and `like` are its actions. */
export function createMediaAppRoutes(appId: MediaAppId) {
  const routes = apiRouter();

  routes.post("/data/:dataId", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, appId)) return next();
    // NEWS-00 review: a data id a raised page binds needs that page's floor; ids the media host serves that no page binds stay under the host's own rules.
    if (!appRouteAllowed(person, appId, "data", c.req.param("dataId"), undefined, "open")) return next();
    const value = mediaAppData(person, appId, c.req.param("dataId"), paramsOf(await bodyOf(c.req.raw)));
    if (value === null) return next();
    return c.json(value as never, 200);
  });

  routes.post("/progress", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, appId)) return next();
    const result = saveProgress(person, appId, await bodyOf(c.req.raw), new Date(), `s:${hashSessionToken(getCookie(c, "session")!)}`);
    return result.ok ? c.json({ ok: true as const, ...result.value }, 200) : c.json({ error: result.error }, result.status);
  });

  if (appId === "shows") routes.post("/watchlist", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (!mediaAppAllowed(person, appId)) return next();
    const result = setWatchlist(person, await bodyOf(c.req.raw));
    return result.ok ? c.json({ ok: true, ...result.value }, 200) : c.json({ error: result.error }, result.status);
  });

  routes.post("/playlist", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "music" || !mediaAppAllowed(person, appId)) return next();
    const result = musicPlaylistAction(person, await bodyOf(c.req.raw));
    return result.ok ? c.json({ ok: true as const, ...result.value }, 200) : c.json({ error: result.error }, result.status);
  });

  routes.post("/queue", requireAuth, async (c, next) => {
    const person = c.get("person");
    if (appId !== "music" || !mediaAppAllowed(person, appId)) return next();
    const result = startMusicQueue(person, await bodyOf(c.req.raw));
    return result.ok ? c.json(result.value, 200) : c.json({ error: result.error }, result.status);
  });

  const lists: ReadonlyArray<readonly [string, "watch_later" | "liked" | "queue"]> = appId === "podcasts" ? [["queue", "queue"]] : [["watch-later", "watch_later"], ["like", "liked"]];
  for (const [path, kind] of lists) {
    routes.post(`/${path}`, requireAuth, async (c, next) => {
      const person = c.get("person");
      if (!mediaAppAllowed(person, appId)) return next();
      const body = await bodyOf(c.req.raw);
      const result = setListed(person, appId, kind, body.media_id, body.on);
      return result.ok ? c.json({ ok: true as const, ...result.value }, 200) : c.json({ error: result.error }, result.status);
    });
  }

  if (appId === "podcasts") routes.route("/", podcastRoutes());

  return routes;
}

/** Mounted once per media app id in app.ts, before `pluginsRoutes`. */
export const mediaAppRoutes: ReadonlyArray<{ id: MediaAppId; routes: ReturnType<typeof createMediaAppRoutes> }> = MEDIA_APP_IDS.map((id) => ({ id, routes: createMediaAppRoutes(id) }));
