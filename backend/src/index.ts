import { app } from "@/app";
import { ensureCoreJob, runDueJobs } from "@/lib/scheduler";
import { runPlugin } from "@/lib/plugins";
import { cleanupStaleSnapshots } from "@/lib/backup";
import { sampleEngineStats } from "@/lib/engineStats";
import { startAllSidecars, registerGracefulExit } from "@/lib/sidecars";

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
// A memory whose embed() call failed at write time (embed backend down,
// or a transient error) sits in pending_embeddings until this retries
// it; every:1m is the finest grain the scheduler's own grammar supports,
// same real-minute cadence the plan asks for ("a core job retries every
// minute").
ensureCoreJob("memory.embedding_retry", "every:1m");
// The memory judge (step 6): "a post-turn core job" - every:1m so a
// household sees what got remembered soon after the conversation that
// produced it, not on the next day's maintenance pass. Consolidate is
// explicitly weekly per the plan; every:7d is the scheduler's own
// grammar for that (lib/scheduler.ts's `when` support, no time-of-day
// concept, same documented gap backup.run's own comment names).
ensureCoreJob("memory.judge", "every:1m");
ensureCoreJob("memory.consolidate", "every:7d");
// 2.5 asks for "daily at a household-set time in the nightly window";
// the scheduler's `when` grammar has no time-of-day concept yet (a
// pre-existing, already-documented gap, see lib/scheduler.ts's own header
// comment), so this is a relative daily interval from whenever the job
// first seeds, not a real nightly-window guarantee.
ensureCoreJob("backup.run", "every:1d");
// A crash between VACUUM INTO and encryption (backup.ts) can leave an
// unencrypted snapshot on disk; swept here too, not just at the top of
// every runBackup() call, so a process that crashed mid-backup and then
// restarted cleans up within seconds instead of waiting up to a day for
// the next scheduled run.
cleanupStaleSnapshots();
// The graceful-exit hook first, then start whatever's registered: no
// sidecar is registered by core itself yet (D's SearXNG and C's voice
// programs are the first real registrants, wave-2.md's own contract), so
// this boots an empty registry today - proving the wiring rather than
// waiting for a first caller to also have to remember it.
registerGracefulExit();
void startAllSidecars();
setInterval(() => {
  runDueJobs(runPlugin).catch((err: Error) => console.error(`[scheduler] runDueJobs failed: ${err.message}`));
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
