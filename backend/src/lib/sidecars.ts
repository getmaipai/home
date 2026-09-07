// The sidecar contract (platform plan 4.12, docs/plans/session-f-platform-
// and-trust.md step 2): one registry, one supervisor, for every background
// process the hub runs beside itself - D's SearXNG, C's voice programs,
// and this hub's own LLM engine processes. Declared once
// (registerSidecar), supervised the same way regardless of who registered
// it: spawn, poll health, restart with backoff, a bounded log ring, and a
// graceful-exit hook so a detached child never outlives the hub process
// and holds its port hostage across the next restart - the exact failure
// llmSupervisor.ts's own freePort() comment documents living through
// before this file existed to prevent it at the source.
//
// The wave-2 contract ("F to C and D: issues and sidecars") ships this
// alone, merged to main second (right after lib/issues.ts), so the other
// sessions can register their own sidecars against the real thing.
//
// A crashed or unhealthy sidecar raises a real Repairs issue
// (source `sidecar:<id>`) with a one-click fix wired to registerFixHandler
// - the same mechanism POST /api/repairs/:id/fix already calls into - and
// resolves it the moment health returns, so this is real Repairs content
// from the day it ships, not a mechanism waiting for a first caller.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { raiseIssue, resolveIssue, registerFixHandler } from "@/lib/issues";
import { hotReloadState } from "@/lib/hotReloadState";
import { withTimeout } from "@/lib/withTimeout";
import type { EngineHealthEntry, EngineHealthKind } from "@/wire";

const execFileAsync = promisify(execFile);

export type SidecarBackupMode = "exclude" | "include";

export interface SidecarConfig {
  id: string;
  command: string[];
  cwd?: string;
  /** Fixed port the sidecar binds - freed (see freePort()) before every
   * spawn, and how its base URL is derived. Omit for a sidecar with no
   * HTTP surface of its own. */
  port?: number;
  /** Polled every HEALTH_POLL_MS once running. Omit for a sidecar with no
   * health endpoint - it's then considered healthy as long as its process
   * hasn't exited (no periodic poll loop starts). */
  healthUrl?: string;
  /** Ascending start order, descending stop order. Ties keep insertion
   * order (Array.sort is stable). Default 0. */
  startupOrder?: number;
  /** Whether a backup includes this sidecar's own data - lib/backup.ts
   * (step 8) is the real consumer; "exclude" (re-provisionable caches,
   * search indexes, model runtimes) is the default, matching the org's
   * own "third-party models and binaries are fetched on demand, never
   * tracked" posture applied to backups instead of git. */
  backupMode?: SidecarBackupMode;
  /** Glob patterns under the sidecar's own data dir excluded from backup
   * even when backupMode is "include" (its own re-downloadable model
   * cache, say, alongside state genuinely worth saving). */
  excludePatterns?: string[];
}

export type SidecarStatus =
  "stopped" | "starting" | "running" | "unhealthy" | "crashed";

interface SidecarEntry {
  config: SidecarConfig;
  status: SidecarStatus;
  proc: Bun.Subprocess | null;
  logRing: string[];
  consecutiveFailures: number;
  restartAttempts: number;
  healthTimer: ReturnType<typeof setInterval> | null;
  /** True only during an intentional stopSidecar() - so its own health
   * loop tick (already scheduled, may fire mid-teardown) and the process
   * exit it causes are never mistaken for a crash. */
  stopping: boolean;
}

const MAX_LOG_LINES = 200;
const MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
// A sidecar with no healthUrl has no real signal that it's actually
// serving anything - only that its process hasn't exited yet. Requiring
// it to survive this long before being trusted is what makes
// spawnAndWaitHealthy's exitCode check meaningful for it at all (see
// SpawnAndWaitOptions.minUptimeMs's own comment for the bug this fixes).
const NO_HEALTH_URL_GRACE_MS = 500;

// Overridable for tests only (a real 10s poll would make the restart-
// backoff tests slow without making them any more real - the process
// spawning and health-checking they exercise is real either way).
let healthPollMs = 10_000;
let backoffMs = DEFAULT_BACKOFF_MS;

const registry = new Map<string, SidecarEntry>();

function baseUrlFor(config: SidecarConfig): string | null {
  return config.port ? `http://127.0.0.1:${config.port}` : null;
}

function log(entry: SidecarEntry, line: string): void {
  entry.logRing.push(`[${new Date().toISOString()}] ${line}`);
  if (entry.logRing.length > MAX_LOG_LINES) entry.logRing.shift();
}

