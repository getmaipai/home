import { app } from "@/app";
import { ensureCoreJob, runDueJobs } from "@/lib/scheduler";
import { runPlugin } from "@/lib/plugins";
import { cleanupStaleSnapshots } from "@/lib/backup";
import { sampleEngineStats } from "@/lib/engineStats";
import { runAllSmokeTests } from "@/lib/smoke";

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
ensureCoreJob("conversation.retention", "every:1d");
// 2.5 asks for "daily at a household-set time in the nightly window";
// the scheduler's `when` grammar has no time-of-day concept yet (a
// pre-existing, already-documented gap, see lib/scheduler.ts's own header
// comment), so this is a relative daily interval from whenever the job
// first seeds, not a real nightly-window guarantee.
ensureCoreJob("backup.run", "every:1d");
// docs/PACKAGES.md's bronze bar: smoke "at install, at every update, and
// on a schedule" (lib/smoke.ts). No install/update flow exists yet
// (session-d step 6 builds the store), so a boot-time pass below stands
// in for "at install" until then; this daily job is the real "on a
// schedule" half.
ensureCoreJob("packages.smoke", "every:1d");
void runAllSmokeTests().then(({ ran, failed }) => {
  if (failed > 0) console.error(`[smoke] ${failed}/${ran} bundled package(s) failed their smoke test at boot`);
});
// A crash between VACUUM INTO and encryption (backup.ts) can leave an
// unencrypted snapshot on disk; swept here too, not just at the top of
// every runBackup() call, so a process that crashed mid-backup and then
// restarted cleans up within seconds instead of waiting up to a day for
// the next scheduled run.
cleanupStaleSnapshots();
setInterval(() => {
  runDueJobs(runPlugin, new Date(), {
    "packages.smoke": async () => {
      await runAllSmokeTests();
    },
  }).catch((err: Error) => console.error(`[scheduler] runDueJobs failed: ${err.message}`));
}, 60_000);
// engineStats.ts's ring buffer, same 60s cadence as the job poll above -
// "how busy the machine has been" (Jesse, 2026-09-04) doesn't need finer
// granularity than that to show a real trend.
setInterval(() => void sampleEngineStats(), 60_000);

console.log(`MaiPai Home hub listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
