import { app } from "@/app";
import { ensureCoreJob, runDueJobs } from "@/lib/scheduler";
import { runPlugin, registerAllPackageNotificationTypes, runDueWarmJobs } from "@/lib/plugins";
import { cleanupStaleSnapshots } from "@/lib/backup";
import { sampleEngineStats } from "@/lib/engineStats";
import { startAllSidecars, registerGracefulExit } from "@/lib/sidecars";
import { initCrashBootHold } from "@/lib/dirtyBoot";
import { sweepOrphanEngineProcesses } from "@/lib/llmSupervisor";
import { runAllSmokeTests } from "@/lib/smoke";
import { startIdleSweep, registerDenoHostGracefulExit } from "@/lib/denoHost";
import { hasHouseholdLeaf, getHouseholdLeafForServer, checkLeafExpiry, onLeafRenewed, registerRenewFixHandler } from "@/lib/householdCa";
import { advertiseMdns } from "@/lib/mdns";

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
// docs/PACKAGES.md's bronze bar: smoke "at install, at every update, and
// on a schedule" (lib/smoke.ts). No install/update flow exists yet
// (session-d step 6 builds the store), so a boot-time pass below stands
// in for "at install" until then; this daily job is the real "on a
// schedule" half.
ensureCoreJob("packages.smoke", "every:1d");
// Step 3: the poll cadence for lib/plugins.ts's runDueWarmJobs(), not a
// per-package interval - every:15m is the finest grain a package's own
// warm.schedule could ever need to be checked against without adding a
// scheduled_jobs row per package (lib/plugins.ts's own comment on why).
ensureCoreJob("packages.warm", "every:15m");
// Step 2: every bundled package's own declared notification types become
// real, dispatchable ones in F's registry before the first turn or
// scheduled job could ever try to trigger() one.
registerAllPackageNotificationTypes();
void runAllSmokeTests().then(({ ran, failed }) => {
  if (failed > 0) console.error(`[smoke] ${failed}/${ran} bundled package(s) failed their smoke test at boot`);
});
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
registerDenoHostGracefulExit();
// A code review (2026-09-06) found these three fire-and-forget (the
// original comments here promised "before anything real spawns" and "no
// real engine spawn happens before the first request arrives" without
// anything actually enforcing that ordering): Bun starts serving requests
// the instant this module finishes evaluating, which could race a very
// early chat/embed request against the sweep still deciding what to kill,
// or against the hold flag not being set yet. Top-level await blocks this
// module's own evaluation - and so Bun picking up the `export default`
// below - until both finish, which the sub-second-to-low-single-digit-
// second cost of an OS process scan and log query is worth paying once at
// boot for. startAllSidecars() stays fire-and-forget: it's an ongoing
// health-poll loop, not a one-shot check with a real finish line, and
// nothing registers a sidecar yet (D's SearXNG and C's voice programs are
// the first real registrants).
await sweepOrphanEngineProcesses();
await initCrashBootHold();
void startAllSidecars();
// Step 5: idle Tier 1 sandbox processes get closed after ten minutes -
// nothing is running yet at boot (every Deno process starts lazily, on
// a package's first real call), so this just arms the sweep.
startIdleSweep();
setInterval(() => {
  runDueJobs(runPlugin, new Date(), {
    "packages.smoke": async () => {
      await runAllSmokeTests();
    },
    "packages.warm": async () => {
      await runDueWarmJobs();
    },
  }).catch((err: Error) => console.error(`[scheduler] runDueJobs failed: ${err.message}`));
}, 60_000);
// engineStats.ts's ring buffer, same 60s cadence as the job poll above -
// "how busy the machine has been" (Jesse, 2026-09-04) doesn't need finer
// granularity than that to show a real trend.
setInterval(() => void sampleEngineStats(), 60_000);
// lib/householdCa.ts's own "rotation as a Repairs item" - once a day is
// plenty for a 30-day warning window; the job itself is idempotent and
// cheap (a single file read and a date comparison) when nothing's close
// to expiring, which is every day but the last 30 of a year.
ensureCoreJob("householdCa.check_leaf_expiry", "every:1d");

// A code review (2026-09-06) found the "Renew now" Repairs fix silently
// broken across a restart: registerRenewFixHandler() was only ever
// called lazily from inside ensureHouseholdLeaf()/checkLeafExpiry(),
// neither of which the boot path calls (hasHouseholdLeaf() just below is
// a pure existence check). A leaf_expiring/leaf_stale issue raised in a
// PREVIOUS process run survives in the issues table across a restart, so
// its fix handler needs to exist from the moment this process can serve
// a fixIssue() call, not from whenever the daily job or a setup page hit
// happens to trigger it. Registering it unconditionally here, every
// boot, costs nothing (Map.set on the same key is a no-op re-add) and
// closes that gap.
registerRenewFixHandler();

// Session F, step 5: TLS only when a leaf certificate already exists on
// THIS install's own data directory - nothing here ever mints one
// automatically, so every other worktree/session's dev server (and every
// test run, which never calls GET /api/setup/ca) keeps serving plain
// HTTP exactly as before. A household that has been through the trust
// step gets real TLS from the very next restart; one that hasn't is
// completely unaffected.
const initialTls = hasHouseholdLeaf() ? getHouseholdLeafForServer() : null;

console.log(`MaiPai Home hub listening on ${initialTls ? "https" : "http"}://localhost:${port}`);

// An explicit Bun.serve() call, not the `export default { port, fetch }`
// shape used before this step, so a `server` handle exists to rebind
// later. A code review (2026-09-06) first tried `server.reload({ tls })`
// to pick up a renewed leaf, then a SECOND review pass caught that this
// doesn't actually work: Bun's own bundled types document reload() as
// swapping only the fetch/error handlers ("passing other options...has
// no effect"), confirmed empirically here (a reload with a different
// cert kept serving the original one - see tests/tlsHotSwap.test.ts). The
// real fix, also verified empirically there: a graceful server.stop(true)
// (finishes in-flight requests, refuses new ones) followed by a fresh
// Bun.serve() on the same port picks up new TLS immediately. This is a
// genuine, if brief, connection interruption at renewal time (roughly
// once every ~11 months in the ordinary case, or the moment a "Renew
// now" fix runs) - there's no process supervisor yet to hand a full
// restart to (that lands with step 11's install/service work), so an
// in-process rebind is the honest option available today, and far better
// than either a silent no-op or exiting the process with nothing
// configured to bring it back up.
let server = Bun.serve({
  port,
  fetch: app.fetch,
  ...(initialTls ? { tls: initialTls } : {}),
});

// mDNS advertisement (lib/mdns.ts): best-effort, never blocks boot - a
// household on a network that filters multicast just doesn't get
// auto-discovery, the same "never a false alarm, never a hard failure"
// posture this step's other guards already take.
void advertiseMdns({ port, tls: initialTls !== null });

// Fires only when ensureHouseholdLeaf() actually regenerated a leaf
// (never on every call) - rebinds the live server with the new
// certificate and re-advertises mDNS with the now-current `tls` TXT
// value, closing both gaps the code review found: a renewed certificate
// the running process never actually picked up, and an mDNS
// advertisement stuck claiming `tls: 0` (or `1`) forever after the state
// that produced it changed.
onLeafRenewed((leaf) => {
  server.stop(true);
  server = Bun.serve({ port, fetch: app.fetch, tls: { cert: leaf.certPem, key: leaf.keyPem } });
  void advertiseMdns({ port, tls: true });
});