/** Registers (or re-registers, e.g. across a test's beforeEach) a
 * sidecar's declaration. Does not start it - startAllSidecars() (called
 * once at boot) or a direct startSidecar() call does that. */
export function registerSidecar(config: SidecarConfig): void {
  registry.set(config.id, {
    config,
    status: "stopped",
    proc: null,
    logRing: [],
    consecutiveFailures: 0,
    restartAttempts: 0,
    healthTimer: null,
    stopping: false,
  });
  // One handler per sidecar, keyed the way the schema's own `fix.action`
  // comment describes: "an opaque id the owning source recognises."
  // startSidecar() never throws on its own (a failed start is a status
  // change plus its own raiseIssue() call, not a rejection) - it has to
  // stay that way for the health-poll loop's internal restarts, which
  // have no caller to propagate a rejection to. fixIssue()'s own contract
  // is the opposite: it resolves the issue on success and leaves it open
  // when the handler throws, so this handler checks the real outcome and
  // throws itself when the restart didn't actually come back up, rather
  // than letting a still-broken sidecar get marked fixed just because
  // startSidecar() itself didn't reject.
  registerFixHandler(`restart_sidecar:${config.id}`, async () => {
    await startSidecar(config.id);
    if (getSidecar(config.id)?.status !== "running") {
      throw new Error(`${config.id} did not come back up`);
    }
  });
}

export function getSidecar(
  id: string,
): { status: SidecarStatus; baseUrl: string | null } | undefined {
  const entry = registry.get(id);
  if (!entry) return undefined;
  return { status: entry.status, baseUrl: baseUrlFor(entry.config) };
}

/** For GET /api/health: every registered sidecar, start order first. */
export function listSidecars(): Array<{
  id: string;
  status: SidecarStatus;
  baseUrl: string | null;
}> {
  return [...registry.values()]
    .sort((a, b) => (a.config.startupOrder ?? 0) - (b.config.startupOrder ?? 0))
    .map((e) => ({
      id: e.config.id,
      status: e.status,
      baseUrl: baseUrlFor(e.config),
    }));
}

export function getSidecarLogs(id: string): string[] {
  return registry.get(id)?.logRing ?? [];
}

/** Kills whatever's listening on `port`, best-effort. Moved here from
 * llmSupervisor.ts (2026-09-04's original home, see that file's `git log`
 * for the full incident writeup this guards against: a `bun --hot`
 * reload wipes a supervisor module's own tracking without touching the
 * real child process it spawned, leaving it bound to a fixed port that
 * the next spawn attempt then either fails to bind or, worse, silently
 * polls as if it were the fresh one). Every sidecar-shaped spawn in this
 * codebase - the declarative registry below AND llmSupervisor.ts/
 * embedSupervisor.ts's own lazy, tiered spawns - now calls this one
 * implementation instead of each hand-rolling its own.
 *
 * `ps`, not `lsof`: proved unreliably slow on the machine this was first
 * written on, enough to make a passing test flake into a timeout.
 *
 * SEC-9 (code review, 2026-09-06): the original version ran plain
 * `ps aux` - BSD ps's own "a" flag means "every user's processes," not
 * just this one's - so a dev's Vite server started with `--port 8788`,
 * or a second hub in a sibling worktree pointed at the same data
 * directory, matched and got SIGKILLed right along with a real orphaned
 * engine. `-u <uid>` scopes the scan to processes this hub's own OS user
 * actually owns; `process.getuid` doesn't exist on Windows, where `ps`
 * itself doesn't either, so this returns no matches there rather than
 * guessing a uid (0 would mean root, which is not a safe fallback to
 * silently substitute). */
async function findPidsMatching(pattern: RegExp): Promise<number[]> {
  if (typeof process.getuid !== "function") return [];
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-u", String(process.getuid()), "-o", "pid=,command="],
      { timeout: 5_000 },
    );
    return stdout
      .split("\n")
      .filter((line) => pattern.test(line))
      .map((line) => Number(line.trim().split(/\s+/)[0]))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

