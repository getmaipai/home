import { Hono, type Context } from "hono";
import { requireAuth, requireRole } from "@/middleware/auth";
import { listJobs, cancelJob, runDueJobs, type SchedulerOpResult } from "@/lib/scheduler";
import { runSkill } from "@/lib/skills";
import type { AppEnv } from "@/types";

export const schedulerRoutes = new Hono<AppEnv>();

function fail(c: Context<AppEnv>, result: Extract<SchedulerOpResult<unknown>, { ok: false }>) {
  return c.json({ error: result.error }, result.status);
}

schedulerRoutes.get("/jobs", requireAuth, async (c) => {
  return c.json(listJobs(c.get("person")));
});

schedulerRoutes.post("/jobs/:id/cancel", requireAuth, async (c) => {
  const result = cancelJob(c.get("person"), c.req.param("id"));
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

// Manual trigger, the same "no scheduler timer yet" stand-in
// routes/memory.ts's POST /maintenance/run already uses: index.ts's real
// interval calls the same runDueJobs on a timer once the server is
// actually running, this just lets an owner/admin (or a test) fire it
// on demand without waiting.
schedulerRoutes.post("/run-due", requireRole("owner", "admin"), async (c) => {
  return c.json(await runDueJobs(runSkill));
});
