import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "@/types";
import { requireAuth } from "@/middleware/auth";
import { updateMediaProduction } from "@/lib/mediaProductions";
import { db } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createShow, getShow, listShows, makeEpisode, briefingToday, type CreateShowInput } from "@/lib/talent/shows";
import { loadFormats } from "@/lib/talent/formats";
import { queryItems } from "@/lib/media/appHost";
import { formatById } from "@/lib/talent/formats";
import { speakerAgeBand } from "@/lib/ageBand";

export const talentRoutes = new Hono<AppEnv>();
talentRoutes.use("*", requireAuth);
const source = z.object({ kind: z.enum(["news", "weather", "household", "documents", "media_item", "bookmarks"]), topics: z.array(z.string()).default([]), file_ids: z.array(z.string()).default([]), media_item_id: z.string().nullable().default(null) });
const schedule = z.object({ every: z.enum(["1d", "7d"]), at: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/), days: z.array(z.number().int().min(0).max(6)).default([]) }).nullable();
export const createShowSchema = z.object({ title: z.string().min(1).max(160), format_id: z.string(), cast: z.union([z.literal("invent"), z.array(z.object({ synth_id: z.string(), part: z.string() }))]), audience: z.enum(["all", "teen", "adult"]).optional(), sources: z.array(source), schedule, length_s: z.number().int().optional(), household_facts: z.boolean().optional() });

talentRoutes.get("/formats", (c) => c.json([...loadFormats().values()], 200));
talentRoutes.get("/shows", (c) => c.json({ shows: listShows(c.get("person")) }, 200));
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
  if (production.show?.state?.started_at && Date.now() - Date.parse(production.show.state.started_at) < 7_200_000 && production.show.state.stage !== "done") return c.json({ error: "An episode is being made right now. Wait for it to finish." }, 409);
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
