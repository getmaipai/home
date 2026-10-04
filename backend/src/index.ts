// SINGLE-INSTANCE-01 (#194): must stay the FIRST import. It refuses a stray
// data directory and takes the data directory's one-hub lock before any
// later import (app, db, keystore) can open the database.
import { instanceLock } from "@/lib/bootGuard";
import { app } from "@/app";
import { ensureCoreJob, runDueJobs } from "@/lib/scheduler";
import { runPlugin, registerAllPackageNotificationTypes, registerAllPackageProjectTypes, runDueWarmJobs } from "@/lib/plugins";
import { cleanupStaleSnapshots } from "@/lib/backup";
import { sampleEngineStats } from "@/lib/engineStats";
import { startAllSidecars, registerGracefulExit } from "@/lib/sidecars";
import { startKiwixSidecar } from "@/lib/kiwixSidecar";
import { initCrashBootHold } from "@/lib/dirtyBoot";
import { sweepOrphanEngineProcesses, getChatClient, setWarmupPrompt } from "@/lib/llmSupervisor";
import { turnWarmupPrompt } from "@/lib/turnMachine/warmup";
import { engineWarmupsForStackRoles } from "@/lib/engineBoot";
import { runAllSmokeTests } from "@/lib/smoke";
import { startIdleSweep, registerDenoHostGracefulExit } from "@/lib/denoHost";
import { hasHouseholdLeaf, getHouseholdLeafForServer, checkLeafExpiry, onLeafRenewed, registerRenewFixHandler } from "@/lib/householdCa";
import { advertiseMdns } from "@/lib/mdns";
import { rebindWithRetry } from "@/lib/serverRebind";
import { SERVER_IDLE_TIMEOUT_SECONDS } from "@/lib/serverConfig";
import { raiseIssue } from "@/lib/issues";
import { startWyomingServer } from "@/lib/wyomingServer";
import { websocket } from "hono/bun";
import { seedHlcFromDatabase } from "@/lib/hlc";
import { recoverInterruptedJobsAtBoot } from "@/lib/modelDownloadJobs";
import { startupUrls } from "@/lib/startupUrls";
import { installConsoleFileMirror, installFatalErrorHandlers, appendLogLine } from "@/lib/log";
import { shutdownEngines } from "@/lib/hubShutdown";
import { ensureSecretPepperReady } from "@/lib/secret";
import { KeystoreProtectionFailedError } from "@/lib/keystore";
import { recordBootGap, recordStatusSample, pruneStatusEvents } from "@/lib/statusHistory";
import { runConfiguredInternetProbe } from "@/lib/internetProbe";
import { syncStackRequirementIssue } from "@/lib/stackRequirement";

const configuredPort = Number(process.env.PORT ?? 8787);
installConsoleFileMirror();
installFatalErrorHandlers(shutdownEngines);