export async function freePort(port: number): Promise<void> {
  // Anchored to a word boundary after the number: a plain substring test
  // ("--port 8788".includes(...)) would also match "--port 87889" and
  // kill an unrelated process whose port has this one as a numeric
  // prefix (a real bug a code review caught in the original version).
  const portPattern = new RegExp(`--port[= ]${port}\\b`);
  const pids = await findPidsMatching(portPattern);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  if (pids.length === 0) return;

  // Give the OS a moment to actually release the socket before the
  // caller tries to bind it again - SIGKILL is immediate but the kernel's
  // own port teardown isn't guaranteed synchronous. A real connect
  // attempt (not another ps scan) is both faster and the thing that
  // actually matters: can something bind this port yet.
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const stillUp = await fetch(`http://127.0.0.1:${port}`, {
      signal: AbortSignal.timeout(300),
    }).then(
      () => true,
      () => false,
    );
    if (!stillUp) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Kills every process whose command line contains `matchSubstring` (a
 * stable, absolute path is the intended match - an installed engine's own
 * directory, say - not a generic binary name that could collide with an
 * unrelated tool). freePort() only ever catches an orphan holding the
 * EXACT port a fresh spawn is about to claim; an orphan sitting on some
 * other port (a leftover from a since-changed MAIPAI_LLAMA_SERVER_PORT,
 * or any other stale process this codebase spawned before a crash or a
 * dev-mode reload wiped the tracking) is invisible to that check
 * entirely, and legacy's own incident - "orphaned runners once forced
 * every load to CPU: a 90s 'hi'" - was exactly a leftover resident
 * process nothing was watching, not a port collision. Meant to run once
 * at boot (session-f-platform-and-trust.md step 3's own "max-resident
 * models policy with an orphan sweep"), before anything real spawns.
 * Best-effort like freePort() (no-op if `ps` is missing); returns how
 * many processes it killed.
 *
 * `excludePids` (Fix A2, docs/dev.md's 2026-09-07 incident note): pids a
 * caller's own registry already knows are genuinely alive and owned -
 * llmSupervisor.ts's `sweepOrphanEngineProcesses()` is the real caller,
 * passing its own chat backend's pid plus embed's and tts's. Without
 * this, a `bun --hot` reload (which re-runs this same boot-time sweep on
 * every module reload, not just a real process start) would kill every
 * matching process regardless of whether something still holds it,
 * because a substring match on `enginesDir` can't tell a genuine orphan
 * apart from a backend this exact process is still using. */
export async function sweepOrphanProcesses(
  matchSubstring: string,
  opts: { excludePids?: readonly number[] } = {},
): Promise<number> {
  const exclude = new Set(opts.excludePids ?? []);
  const pattern = new RegExp(
    matchSubstring.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const pids = (await findPidsMatching(pattern)).filter(
    (pid) => pid !== process.pid && !exclude.has(pid),
  );
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  return pids.length;
}

export interface SpawnAndWaitOptions {
  command: string[];
  cwd?: string;
  /** Freed via freePort() before spawning, when given. */
  port?: number;
  /** Bun.spawn's own env option REPLACES process.env rather than merging
   * with it - a caller that needs to add to the environment (ttsSupervisor.ts's
   * HF_TOKEN, say) must spread process.env into this itself. Omitted, the
   * spawned process inherits process.env unchanged (Bun.spawn's default),
   * exactly the prior behavior for callers that never needed this. */
  env?: Record<string, string | undefined>;
  healthCheck: () => Promise<boolean>;
  timeoutMs?: number;
  /** Minimum time the process must stay alive (exitCode still null)
   * before a passing `healthCheck` is trusted. Real health checks
   * (llmSupervisor.ts/embedSupervisor.ts's `client.health()`, a sidecar's
   * `healthUrl`) don't need this - a check that only starts passing once
   * the server is genuinely serving requests already proves aliveness.
   * It matters for a caller with no real health signal at all
   * (`healthCheck: async () => true`, a sidecar declared with no
   * `healthUrl`): without a minimum, `exitCode !== null` and
   * `healthCheck()` both get checked on the very first loop tick,
   * microseconds after `Bun.spawn` returns - long before the OS has even
   * scheduled the new process, so a command that's about to fail
   * immediately still reads as instantly healthy. Default 0 (no wait). */
  minUptimeMs?: number;
  /** Used only in error messages. */
  label: string;
}

/** The shared low-level primitive every process-shaped supervisor in this
 * codebase now spawns through: free the port if one is claimed, spawn,
 * poll `healthCheck` until it passes (failing fast if the process exits
 * first, not just on timeout), return the live process. Callers that need
 * a client wrapped around the result (llmSupervisor.ts, embedSupervisor.ts)
 * build that themselves - this only proves the process is up. */
export async function spawnAndWaitHealthy(
  opts: SpawnAndWaitOptions,
): Promise<Bun.Subprocess> {
  if (opts.port) await freePort(opts.port);
  const proc = Bun.spawn(opts.command, {
    cwd: opts.cwd,
    stdout: "inherit",
    stderr: "inherit",
    ...(opts.env ? { env: opts.env } : {}),
  });
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const minUptimeMs = opts.minUptimeMs ?? 0;
  const spawnedAt = Date.now();
  const deadline = spawnedAt + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(
        `${opts.label} exited early (code ${proc.exitCode}) before becoming healthy`,
      );
    }
    if (Date.now() - spawnedAt >= minUptimeMs && (await opts.healthCheck())) {
      return proc;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  proc.kill();
  throw new Error(`${opts.label} did not become healthy within ${timeoutMs}ms`);
}

/** "signal SIGKILL" or "exit code 1": the one phrasing for how a process
 * ended, in the log line and the Repairs issue alike. */
function describeExit(proc: Bun.Subprocess): string {
  return proc.signalCode
    ? `signal ${proc.signalCode}`
    : `exit code ${proc.exitCode ?? "unknown"}`;
}

// The auto-heal for the lazily spawned engines (chat, embed, TTS), which
// live outside the declarative registry above because which process they
// are is decided per spawn (llmSupervisor.ts's four tiers), not declared
// once at boot. Found live 2026-09-07 (docs/dev.md, "What was actually
// killing the chat engine"): nothing observed a spawned engine's exit at
// all, so a SIGKILLed engine left every caller repeating "could not
// reach" against a cached client until someone restarted the whole hub,
// and the Health page kept saying fine. Jesse's standing ask that same
// morning: "even if you prevent this from happening in the future, I
// still need an autoheal for when llm, voice, etc are down." One
// implementation, three callers: watch the exit, poll health the same
// way registered sidecars are polled, and on either signal drop the
// supervisor's cached backend, raise a Repairs issue, and start it
// again with the same backoff the registry uses - bounded by a crash-loop
// cap, because respawning a process something keeps killing (or that
// keeps running out of memory) forever would be its own outage.
export interface EngineWatchOptions {
  proc: Bun.Subprocess;
  /** Names the Repairs issue source (`<role>-engine`) and the one-click
   * fix action (`restart_engine:<role>`) once the crash-loop cap trips. */
  role: string;
  /** How the log and the Repairs detail name it: "the chat engine". */
  label: string;
  healthCheck: () => Promise<boolean>;
  /** Drops the supervisor's cached backend so its next client call spawns
   * fresh - each supervisor's own restart function. */
  drop: () => void;
  /** The supervisor's own lazy start; resolves once a fresh process is
   * healthy again (each supervisor's get*Client()). */
  respawn: () => Promise<unknown>;
  /** Dad-language Repairs title, e.g. "MaiPai's AI stopped unexpectedly". */
  title: string;
}

export interface EngineWatch {
  pid: number;
  /** A deliberate stop (an admin action, a model swap, a test reset):
   * kills the process and never reports it as a death. Recorded at kill
   * time, on purpose - a code review (2026-09-07) found that inferring
   * intent afterwards from "does the supervisor still hold this pid"
   * misread a death during an in-flight request as deliberate, because
   * the request's own failure handler dropped the backend before the
   * exit was observed. */
  stop(): void;
  /** A caller saw the engine unreachable (llm.ts's "could not reach"):
   * treat it as down right now, without waiting for the exit or the next
   * health poll. Idempotent with both. */
  markDown(reason: string): void;
}

const MAX_AUTO_RESPAWNS = 5;
const RESPAWN_WINDOW_MS = 10 * 60_000;

// Respawn timestamps per role, kept across a `bun --hot` reload for the
// same reason the supervisors' own state is (hotReloadState.ts): a reload
// mid-crash-loop must not reset the count and hand a dying engine five
// more attempts.
const respawnHistory = hotReloadState<Record<string, number[]>>(
  "engineRespawnHistory",
  () => ({}),
);
// Per role, what the auto-heal is doing right now, for GET /api/health:
// "pending" while a respawn is scheduled or in flight (the supervisor's
// own state is empty then, which would otherwise read as "not started
// yet"), "gave_up" once the crash-loop cap tripped. Same reload-proofing
// as the history above.
const respawnState = hotReloadState<
  Record<string, "pending" | "gave_up" | undefined>
>("engineRespawnState", () => ({}));
const engineWatchTimers = new Set<ReturnType<typeof setInterval>>();
// The one armed respawn per role, so a deliberate stop landing inside the
// backoff window cancels it (a code review, 2026-09-07: an untracked
// timer fired getChatClient() against an engine the admin had just
// stopped, counted the resulting "it is stopped" rejection as a crash,
// and walked the role into "gave up" for an action that was never a
// failure). On globalThis (hotReloadState), not module-local: a second
// review caught that a `bun --hot` reload gave a fresh module instance
// its own empty Map, so its cancelEngineRespawn() could never find (or
// clear) a timer the PREVIOUS instance armed - the exact "reload wipes
// tracking a live child still needs" bug Fix A exists to prevent
// everywhere else in this file.
const pendingRespawnTimers = hotReloadState<
  Map<string, ReturnType<typeof setTimeout>>
>("engineRespawnTimers", () => new Map());
// Bumped by cancelEngineRespawn() and by every watchEngine() call: the
// respawn a backoff timer eventually settles is only allowed to write
// respawnState or raise/resolve an issue if the role's generation hasn't
// moved since it was scheduled. A second code review (2026-09-07) found
// this was the one case cancelEngineRespawn() could not actually cancel:
// a timer that had ALREADY fired and was awaiting its respawn() call (a
// real spawn takes 20-60s) when a deliberate stop landed - there was no
// pending setTimeout left to clear, so the stop did nothing, and the
// in-flight respawn's own "it is stopped" rejection was counted as a
// crash. Also on globalThis, for the same reload reason as the map above.
const respawnGeneration = hotReloadState<Record<string, number>>(
  "engineRespawnGeneration",
  () => ({}),
);

export function engineRespawnState(role: string): "pending" | "gave_up" | null {
  return respawnState[role] ?? null;
}

/** A deliberate stop or restart of a role: nothing the auto-heal armed
 * may fire against it afterwards, whether or not a timer is still
 * pending. Called by each supervisor's own stop/restart, and by a fresh
 * healthy watch (watchEngine() calls it before resolving any prior
 * issue, so an old backoff's eventual result is disowned even when it
 * already fired and is mid-respawn). */
export function cancelEngineRespawn(role: string): void {
  const timer = pendingRespawnTimers.get(role);
  if (timer) clearTimeout(timer);
  pendingRespawnTimers.delete(role);
  respawnState[role] = undefined;
  respawnGeneration[role] = (respawnGeneration[role] ?? 0) + 1;
}

export function watchEngine(opts: EngineWatchOptions): EngineWatch {
  const { proc, role, label } = opts;
  const source = `${role}-engine`;
  let deliberate = false;
  let handled = false;
  let failures = 0;
  let polling = false;
  // A watched process is healthy by construction (spawnAndWaitHealthy()
  // just proved it), whoever started it: the auto-heal's own respawn, an
  // admin's restart, a model swap. So this is where a prior death closes
  // out - not only on the auto-heal's own success path, which a code
  // review (2026-09-07) found left "gave up" (and the Health page's
  // "keeps stopping") stuck after a manual restart had already fixed it.
  //
  // registerFixHandler here, not once at each supervisor's module load
  // (a second code review, 2026-09-07): fixHandlers is a plain in-memory
  // Map (issues.ts), and __resetFixHandlersForTests() - called in every
  // test file's own beforeEach - clears it for the rest of the shared
  // bun test process; a registration that only ever ran once, at import
  // time, was gone for good after the first test file that reset it,
  // poisoning every later test that raised this role's "died" issue.
  // Registering here means it comes back with every real spawn, the
  // same way registerSidecar()'s own registerFixHandler call does for
  // its declared sidecars. The gap this leaves - a crash-looping engine
  // that has never once become healthy since the last process restart
  // has no fix button yet - is real but narrow (docs/dev.md's "What was
  // actually killing the chat engine" section records it rather than
  // building a persisted-handler rehydration mechanism for it).
  registerFixHandler(`restart_engine:${role}`, async () => {
    cancelEngineRespawn(role);
    respawnHistory[role] = [];
    respawnState[role] = "pending";
    try {
      await opts.respawn();
    } catch (err) {
      respawnState[role] = "gave_up";
      throw err;
    }
  });
  cancelEngineRespawn(role);
  resolveIssue(source, "died");
  const timer = setInterval(() => void poll(), healthPollMs);
  engineWatchTimers.add(timer);

  function dispose(): void {
    clearInterval(timer);
    engineWatchTimers.delete(timer);
  }

  async function poll(): Promise<void> {
    if (handled || deliberate || polling) return;
    // An exited process is the exit handler's to report, with how it ended.
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    polling = true;
    try {
      if (await opts.healthCheck()) {
        failures = 0;
        return;
      }
    } finally {
      polling = false;
    }
    failures++;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      down(`stopped answering health checks (${failures} in a row)`);
      proc.kill();
    }
  }

  function down(reason: string): void {
    if (handled || deliberate) return;
    handled = true;
    dispose();
    console.error(`[sidecars] ${label} (pid ${proc.pid}) ${reason}`);
    opts.drop();
    scheduleRespawn(reason);
  }

  function scheduleRespawn(reason: string): void {
    const now = Date.now();
    const recent = (respawnHistory[role] ?? []).filter(
      (t) => now - t < RESPAWN_WINDOW_MS,
    );
    respawnHistory[role] = recent;
    const sentence = `${label[0]!.toUpperCase()}${label.slice(1)} ${reason}.`;
    if (recent.length >= MAX_AUTO_RESPAWNS) {
      respawnState[role] = "gave_up";
      void raiseIssue({
        source,
        key: "died",
        severity: "error",
        title: opts.title,
        detail:
          `${sentence} MaiPai started it again ${recent.length} times in the last ${RESPAWN_WINDOW_MS / 60_000} minutes and it keeps stopping, ` +
          `so it is not trying again on its own. Something on this machine is ending it, or it is running out of memory.`,
        fix: { label: "Start it again", action: `restart_engine:${role}` },
      });
      return;
    }
    const delay = backoffMs[Math.min(recent.length, backoffMs.length - 1)]!;
    recent.push(now);
    respawnState[role] = "pending";
    void raiseIssue({
      source,
      key: "died",
      severity: "error",
      title: opts.title,
      detail: `${sentence} MaiPai is starting it again now.`,
    });
    cancelEngineRespawn(role);
    respawnState[role] = "pending";
    const myGeneration = respawnGeneration[role] ?? 0;
    const timer = setTimeout(() => {
      pendingRespawnTimers.delete(role);
      // A rejection here never produced a process (the engine is
      // deliberately stopped, a crash-boot hold, a model not downloaded,
      // a spawn that failed) - so it is not another crash to count or
      // retry on a timer. The issue stays open saying why, with the
      // "Start it again" button as the retry; a spawn failure also
      // raises its own issue (llmSupervisor.ts's chat-engine/spawn).
      opts.respawn().then(
        () => {
          // A spawned replacement already cleared this in watchEngine();
          // a respawn that resolved to something unwatched (the tier
          // changed underneath to a URL or the stub) still counts as back.
          if (respawnState[role] === "pending") respawnState[role] = undefined;
          resolveIssue(source, "died");
        },
        (err: unknown) => {
          // Stale: a deliberate stop/restart (or a fresh watch) landed
          // while this respawn was in flight and already bumped the
          // generation - a second code review (2026-09-07) found this
          // rejection (the caller's OWN "it is stopped") was otherwise
          // still counted as a crash even though nothing this timer
          // scheduled is still authoritative.
          if ((respawnGeneration[role] ?? 0) !== myGeneration) return;
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[sidecars] ${label} did not come back: ${message}`);
          respawnState[role] = "gave_up";
          void raiseIssue({
            source,
            key: "died",
            severity: "error",
            title: opts.title,
            detail: `${sentence} MaiPai tried to start it again and could not: ${message}`,
            fix: { label: "Start it again", action: `restart_engine:${role}` },
          });
        },
      );
    }, delay);
    pendingRespawnTimers.set(role, timer);
  }

  const onExit = (): void => {
    if (deliberate) {
      dispose();
      return;
    }
    down(`exited unexpectedly (${describeExit(proc)})`);
  };
  proc.exited.then(onExit, onExit);

  return {
    pid: proc.pid,
    stop() {
      deliberate = true;
      dispose();
      proc.kill();
    },
    markDown(reason) {
      // One real probe first (a code review, 2026-09-07): the caller's
      // failure can be its own (a client that disconnected before the
      // engine answered, a connect-time hiccup), and killing a healthy
      // engine mid-generation for everyone else on that word would be
      // the outage, not the cure.
      void (async () => {
        if (handled || deliberate) return;
        if (await opts.healthCheck()) return;
        down(reason);
        proc.kill();
      })();
    },
  };
}

/** Live-probes one engine's client for GET /api/health: true/false for a
 * backend that is supposed to be up, null when there is nothing to probe
 * (not started yet, starting, stopped). A stale cached client to a dead
 * process answers false here - the exact case the Health page used to
 * report as fine, because it showed the engine's configured kind and
 * never asked the process anything. */
export async function probeAlive(
  client: { health(): Promise<boolean> } | null | undefined,
  timeoutMs = 3_000,
): Promise<boolean | null> {
  if (!client) return null;
  try {
    return await withTimeout(
      client.health(),
      timeoutMs,
      () => new Error("health probe timed out"),
    );
  } catch {
    return false;
  }
}

/** One engine's row in GET /api/health - wire.ts's type, re-exported the
 * way restoreStaging.ts re-exports PendingRestore, so the supervisors,
 * the route and the frontend all draw from the one declaration. `kind`
 * is the supervisor's own kind, or "restarting" while the auto-heal is
 * between a death and the next spawn, or "failed" once it gave up. */
export type EngineHealth = EngineHealthEntry;

/** Folds the auto-heal's own state into a supervisor's kind for
 * GET /api/health, so the page never says "starts when needed" about an
 * engine that just died, and says "failed" (not merely "not started")
 * once the cap tripped. */
export function engineHealthKind(role: string, kind: EngineHealthKind): EngineHealthKind {
  const healing = engineRespawnState(role);
  if (healing === "gave_up") return "failed";
  if (healing === "pending" && (kind === "none" || kind === "starting"))
    return "restarting";
  return kind;
}

async function checkHealthUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function raiseCrashIssue(id: string, detail: string): Promise<void> {
  await raiseIssue({
    source: `sidecar:${id}`,
    key: "crashed",
    severity: "error",
    title: `${id} isn't running`,
    detail,
    fix: { label: `Restart ${id}`, action: `restart_sidecar:${id}` },
  });
}

/** Spawns a registered sidecar and waits for it to become healthy (or
 * throws) - a no-op if it's already running or in the middle of starting.
 * On success, starts the ongoing health-poll loop; on failure, raises the
 * Repairs issue directly rather than waiting for a poll tick, so a
 * sidecar that never manages to start at all still shows up immediately. */
export async function startSidecar(id: string): Promise<void> {
  const entry = registry.get(id);
  if (!entry) throw new Error(`no sidecar registered as "${id}"`);
  if (entry.proc || entry.status === "starting") return;
  entry.stopping = false;
  entry.status = "starting";
  const { config } = entry;
  try {
    const healthCheck = config.healthUrl
      ? () => checkHealthUrl(config.healthUrl!)
      : async () => true;
    const proc = await spawnAndWaitHealthy({
      command: config.command,
      cwd: config.cwd,
      port: config.port,
      healthCheck,
      minUptimeMs: config.healthUrl ? 0 : NO_HEALTH_URL_GRACE_MS,
      label: id,
    });
    // A code review (2026-09-06) found a race here: stopSidecar() called
    // while this await was in flight sets `stopping` and status
    // "stopped", but entry.proc was still null then so its own kill()
    // was a no-op - leaving nothing to actually stop. Re-checking here,
    // before this resolves the race the other way (silently resurrecting
    // a sidecar someone just explicitly stopped, unmonitored forever
    // since startHealthLoop() below would find `stopping` already true
    // and refuse to poll it).
    if (entry.stopping) {
      proc.kill();
      log(entry, "start aborted: stopped while spawning");
      return;
    }
    entry.proc = proc;
    entry.status = "running";
    entry.consecutiveFailures = 0;
    entry.restartAttempts = 0;
    log(entry, "started");
    resolveIssue(`sidecar:${id}`, "crashed");
    startHealthLoop(entry);
  } catch (err) {
    entry.proc = null;
    const message = err instanceof Error ? err.message : String(err);
    // The same race as above, the failure side of it: a stop that landed
    // mid-spawn already left this sidecar "stopped" on purpose, so a
    // spawn failure here (chasing a start nobody wants anymore) isn't a
    // real crash - reporting one would raise a Repairs issue for a
    // sidecar the household never expected to be running.
    if (entry.stopping) {
      log(entry, `start aborted (and failed) while stopping: ${message}`);
      return;
    }
    entry.status = "crashed";
    log(entry, `failed to start: ${message}`);
    await raiseCrashIssue(id, message);
  }
}

function startHealthLoop(entry: SidecarEntry): void {
  // No health URL declared: nothing to poll periodically. The process
  // exiting on its own is the only failure this shape can detect, and
  // nothing currently registers a sidecar with no health URL, so that
  // detection is deferred rather than built for zero real callers.
  if (!entry.config.healthUrl) return;
  entry.healthTimer = setInterval(() => void pollHealth(entry), healthPollMs);
}

async function pollHealth(entry: SidecarEntry): Promise<void> {
  if (entry.stopping || !entry.proc) return;
  if (entry.proc.exitCode !== null) {
    await handleDown(entry, `process exited (code ${entry.proc.exitCode})`);
    return;
  }
  const healthy = await checkHealthUrl(entry.config.healthUrl!);
  if (healthy) {
    entry.consecutiveFailures = 0;
    if (entry.status !== "running") {
      entry.status = "running";
      resolveIssue(`sidecar:${entry.config.id}`, "crashed");
    }
    return;
  }
  entry.consecutiveFailures++;
  if (entry.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    await handleDown(
      entry,
      `health check failed ${entry.consecutiveFailures} times in a row`,
    );
  } else {
    entry.status = "unhealthy";
  }
}

async function handleDown(entry: SidecarEntry, reason: string): Promise<void> {
  if (entry.stopping) return;
  if (entry.healthTimer) clearInterval(entry.healthTimer);
  entry.healthTimer = null;
  entry.proc?.kill();
  entry.proc = null;
  entry.status = "crashed";
  log(entry, `down: ${reason}`);
  await raiseCrashIssue(entry.config.id, reason);

  const attempt = entry.restartAttempts;
  const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)]!;
  entry.restartAttempts++;
  setTimeout(() => void startSidecar(entry.config.id), delay);
}

export async function stopSidecar(id: string): Promise<void> {
  const entry = registry.get(id);
  if (!entry) return;
  entry.stopping = true;
  if (entry.healthTimer) clearInterval(entry.healthTimer);
  entry.healthTimer = null;
  entry.proc?.kill();
  entry.proc = null;
  entry.status = "stopped";
}

/** Boots every registered sidecar, ascending startupOrder. Awaited in
 * series (not parallel): a sidecar earlier in the order may be a
 * dependency of one later, and plan 4.12 calls for a "declared startup
 * order" specifically so that's expressible. */
export async function startAllSidecars(): Promise<void> {
  const ordered = [...registry.values()].sort(
    (a, b) => (a.config.startupOrder ?? 0) - (b.config.startupOrder ?? 0),
  );
  for (const entry of ordered) await startSidecar(entry.config.id);
}

/** Reverse startupOrder: whatever started last (most likely to depend on
 * something earlier) stops first. */
export async function stopAllSidecars(): Promise<void> {
  const ordered = [...registry.values()].sort(
    (a, b) => (b.config.startupOrder ?? 0) - (a.config.startupOrder ?? 0),
  );
  for (const entry of ordered) await stopSidecar(entry.config.id);
}

let gracefulExitRegistered = false;

/** Registers a process-exit hook that kills every running sidecar's child
 * process before the hub itself exits - the actual fix for the class of
 * bug freePort() only ever papered over after the fact (a leaked child
 * from a reload or crash, discovered and killed on the NEXT spawn attempt
 * rather than prevented). Idempotent and called once from index.ts at
 * boot; safe to call more than once (a second call is a no-op) since
 * nothing guarantees a caller only invokes it a single time. */
export function registerGracefulExit(): void {
  if (gracefulExitRegistered) return;
  gracefulExitRegistered = true;
  const killAll = (): void => {
    for (const entry of registry.values()) {
      entry.stopping = true;
      if (entry.healthTimer) clearInterval(entry.healthTimer);
      entry.proc?.kill();
    }
  };
  // "exit" handlers must be synchronous - killAll() is (Bun.Subprocess.kill()
  // sends the signal and returns immediately, it doesn't await the exit).
  process.on("exit", killAll);
  process.on("SIGINT", () => {
    killAll();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    killAll();
    process.exit(0);
  });
}

/** Test-only: clears the registry and any in-flight timers, and restores
 * the real poll/backoff intervals - the same reset-between-test-files
 * shape as __resetLlmSupervisorForTests and friends. Does NOT touch
 * gracefulExitRegistered (a process-level hook, not per-test state). */
export function __resetSidecarsForTests(): void {
  for (const entry of registry.values()) {
    if (entry.healthTimer) clearInterval(entry.healthTimer);
    entry.proc?.kill();
  }
  registry.clear();
  for (const timer of engineWatchTimers) clearInterval(timer);
  engineWatchTimers.clear();
  for (const timer of pendingRespawnTimers.values()) clearTimeout(timer);
  pendingRespawnTimers.clear();
  for (const role of Object.keys(respawnHistory)) delete respawnHistory[role];
  for (const role of Object.keys(respawnGeneration)) delete respawnGeneration[role];
  for (const role of Object.keys(respawnState)) delete respawnState[role];
  healthPollMs = 10_000;
  backoffMs = DEFAULT_BACKOFF_MS;
}

/** Test-only: real timers, sped way up - a health-poll and restart-backoff
 * test proves the real logic (a real spawned process, a real health
 * fetch, a real setInterval/setTimeout) without a 10s poll interval or a
 * 30s backoff cap making the suite slow. */
export function __setSidecarTimingForTestsOnly(opts: {
  healthPollMs?: number;
  backoffMs?: number[];
}): void {
  if (opts.healthPollMs !== undefined) healthPollMs = opts.healthPollMs;
  if (opts.backoffMs !== undefined) backoffMs = opts.backoffMs;
}
