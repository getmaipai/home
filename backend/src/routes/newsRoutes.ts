// NEWS-02 (news note section 17): the News app's data, action and picture routes, package scoped (`/api/plugins/news/...`).
// Mounted in routes/plugins.ts ahead of the generic `/:id/data/:dataId`, so News's own ids reach this file and nothing else
// does. Every route runs the same gate first: the person must be signed in, the news app must be visible to them (the package's
// role floor, its smoke status, capabilities; the app's index page floor) and the page that owns the data id, action or picture
// must be one their role reaches (`appRouteAllowed` / `appImageAllowed`, lib/apps.ts). A failed gate is a 404 and never says why,
// so a child or a guest learns nothing about what exists. Age and surface stay on the data path (the shelf's release, the block
// filter, the child gate), not here. Log lines are typed counters only: no title, URL or person id (RULES 6a).
import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AppEnv } from "@/types";
import { appImageAllowed, appRouteAllowed } from "@/lib/apps";
import { NEWS_ACTIONS, runNewsAction, type NewsActionName } from "@/lib/news/actions";
import { channelData, householdTodayData, mixData, savedRows, sourceRows, storyData, todayData, topicRows, viewerOf } from "@/lib/news/data";
import { recentRows, searchData } from "@/lib/news/search";
import { releasedItem } from "@/lib/news/cards";
import { bumpNewsCounter } from "@/lib/news/newsCounters";
import { NEWS_PICTURE_WIDTHS, newsFigurePicture, newsPicture, type NewsPictureWidth } from "@/lib/news/pictures";
import { figureAddressesOf } from "@/lib/news/article";

export const newsRoutes = new Hono<AppEnv>();

const DATA_IDS = ["today", "mix", "channel", "story", "household-today", "topics", "sources", "saved", "search", "search-recents"] as const;
type DataId = (typeof DATA_IDS)[number];
const isDataId = (value: string): value is DataId => (DATA_IDS as readonly string[]).includes(value);
const isAction = (value: string): value is NewsActionName => (NEWS_ACTIONS as readonly string[]).includes(value);

async function bodyOf(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => ({}));
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

newsRoutes.post("/data/:dataId", requireAuth, async (c) => {
  const person = c.get("person");
  const id = c.req.param("dataId");
  if (!isDataId(id) || !appRouteAllowed(person, "news", "data", id)) { bumpNewsCounter("route_refused"); return c.json({ error: "no such data" }, 404); }
  const body = await bodyOf(c);
  switch (id) {
    case "today": return c.json(await todayData(person, body), 200);
    case "mix": {
      const result = await mixData(person, body);
      if (!result) { bumpNewsCounter("route_refused"); return c.json({ error: "no such data" }, 404); }
      return c.json(result, 200);
    }
    case "channel": {
      const result = await channelData(person, body);
      if (!result) return c.json({ error: "That channel is not available." }, 404);
      return c.json(result, 200);
    }
    case "story": {
      const result = await storyData(person, body);
      if (!result) return c.json({ error: "That story is not available." }, 404);
      return c.json(result, 200);
    }
    case "household-today": return c.json(householdTodayData(person), 200);
    case "topics": return c.json(topicRows(person), 200);
    case "sources": return c.json(sourceRows(person), 200);
    case "saved": return c.json(savedRows(person), 200);
    case "search": return c.json(searchData(person, body), 200);
    case "search-recents": return c.json(recentRows(person), 200);
  }
});

newsRoutes.post("/actions/:action", requireAuth, async (c) => {
  const person = c.get("person");
  const action = c.req.param("action");
  if (!isAction(action) || !appRouteAllowed(person, "news", "actions", action)) { bumpNewsCounter("route_refused"); return c.json({ error: "no such action" }, 404); }
  const result = await runNewsAction(person, action, await bodyOf(c));
  return result.ok ? c.json(result.value, 200) : c.json({ error: result.error }, result.status);
});

// NEWS-ARTICLE-FIGURES-01: one picture inside an article. The number is looked up in the requester's own age-band copy of the
// stored article, so a child, a guessed item or a number past the article's pictures is a 404, never a fetch.
newsRoutes.get("/images/:item/figure/:n", requireAuth, async (c) => {
  const person = c.get("person");
  if (!appImageAllowed(person, "news")) { bumpNewsCounter("route_refused"); return c.json({ error: "no such picture" }, 404); }
  const rawWidth = c.req.query("w") ?? "";
  if (!/^(480|1280)$/.test(rawWidth)) return c.json({ error: "Ask for a picture 480 or 1280 pixels wide." }, 400);
  const rawNumber = c.req.param("n");
  if (!/^\d{1,2}$/.test(rawNumber)) return c.json({ error: "no such picture" }, 404);
  const viewer = viewerOf(person);
  const item = releasedItem(viewer, c.req.param("item"));
  if (!item) return c.json({ error: "no such picture" }, 404);
  const address = figureAddressesOf(item, viewer.band)[Number(rawNumber)];
  if (!address) return c.json({ error: "no such picture" }, 404);
  const picture = await newsFigurePicture(item.id, Number(rawNumber), address, Number(rawWidth) as NewsPictureWidth, viewer.band);
  if (!picture) return c.json({ error: "no such picture" }, 404);
  c.header("Content-Type", "image/webp");
  c.header("Cache-Control", "private, max-age=86400");
  c.header("ETag", picture.etag);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "default-src 'none'");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  if (c.req.header("if-none-match") === picture.etag) return c.body(null, 304);
  return c.body(new Uint8Array(picture.bytes), 200);
});

newsRoutes.get("/images/:item", requireAuth, async (c) => {
  const person = c.get("person");
  if (!appImageAllowed(person, "news")) { bumpNewsCounter("route_refused"); return c.json({ error: "no such picture" }, 404); }
  // The raw text, not a number: "0x1E0", "480.0" and " 480" are not 480.
  const rawWidth = c.req.query("w") ?? "";
  if (!/^(480|1280)$/.test(rawWidth)) return c.json({ error: "Ask for a picture 480 or 1280 pixels wide." }, 400);
  const width = Number(rawWidth);
  // The item must be one this person's band is released: a guessed id is a 404, never a fetch.
  const item = releasedItem(viewerOf(person), c.req.param("item"));
  if (!item) return c.json({ error: "no such picture" }, 404);
  const picture = await newsPicture(item, width as NewsPictureWidth, viewerOf(person).band);
  if (!picture) return c.json({ error: "no such picture" }, 404);
  c.header("Content-Type", "image/webp");
  c.header("Cache-Control", "private, max-age=86400");
  c.header("ETag", picture.etag);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "default-src 'none'");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  if (c.req.header("if-none-match") === picture.etag) return c.body(null, 304);
  return c.body(new Uint8Array(picture.bytes), 200);
});