// core-v0.1.0's keystore refuses to silently fall back to an unprotected
// plaintext key when Windows DPAPI fails (KeystoreProtectionFailedError,
// where the old code used to write the raw key to disk instead). Forcing
// the household's own pepper to resolve here, before the server accepts
// a single request, turns that into a refused boot with a clear reason
// instead of a random first sign-in's own opaque 500.
try {
  ensureSecretPepperReady();
} catch (err) {
  if (err instanceof KeystoreProtectionFailedError) {
    appendLogLine(`[fatal] boot refused: ${err.message}`);
    console.error(`[fatal] boot refused: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

// FAST-01: set up the warmup prompt provider for cache priming after engine
// spawn: the one turn path's stable prefix and tools block, so the primed
// prefix is the one a real turn reuses.
setWarmupPrompt(turnWarmupPrompt);

// COR-6 (code review, 2026-09-06): before anything below this line can
// possibly write a fresh hlc, recover monotonicity from every table that
// stamps one, not just settings_values (lib/settings.ts's own narrower
// module-load seeding, still there - see lib/hlc.ts's own header on why
// the wider seed lives here instead of scattered per-table).
seedHlcFromDatabase();
void syncStackRequirementIssue();
await recordBootGap();
void recordStatusSample();

// COR-8 (code review, 2026-09-06): activeJob (lib/modelDownloadJobs.ts)
// is in-memory only and always starts null on a fresh process - a crash
// mid-download left the job ROW in whatever non-terminal status it was
// in, with GET /models/:id/select-status reporting that phantom job
// forever. Correcting it once, here, before anything else touches
// download-job state.
recoverInterruptedJobsAtBoot();

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
// Step 9: the disk-full policy's own "then a Repairs item" half - see
// lib/storage.ts's own header for why "caches first" needs no job at
// all here (already automatic in lib/packageCache.ts). Every 1h, not
// daily: unlike a backup, running low on disk is not something a
// household should ever wait most of a day to hear about.
ensureCoreJob("storage.check_disk_full", "every:1h");
// STORE-CAP-01: a directory walk under attachmentsDir compared against
// every File record's storage_path - real I/O work, not a cheap statfs
// call, so daily like backup.run rather than hourly like the disk-full
// check above.
ensureCoreJob("storage.reconcile_files", "every:1d");
// A dead/outdated/misconfigured SearXNG instance is the same "don't wait
// most of a day to hear about it" shape as disk space, not the leaf
// cert's own 1d cadence (lib/searxngHealth.ts's own header has the full
// reasoning) - a no-op tick for a household that hasn't configured web
// search at all. SEARCH-HEALTH-01: the tick itself is every 15 minutes
// (the scheduler's own recurrence is fixed per job, not conditional),
// but `checkSearxngHealth()` only actually probes that often while
// search is down or degraded, its own throttle for the healthy case -
// a review, 2026-09-24, caught the first cut probing unconditionally
// at this cadence, 96 real requests a day against a healthy instance
// with no need, exactly the fan-out THIRD-PARTY-SERVICES.md rules out.
// A tick that finds nothing wrong and isn't yet due for its hourly
// check is a fast no-op, so the 15-minute schedule itself costs
// nothing extra to keep - only the real probes it gates are budgeted.
ensureCoreJob("websearch.check_searxng_health", "every:15m");
// Step 10: "one check a day" against GitHub's own public release API -
// see lib/updates.ts's own header for the full scope (app only; the
// plan's packages/models/sidecars projection halves are deferred, no
// catalog or per-model version tracking exists yet to check against).
ensureCoreJob("updates.check", "every:1d");
// HOME-STACK-05: same daily cadence as the app's own check above - the
// job itself is a no-op when engines.stack.url is empty or the
// household hasn't turned stack.updates.enabled on.
ensureCoreJob("stack.updates.maintenance", "every:1d");
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
// PROJECT-PKGTYPE-01: every bundled `kind: "project"` package's own
// manifest + plan.json becomes a real, registered project type before
// the first turn could ever offer start_project.
registerAllPackageProjectTypes();
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
// Fix A2 (docs/dev.md's 2026-09-07 incident note): this runs on every
// `bun --hot` reload too, not just a real process boot - passing embed's
// and tts's own live pids alongside chat's (llmSupervisor.ts's own
// `state.chatBackend`, checked inside sweepOrphanEngineProcesses() itself)
// keeps a reload from SIGKILLing its own still-healthy engines, the
// concrete fix for the incident that respawned qwen3-8b eleven times in
// one evening and killed a reply mid-turn. JOIN-02 (2026-09-13): the
// memory engine (MEM-01's background supervisor) runs the same binary
// from the same engines directory, so without its pid here a reload
// swept the judge's engine mid-extraction.
await sweepOrphanEngineProcesses([]);
await initCrashBootHold();
// KIWIX-SIDECAR-01: registers (installing the pinned binary on first
// boot only) and starts, fire-and-forget like startAllSidecars() below
// (it never throws - a failed install or start is a logged line and a
// Repairs issue, not a boot failure). Called before startAllSidecars()
// so a sidecar registered here is already in the registry by the time
// that pass runs; startSidecar() is idempotent, so the two racing is
// harmless either way.
void startKiwixSidecar();
void startAllSidecars();
// Warm Home-owned chat when the Stack does not serve it.
for (const role of engineWarmupsForStackRoles()) {
  const warmup = getChatClient;
  void warmup().catch((err: unknown) => console.error(`[boot] ${role} engine warm-up: ${(err as Error).message}`));
}
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
const statusSampleInterval = setInterval(() => void recordStatusSample(), 30_000);
statusSampleInterval.unref();
const internetProbeSample = async () => {
  try {
    const state = await runConfiguredInternetProbe();
    if (state) await recordStatusSample(new Date(), state);
  } catch (error) {
    console.error(`[status-history] internet probe failed: ${(error as Error).message}`);
  }
};
void internetProbeSample();
const internetProbeInterval = setInterval(() => void internetProbeSample(), 60_000);
internetProbeInterval.unref();
const statusPruneInterval = setInterval(() => pruneStatusEvents(), 6 * 60 * 60_000);
statusPruneInterval.unref();
// lib/householdCa.ts's own "rotation as a Repairs item" - once a day is
// plenty for a 30-day warning window; the job itself is idempotent and
// cheap (a single file read and a date comparison) when nothing's close
// to expiring, which is every day but the last 30 of a year.
ensureCoreJob("householdCa.check_leaf_expiry", "every:1d");
// Step 7: guest expiry and the age-band birthday sweep - see
// lib/scheduler.ts's own CORE_JOBS entries for why daily is enough for
// both.
ensureCoreJob("people.disable_expired_guests", "every:1d");
ensureCoreJob("people.apply_age_band_changes", "every:1d");
// SRC-ICON-01: the source favicon cache's own daily sweep -
// lib/scheduler.ts's own CORE_JOBS entry, lib/favicons.ts for the
// expiry and size-cap mechanics.
ensureCoreJob("favicons.sweep", "every:1d");

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
//
// idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS (lib/serverConfig.ts) keeps
// the listener's response window above Bun's short default.
let server = Bun.serve({
  port: configuredPort,
  fetch: app.fetch,
  // Session C step 5: routes/stt.ts's WS /api/stt/stream, hono/bun's own
  // adapter (upgradeWebSocket() calls server.upgrade() internally; this
  // handler is what actually processes the open/message/close lifecycle
  // Bun's upgrade alone doesn't). Harmless to every other route: Bun
  // only ever invokes it for a connection an upgradeWebSocket() call
  // accepted, never for a plain HTTP request.
  websocket,
  idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
  ...(initialTls ? { tls: initialTls } : {}),
});

instanceLock.setPort(server.port!);
let servingTls = initialTls !== null;
function printStartupUrls(): void {
  for (const url of startupUrls(server.port!, servingTls)) {
    console.log(`Home URL: ${url}`);
  }
  console.log("Home server ready.");
}
// The local source launcher asks for current addresses without restarting.
if (process.platform !== "win32") process.on("SIGUSR1", printStartupUrls);
printStartupUrls();

// mDNS advertisement (lib/mdns.ts): best-effort, never blocks boot - a
// household on a network that filters multicast just doesn't get
// auto-discovery, the same "never a false alarm, never a hard failure"
// posture this step's other guards already take.
void advertiseMdns({ port: server.port!, tls: initialTls !== null });

// Fires only when ensureHouseholdLeaf() actually regenerated a leaf
// (never on every call) - rebinds the live server with the new
// certificate and re-advertises mDNS with the now-current `tls` TXT
// value, closing both gaps the code review found: a renewed certificate
// the running process never actually picked up, and an mDNS
// advertisement stuck claiming `tls: 0` (or `1`) forever after the state
// that produced it changed.
// COR-3 (code review, 2026-09-06): the rebind used to run with no
// try/catch, synchronously inside ensureHouseholdLeaf()'s own listener
// loop - a bind failure (port briefly held, EADDRINUSE, or a bad PEM)
// threw straight out of whichever caller awaited ensureHouseholdLeaf()
// (GET /api/setup/ca, unauthenticated), leaving the hub with no listener
// at all. rebindWithRetry() (lib/serverRebind.ts) retries a few times
// (the port the just-stopped server held usually frees up within one or
// two hundred ms) before this raises a Repairs issue instead - honest
// about the fact that a genuinely bad certificate still leaves the hub
// down until a manual restart (no process supervisor exists yet to hand
// a real restart to, this file's own header above already names that
// gap), but no longer a silent, uncaught exception either.
onLeafRenewed((leaf) => {
  server.stop(true);
  void rebindWithRetry(() => Bun.serve({ port: server.port!, fetch: app.fetch, websocket, idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS, tls: { cert: leaf.certPem, key: leaf.keyPem } }))
    .then(({ server: newServer }) => {
      server = newServer;
      servingTls = true;
      printStartupUrls();
      void advertiseMdns({ port: newServer.port!, tls: true });
    })
    .catch((err: unknown) => {
      const message = (err as Error).message;
      console.error(`[index] TLS rebind after leaf renewal failed after retries, the hub has no listener: ${message}`);
      void raiseIssue({
        source: "householdCa",
        key: "tls_rebind_failed",
        severity: "error",
        title: "The hub's web server failed to restart after renewing its certificate",
        detail: message,
      });
    });
});

// The Wyoming satellite server (session-c-brain-and-voice.md step 8): a
// separate TCP listener, not routed through Bun.serve()/Hono at all -
// Wyoming is a raw newline-delimited-JSON protocol on its own socket,
// nothing like HTTP. No env-var convention exists yet for this hub's own
// port choice (Wyoming itself doesn't mandate one; each real ecosystem
// service - faster-whisper, piper, openwakeword - picks its own and gets
// found by IP:port, mDNS, or manual config in Home Assistant), so
// MAIPAI_WYOMING_PORT is this hub's own, defaulting to 10700 rather than
// colliding with any of those well-known ones. Started unconditionally
// at boot, same as the main HTTP server - lib/wyomingServer.ts's own
// authentication gate (not "don't listen at all") is what keeps this
// safe to have running by default, matching the plan's own "never open
// on the LAN as admin" requirement.
// A genuine bind failure (a stale process, a second hub instance, or
// anything else really holding this port - wyomingServer.ts's own
// `bun --hot` self-conflict case never reaches this catch, it returns a
// handle instead of throwing) is raised as a Repairs issue rather than
// taking the whole boot down with it, the same COR-3 pattern the TLS
// rebind above uses: Wyoming is a secondary protocol for satellite
// devices, not something a chat/embed/HTTP-serving hub should die over.
let wyomingServer: ReturnType<typeof startWyomingServer> | null = null;
let screenshotPortBlocker: import("bun").TCPSocketListener<undefined> | undefined;
try {
  const configuredWyomingPort = Number(process.env.MAIPAI_WYOMING_PORT ?? 10700);
  if (process.env.MAIPAI_SCREENSHOT_TEST_WYOMING_BIND_FAILURE === "1") {
    screenshotPortBlocker = Bun.listen({ hostname: "0.0.0.0", port: configuredWyomingPort, socket: { data() {}, open() {} } });
    console.error("[index] screenshot fixture requested Wyoming bind failure");
  }
  wyomingServer = startWyomingServer(screenshotPortBlocker?.port ?? configuredWyomingPort);
  console.log(`MaiPai Home Wyoming satellite server listening on tcp://0.0.0.0:${wyomingServer.port}`);
} catch (err) {
  screenshotPortBlocker?.stop(true);
  const message = (err as Error).message;
  console.error(`[index] Wyoming satellite server failed to start, satellite devices (Home Assistant, a voice puck) won't be reachable: ${message}`);
  void raiseIssue({
    source: "wyomingServer",
    key: "bind_failed",
    severity: "error",
    title: "The Wyoming satellite server failed to start",
    detail: message,
  });
}
process.on("exit", () => wyomingServer?.stop());
const exitGracefully = async (): Promise<void> => {
  wyomingServer?.stop();
  await shutdownEngines();
  process.exit(0);
};
process.on("SIGINT", () => void exitGracefully());
process.on("SIGTERM", () => void exitGracefully());
