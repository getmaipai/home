import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { canStopJob, createJob, listJobsForViewerLive } from "@/lib/jobs";
import { trigger } from "@/lib/notifications";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import type { AppEnv } from "@/types";

export const jobsRoutes = apiRouter();
const HomeJobSchema = z.object({
  id: z.string(), kind: z.string(), state: z.string().optional(), startedBy: z.string().optional(), forPerson: z.string().nullable().optional(), title: z.string().optional(),
  progress: z.record(z.string(), z.unknown()).nullable().optional(), waitingReason: z.string().nullable().optional(),
  legacyProgress: z.record(z.string(), z.unknown()).nullable().optional(),
  resultRef: z.string().nullable().optional(), conversationId: z.string().nullable().optional(), errorKind: z.string().nullable().optional(),
  raw: z.string().nullable().optional(), provenance: z.record(z.string(), z.unknown()).optional(), createdAt: z.string().optional(), updatedAt: z.string().optional(),
  durationSeconds: z.number().optional(),
});

const listRoute = createRoute({ method: "get", path: "/", tags: ["Jobs"], summary: "List background work visible to the signed-in person", middleware: [requireAuth] as const, responses: { 200: { content: { "application/json": { schema: z.array(HomeJobSchema) } }, description: "Current visible job snapshot." }, ...errorResponses({ 401: "Sign in first" }) } });
jobsRoutes.openapi(listRoute, async (c) => c.json(await listJobsForViewerLive(c.get("person")) as z.infer<typeof HomeJobSchema>[], 200));

const createBody = z.object({ id: z.string().min(1), kind: z.string().min(1), startedBy: z.string().min(1), forPerson: z.string().nullable(), title: z.string().min(1), state: z.enum(["queued", "running", "waiting_for_you", "paused", "done", "failed", "cancelled"]), progress: z.record(z.string(), z.unknown()).nullable().default(null), waitingReason: z.string().nullable().default(null), resultRef: z.string().nullable().default(null), conversationId: z.string().nullable().default(null), errorKind: z.enum(["down", "timed_out", "refused", "ran_out_of_space", "interrupted", "failed", "unknown"]).nullable().default(null), raw: z.string().nullable().default(null), provenance: z.record(z.string(), z.unknown()).default({}) }).strict();
const createRouteDef = createRoute({ method: "post", path: "/", tags: ["Jobs"], summary: "Register visible state for a producer-owned background job", middleware: [requireAuth] as const, request: { body: { content: { "application/json": { schema: createBody } } } }, responses: { 201: { content: { "application/json": { schema: HomeJobSchema } }, description: "Job registered." }, ...errorResponses({ 401: "Sign in first", 403: "Cannot register work for another person", 409: "Job id already exists" }) } });
jobsRoutes.openapi(createRouteDef, (c) => {
  const actor = c.get("person"); const input = c.req.valid("json");
  if (input.startedBy !== actor.id || input.forPerson !== actor.id) return c.json({ error: "jobs may only be registered for the signed-in person" }, 403);
  if (db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, input.id)).get()) return c.json({ error: "job id already exists" }, 409);
  return c.json(createJob(input), 201);
});

const stopRoute = createRoute({ method: "post", path: "/{id}/stop", tags: ["Jobs"], summary: "Stop a background job", middleware: [requireAuth] as const, request: { params: idParamSchema("id") }, responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } }, description: "Stop recorded." }, ...errorResponses({ 401: "Sign in first", 403: "Cannot stop this job", 404: "Job not found", 409: "Job is not running" }) } });
jobsRoutes.openapi(stopRoute, async (c) => {
  const actor = c.get("person"); const id = c.req.valid("param").id;
  const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!row) return c.json({ error: "job not found" }, 404);
  if (!canStopJob(actor, row.forPerson, row.startedBy)) return c.json({ error: "cannot stop this job" }, 403);
  if (!["queued", "running", "paused", "waiting_for_you"].includes(row.state)) return c.json({ error: "job is not active" }, 409);
  const provenance = JSON.parse(row.provenance) as Record<string, unknown>;
  if (typeof provenance.stackJobId === "string" && isStackConfigured()) {
    try {
      const stopped = await getStackClient().cancelJob(provenance.stackJobId);
      if (stopped.state !== "cancelled" && stopped.state !== "done" && stopped.state !== "failed") return c.json({ error: "this job could not be stopped" }, 409);
      if (stopped.state === "done" || stopped.state === "failed") return c.json({ error: "job is not active" }, 409);
    }
    catch { return c.json({ error: "this job could not be stopped" }, 409); }
  }
  provenance.actions = [...(Array.isArray(provenance.actions) ? provenance.actions : []), { action: "stop", by: actor.id, at: new Date().toISOString(), admin: actor.id !== row.startedBy }];
  db.update(jobs).set({ state: "cancelled", provenance: JSON.stringify(provenance), updatedAt: new Date().toISOString() }).where(eq(jobs.id, id)).run();
  if (actor.id !== row.startedBy && row.forPerson) await trigger("jobs.admin_stopped", {}, { personId: row.forPerson });
  return c.json({ ok: true as const }, 200);
});

export type JobsEnv = AppEnv;
