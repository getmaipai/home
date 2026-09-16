import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { listJobs, cancelJob, runDueJobs } from "@/lib/scheduler";
import { runPlugin } from "@/lib/plugins";
import type { AppEnv } from "@/types";

export const schedulerRoutes = apiRouter();

const JobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  packageId: z.string(),
  job: z.string(),
  personId: z.string().nullable(),
  inputs: z.string(),
  when: z.string(),
  recurring: z.boolean(),
  nextRunAt: z.string(),
  status: z.string(),
  createdAt: z.string(),
  lastRunAt: z.string().nullable(),
  lastError: z.string().nullable(),
});

const listRoute = createRoute({
  method: "get",
  path: "/jobs",
  tags: ["Scheduler"],
  summary: "List scheduled jobs",
  description: "Owner/admin see every job; anyone else sees only their own.",
  middleware: [requireAuth] as const,
  responses: {
    200: {
      content: { "application/json": { schema: z.array(JobSchema) } },
      description: "The caller's jobs (all jobs for owner/admin).",
    },
  },
});

schedulerRoutes.openapi(listRoute, (c) => {
  const jobs = listJobs(c.get("person"));
  return c.json(jobs, 200);
});

const cancelRoute = createRoute({
  method: "post",
  path: "/jobs/{id}/cancel",
  tags: ["Scheduler"],
  summary: "Cancel a scheduled job",
  description: "Stops a pending job from running. Only the job's owner or an owner/admin can cancel it.",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id") },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
      description: "The job was cancelled.",
    },
    ...errorResponses({ 403: "Cannot cancel another person's job", 404: "Job not found" }),
  },
});

schedulerRoutes.openapi(cancelRoute, (c) => {
  const result = cancelJob(c.get("person"), c.req.valid("param").id);
  if (!result.ok) {
    return result.status === 404 ? c.json({ error: result.error }, 404) : c.json({ error: result.error }, 403);
  }
  return c.json({ ok: result.value }, 200);
});

// Manual trigger, the same "no scheduler timer yet" stand-in
// routes/memory.ts's POST /maintenance/run already uses: index.ts's real
// interval calls the same runDueJobs on a timer once the server is
// actually running, this just lets an owner/admin (or a test) fire it
// on demand without waiting.
const runDueRoute = createRoute({
  method: "post",
  path: "/run-due",
  tags: ["Scheduler"],
  summary: "Run all due jobs now",
  description: "Owner/admin only: fires every job whose time has come, without waiting for the interval timer.",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ran: z.number(), errors: z.number() }) } },
      description: "The count of jobs that ran and the count that errored.",
    },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});

schedulerRoutes.openapi(runDueRoute, async (c) => {
  const result = await runDueJobs(runPlugin);
  return c.json(result, 200);
});
