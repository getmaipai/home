// MEDIA-PODCASTS-01: the Podcasts routes that sit beside the shared media-app ones (data, progress, queue). Everything under
// /api/plugins/podcasts; adults and admins only where noted. The shows an admin follows live in `feeds` (purpose podcast) and `media_sources`.
import type { Context } from "hono";
import { readableIn } from "@/lib/media/appHost";
import { correctedStamp, getProgress, writeProgress } from "@/lib/media/progress";
import { coerceNumber, mediaAppAllowed } from "@/lib/media/appHost";
import { queuePodcastAutoRules, exportOpml, importOpml, pollPodcastNow, saveEpisode, subscribePodcast, unsaveEpisode, unsubscribePodcast, updatePodcastSource } from "@/lib/media/podcasts";
import { apiRouter } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";

type Body = Record<string, unknown>;
const bodyOf = async (c: Context): Promise<Body> => {
  const parsed = await c.req.raw.json().catch(() => ({}));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Body) : {};
};
const fail = (c: Context, result: { status: number; error: string }) => c.json({ error: result.error }, result.status as 400);

export function podcastRoutes() {
  const routes = apiRouter();

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
    return c.json({ ok: true as const, source_id: result.value.source.id }, 200);
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

  return routes;
}
