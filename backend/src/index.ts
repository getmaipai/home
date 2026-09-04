import { app } from "@/app";
import { ensureCoreJob, runDueJobs } from "@/lib/scheduler";
import { runSkill } from "@/lib/skills";

const port = Number(process.env.PORT ?? 8787);

// The scheduler's own timer: app.ts/routes stay import-only (no side
// effects) so tests booting the app via Hono's .request() never start a
// live interval; this is the one real entrypoint. 60s poll, not
// per-second: nothing scheduled through this slice needs finer
// granularity than a minute (see lib/scheduler.ts for what "when"
// supports). Seeds the one core job memory.ts's runMaintenance has
// wanted since it shipped ("no scheduler exists yet... manually-
// triggered for now"): daily, idempotent, safe to call on every boot.
ensureCoreJob("memory.maintenance", "every:1d");
setInterval(() => runDueJobs(runSkill), 60_000);

console.log(`MaiPai Home hub listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
