import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "@/types";
import { requireAuth } from "@/middleware/auth";
import { updateMediaProduction, listMediaProductions } from "@/lib/mediaProductions";
import { db } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { createShow, getShow, listShows, makeEpisode, briefingToday, type CreateShowInput } from "@/lib/talent/shows";
import { loadFormats } from "@/lib/talent/formats";
import { queryItems } from "@/lib/media/appHost";
import { formatById } from "@/lib/talent/formats";
import { speakerAgeBand } from "@/lib/ageBand";
import { getSynth } from "@/lib/synths";
import { listMade } from "@/lib/music/madeRecords";

export const talentRoutes = new Hono<AppEnv>();
talentRoutes.use("*", requireAuth);
const source = z.object({ kind: z.enum(["news", "weather", "household", "documents", "media_item", "bookmarks"]), topics: z.array(z.string()).default([]), file_ids: z.array(z.string()).default([]), media_item_id: z.string().nullable().default(null) });
const schedule = z.object({ every: z.enum(["1d", "7d"]), at: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/), days: z.array(z.number().int().min(0).max(6)).default([]) }).nullable();
export const createShowSchema = z.object({ title: z.string().min(1).max(160), format_id: z.string(), cast: z.union([z.literal("invent"), z.array(z.object({ synth_id: z.string(), part: z.string() }))]), audience: z.enum(["all", "teen", "adult"]).optional(), sources: z.array(source), schedule, length_s: z.number().int().optional(), household_facts: z.boolean().optional() });

talentRoutes.get("/formats", (c) => c.json([...loadFormats().values()], 200));
talentRoutes.get("/shows", (c) => c.json({ shows: listShows(c.get("person")) }, 200));
talentRoutes.get("/synths/:id/credits", (c) => {
  const actor = c.get("person"), synthId = c.req.param("id");
  if (!getSynth(actor, synthId)) return c.json({ error: "That synth is not available. Choose a synth you can use and try again." }, 404);
  const productions = listMediaProductions(actor).filter((production) => production.cast.some((member) => member.synth_id === synthId));
  const shows = productions.filter((production) => production.show !== null).map((production) => {
    const sourceRow = db.select().from(mediaSources).where(eq(mediaSources.productionId, production.id)).get();
    const episodes = sourceRow ? queryItems(actor, "podcasts", { where: eq(mediaItems.sourceId, sourceRow.id), limit: 200, order: [desc(mediaItems.addedAt)] }).map((item) => ({ item_id: item.id, title: item.title, aired_at: item.added_at, duration_s: item.duration_s })) : [];
    return { production_id: production.id, title: production.title, part: production.cast.find((member) => member.synth_id === synthId)?.part ?? "", episodes };
  }).sort((a, b) => (b.episodes[0]?.aired_at ?? "").localeCompare(a.episodes[0]?.aired_at ?? ""));
  const readableFilms = queryItems(actor, "shows", { limit: 1000, all: true });
  const filmItems = new Map(readableFilms.flatMap((item) => {
    const fileId = (item.location as { file_id?: string }).file_id;
    return fileId ? [[fileId, item] as const] : [];
  }));
  const films = productions.filter((production) => production.show === null).flatMap((production) => production.finished_cut_file_ids.flatMap((fileId) => {
    const item = filmItems.get(fileId);
    return item ? [{ production_id: production.id, title: item.title || production.title, part: production.cast.find((member) => member.synth_id === synthId)?.role ?? "", file_id: fileId, made_at: item.added_at }] : [];
  })).sort((a, b) => b.made_at.localeCompare(a.made_at));
  const made = listMade("made_artist", actor, { scope: "all" });
  const bands = made.ok ? made.value.filter((band) => Array.isArray(band.members) && band.members.some((member) => typeof member === "object" && member !== null && (member as { synth_id?: unknown }).synth_id === synthId)).map((band) => ({ made_artist_id: band.id, name: String(band.name ?? band.title ?? "Band"), role: String((band.members as Array<{ synth_id?: string; role?: string }>).find((member) => member.synth_id === synthId)?.role ?? "Member"), made_at: String(band.created_at ?? "") })).sort((a, b) => b.made_at.localeCompare(a.made_at)).map(({ made_at: _madeAt, ...band }) => band) : [];
  return c.json({ shows, films, bands }, 200);
});
talentRoutes.post("/shows", async (c) => {
  try { const input = createShowSchema.parse(await c.req.json()) as CreateShowInput; return c.json(await createShow(c.get("person"), input), 201); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "The show could not be created. Check its fields and try again." }, 400); }
});
talentRoutes.get("/shows/:id", (c) => { const show = getShow(c.get("person"), c.req.param("id")); return show ? c.json(show, 200) : c.json({ error: "That show is not available. Open one of your shows and try again." }, 404); });
talentRoutes.patch("/shows/:id", async (c) => {
  const actor = c.get("person"), current = getShow(actor, c.req.param("id"));
  if (!current || current.owner_person_id !== actor.id) return c.json({ error: "That show is not available to edit. Open one of your shows and try again." }, 404);
  try {
    const body = z.object({ title: z.string().min(1).max(160).optional(), schedule: schedule.optional(), sources: z.array(source).optional(), household_facts: z.boolean().optional(), length_s: z.number().int().optional() }).parse(await c.req.json());
    const format = formatById(current.show!.format_id)!;
    if (body.sources?.some((entry) => !format.sources_allowed.includes(entry.kind))) return c.json({ error: "This format cannot use the selected source. Choose a source listed for this format." }, 400);
    const show = { ...current.show!, ...body, length_s: body.length_s === undefined ? current.show!.length_s : Math.min(format.length_s.max, Math.max(format.length_s.min, body.length_s)) };
    const updated = updateMediaProduction(actor, current.id, { ...(body.title ? { title: body.title } : {}), show });
    return updated ? c.json(updated, 200) : c.json({ error: "That show could not be updated. Check its fields and try again." }, 400);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "That show could not be updated. Check its fields and try again." }, 400); }
});
talentRoutes.post("/shows/:id/episodes", (c) => {
  const actor = c.get("person"), production = getShow(actor, c.req.param("id"));
  if (!production || production.owner_person_id !== actor.id) return c.json({ error: "That show is not available to you. Open one of your shows and try again." }, 404);
  if (production.show?.state?.started_at && Date.now() - Date.parse(production.show.state.started_at) < 7_200_000 && production.show.state.stage !== "done" && !production.show.state.reason) return c.json({ error: "An episode is being made right now. Wait for it to finish." }, 409);
  void makeEpisode(actor, production.id).catch(() => {});
  return c.json({ production_id: production.id, stage: production.show?.state?.stage ?? "brief" }, 202);
});
talentRoutes.get("/shows/:id/episodes", (c) => {
  const actor = c.get("person"), production = getShow(actor, c.req.param("id"));
  if (!production) return c.json({ error: "That show is not available. Open one of your shows and try again." }, 404);
  const sourceRow = db.select().from(mediaSources).where(eq(mediaSources.productionId, production.id)).get();
  return c.json({ episodes: sourceRow ? queryItems(actor, "podcasts", { where: eq(mediaItems.sourceId, sourceRow.id), limit: 200 }) : [] }, 200);
});
talentRoutes.get("/briefing/today", (c) => c.json(briefingToday(c.get("person")), 200));
