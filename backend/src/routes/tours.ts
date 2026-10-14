import { apiRouter } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { nextHlc } from "@/lib/hlc";
import { TourProgress } from "@maipai/spec/gen/ts/tour-progress.js";

export const toursRoutes = apiRouter();
const progressKey = "_tours.progress";
const missingKey = "_tours.target-missing";

toursRoutes.get("/progress", requireAuth, (c) => {
  const person = c.get("person");
  const row = db.select().from(settingsValues).where(eq(settingsValues.scope, `person:${person.id}`)).all()
    .find((item) => item.key === progressKey);
  if (!row) return c.json([]);
  try {
    const parsed = JSON.parse(row.value);
    return c.json(Array.isArray(parsed) ? parsed.filter((item) => TourProgress.safeParse(item).success) : []);
  } catch {
    return c.json([]);
  }
});

toursRoutes.post("/progress", requireAuth, async (c) => {
  const person = c.get("person");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.tour_id !== "string" || typeof body.package_id !== "string" || !Number.isInteger(body.version) || !["completed", "skipped", "dismissed"].includes(String(body.status)) || typeof body.step_reached !== "string") {
    return c.json({ error: "invalid tour progress" }, 400);
  }
  const scope = `person:${person.id}`;
  const current = db.select().from(settingsValues).where(eq(settingsValues.scope, scope)).all().find((item) => item.key === progressKey);
  let records: unknown[] = [];
  try { records = current ? JSON.parse(current.value) as unknown[] : []; } catch { records = []; }
  const at = new Date().toISOString();
  const id = `tour-progress-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const value = TourProgress.parse({
    id, person_id: person.id, tour_id: body.tour_id, package_id: body.package_id,
    version: body.version, status: body.status, step_reached: body.step_reached,
    at, source: "hub", hlc: nextHlc(), provenance: `manifest:${body.package_id}`,
  });
  const next = [...records.filter((item) => !(item && typeof item === "object" && (item as { tour_id?: unknown }).tour_id === value.tour_id && (item as { version?: unknown }).version === value.version)), value];
  if (current) db.update(settingsValues).set({ value: JSON.stringify(next), hlc: value.hlc, source: "hub", updatedAt: at }).where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, progressKey))).run();
  else db.insert(settingsValues).values({ scope, key: progressKey, value: JSON.stringify(next), hlc: value.hlc, source: "hub", updatedAt: at }).run();
  return c.json(value, 201);
});

toursRoutes.post("/missing-target", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.package_id !== "string" || typeof body.tour_id !== "string" || typeof body.step_id !== "string") return c.json({ error: "invalid target counter" }, 400);
  const key = `${body.package_id}:${body.tour_id}:${body.step_id}`;
  const current = db.select().from(settingsValues).where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, missingKey))).get();
  let counts: Record<string, number> = {};
  try { counts = current ? JSON.parse(current.value) as Record<string, number> : {}; } catch { counts = {}; }
  counts[key] = (counts[key] ?? 0) + 1;
  const at = new Date().toISOString();
  const hlc = nextHlc();
  if (current) db.update(settingsValues).set({ value: JSON.stringify(counts), hlc, source: "hub", updatedAt: at }).where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, missingKey))).run();
  else db.insert(settingsValues).values({ scope: "household", key: missingKey, value: JSON.stringify(counts), hlc, source: "hub", updatedAt: at }).run();
  return c.json({ success: true }, 200);
});

toursRoutes.get("/missing-targets", requireRole("owner", "admin"), (c) => {
  const row = db.select().from(settingsValues).where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, missingKey))).get();
  try {
    const counts = row ? JSON.parse(row.value) as Record<string, number> : {};
    return c.json(Object.entries(counts).map(([key, count]) => ({ key, count })));
  } catch {
    return c.json([]);
  }
});
