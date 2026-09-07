// The router skeleton for platform plan 4.11's `tts` role, the same
// lazy-start-once shape llmSupervisor.ts already set for `chat`, scaled
// down further: one backend (Kyutai Pocket TTS), no catalog entry, no
// download job, no household selection - see spec/voice/README.md for why.
//
// Which backend answers `tts` is chosen once, lazily, on first use, in
// this order:
//   1. MAIPAI_TTS_URL - point at an already-running server (real or
//      someone else's stub). Nothing is spawned.
//   2. `uv` is on PATH (and MAIPAI_TTS_DISABLE_SPAWN isn't set, every test
//      run - backend/tests/preload.ts): spawn `uvx pocket-tts serve` as a
//      real child process. A spawn attempt that starts but fails to
//      become healthy THROWS here, matching llmSupervisor.ts's tier-3
//      discipline ("configured-but-broken... throws... instead of
//      silently falling back to the stub") - `uv` being present is a real
//      signal this host is meant to run real voice, so a broken spawn
//      should surface, not silently downgrade.
//   3. Nothing else applies (no `uv`, every test run, and any fresh
//      install without it) - start the in-process stub server. Real code
//      path, canned silent audio; see spec/voice/README.md.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { PocketTtsClient } from "@maipai/spec/voice/ts/client.js";
import { startStubTtsServer } from "@maipai/spec/voice/ts/stubServer.js";
import { getHouseholdSettingValue } from "@/lib/settings";
import { spawnAndWaitHealthy, watchEngine, probeAlive, engineHealthKind, cancelEngineRespawn, type EngineHealth } from "@/lib/sidecars";
import { hotReloadState } from "@/lib/hotReloadState";
import { assertNotInCrashBootHold } from "@/lib/dirtyBoot";

export type TtsBackendKind = "url" | "spawned" | "stub";

interface TtsBackend {
  client: PocketTtsClient;
  stop: () => void;
  /** Only set for a backend this module actually spawned ("spawned") -
   * llmSupervisor.ts's `ChatBackend.pid` precedent, needed here too for
   * Fix A2's own orphan-sweep exclusion (see `getTtsLivePid()` below). */
  pid?: number;
  kind: TtsBackendKind;
  startedAt: string;
}

// Fix A (docs/dev.md, "Chat reliability: the 2026-09-07 incident"):
// `lib/hotReloadState.ts`'s shared helper - a `bun --hot` reload resets a
// module-level `let` to its initializer, but `globalThis` survives (same
// process, same heap), so this module's spawned Pocket TTS process stops
// looking orphaned to the fresh module instance that reload just created.
interface TtsSupervisorState {
  ttsBackend: TtsBackend | null;
  startingPromise: Promise<TtsBackend> | null;
  // Bumped by restartTtsBackend()/__resetTtsSupervisorForTests(): a code
  // review (2026-09-04) found a real race those two functions left open -
  // clearing `ttsBackend`/`startingPromise` does nothing to the in-flight
  // startTtsBackend() promise a concurrent getTtsClient() call is still
  // awaiting, so that spawn's own `.then()` later re-installs the stale
  // (pre-restart) backend into `ttsBackend`, clobbering the fresh state a
  // restart exists to produce. Each spawn attempt captures the generation
  // it started under; if a restart bumped it before the spawn resolves,
  // the stale backend stops itself instead of being cached.
  generation: number;
}

const state = hotReloadState<TtsSupervisorState>("ttsSupervisor", () => ({
  ttsBackend: null,
  startingPromise: null,
  generation: 0,
}));

async function commandExists(bin: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === "win32" ? "where" : "which", [bin], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

// Exported for a real test of the crash-boot-hold gate below, the same
// "export a private function for a direct real test" precedent this file
// already used for the waitForHealth() it replaced - calling this
// directly (rather than through startTtsBackend()'s commandExists("uvx")
// gate) proves assertNotInCrashBootHold() throws before anything real
// spawns, without needing uv/uvx actually installed on the machine
// running the suite.
export async function spawnPocketTts(): Promise<TtsBackend> {
  // The crash-boot hold (lib/dirtyBoot.ts, session-f-platform-and-trust.md
  // step 3): only gates a REAL spawn, never a URL override (startTtsBackend's
  // MAIPAI_TTS_URL branch) or the stub - a household that already has TTS
  // configured to spawn a real engine still gets a working (stubbed)
  // voice surface immediately after a crash-boot, just not the real
  // engine for 30 minutes, the same treatment llmSupervisor.ts/
  // embedSupervisor.ts already give their own real-spawn paths (issue #16:
  // this one had no equivalent gate, so TTS launched immediately after a
  // crash-boot while chat/embed were correctly held back).
  assertNotInCrashBootHold();
  const port = Number(process.env.MAIPAI_TTS_PORT ?? 8793);
  // Pocket TTS's own model loader (2026-09-04, voice cloning) tries the
  // real, cloning-capable checkpoint FIRST and only falls back to the
  // non-gated one if that download fails (confirmed by reading the
  // installed package's own source: `has_voice_cloning` starts `True`,
  // set `False` only in the `except` branch of a failed weights
  // download) - so a household's own HF token, once they've accepted
  // Kyutai's terms, is the ONLY thing standing between "the default
  // fallback" and real cloning working. Passed as an env var for this
  // one child process only, never persisted to a token cache file or
  // logged - the same "handled only where needed" credential rule
  // `voice.hf_token`'s own storage already follows.
  const hfToken = getHouseholdSettingValue("voice.hf_token") as string;
  const env: Record<string, string | undefined> = { ...process.env };
  if (hfToken) env.HF_TOKEN = hfToken;
  const client = new PocketTtsClient(`http://127.0.0.1:${port}`);
  // Issue #14: this used to hand-roll its own spawn+health-wait loop,
  // the exact duplication session-f-platform-and-trust.md step 2 unified
  // llmSupervisor.ts/embedSupervisor.ts onto spawnAndWaitHealthy() for.
  // Issue #44: spawnAndWaitHealthy() calls freePort(port) before spawning
  // (a code review, 2026-09-04, found an orphaned or unrelated process
  // already squatting a fixed port silently broke a spawn with no signal
  // anywhere a household would see) - this file previously had none of
  // that, matching llmSupervisor.ts/embedSupervisor.ts's own real ports.
  const proc = await spawnAndWaitHealthy({
    command: ["uvx", "pocket-tts", "serve", "--port", String(port), "--host", "127.0.0.1"],
    port,
    env,
    // Generous: a cold `uv` tool cache or a first-run HF weight fetch (a
    // few hundred MB, already resident on Jesse's dev Mac from this
    // session's live listening tests) can take longer than a warm spawn.
    healthCheck: () => client.health(),
    timeoutMs: 180_000,
    label: "pocket-tts",
  });
  // The auto-heal, llmSupervisor.ts's spawnLlamaServer() shape for this
  // role: sidecars.ts's watchEngine() owns the exit watch, the health poll
  // and the backoff respawn; this only says what to drop and how to start.
  const watch = watchEngine({
    proc,
    role: "tts",
    label: "the speech engine",
    healthCheck: () => client.health(),
    drop: () => void restartTtsBackend(),
    respawn: () => getTtsClient(),
    title: "MaiPai's voice stopped unexpectedly",
  });
  return { client, stop: watch.stop, pid: proc.pid, kind: "spawned", startedAt: new Date().toISOString() };
}

/** For GET /api/health: the kind plus a real probe of the process. */
export async function probeTtsEngine(): Promise<EngineHealth> {
  return { kind: engineHealthKind("tts", getTtsBackendKind()), pid: state.ttsBackend?.pid ?? null, alive: await probeAlive(state.ttsBackend?.client) };
}

async function startTtsBackend(): Promise<TtsBackend> {
  const configuredUrl = process.env.MAIPAI_TTS_URL;
  if (configuredUrl) {
    return { client: new PocketTtsClient(configuredUrl), stop: () => {}, kind: "url", startedAt: new Date().toISOString() };
  }

  if (process.env.MAIPAI_TTS_DISABLE_SPAWN !== "1" && (await commandExists("uvx"))) {
    return spawnPocketTts();
  }

  const stub = startStubTtsServer();
  return { client: new PocketTtsClient(stub.url), stop: stub.stop, kind: "stub", startedAt: new Date().toISOString() };
}

/** Lazily starts (once) and returns the client for the `tts` role.
 * Concurrent first callers share one in-flight start, never race to spawn
 * two backends. A failed start clears startingPromise so the next call
 * retries fresh, the same fix llmSupervisor.ts's getChatClient() already
 * carries for the same class of bug (a stale rejected promise permanently
 * wedging the role after one transient failure). */
export async function getTtsClient(): Promise<PocketTtsClient> {
  if (state.ttsBackend) return state.ttsBackend.client;
  if (!state.startingPromise) {
    const myGeneration = state.generation;
    state.startingPromise = startTtsBackend()
      .then(async (backend): Promise<TtsBackend> => {
        if (myGeneration !== state.generation) {
          // A restart landed while this spawn was still starting.
          // Simply returning the (now-stopped) `backend` here would be a
          // second bug, not a fix: a code review (2026-09-04, found while
          // building embedSupervisor.ts's identical shape) noticed the
          // ORIGINAL caller of getTtsClient() already committed to
          // `await`ing exactly this promise before the restart happened
          // (a real, live path here - saving or removing voice.hf_token
          // calls restartTtsBackend() while an earlier /api/tts request
          // might still be waiting on the household's first-ever spawn),
          // so it would still receive `.client` bound to the process just
          // stopped above - a client to a dead server, not a retry.
          // Recursing into getTtsClient() instead means that caller
          // transparently lands on whatever the CURRENT generation
          // resolves to.
          backend.stop();
          return { ...backend, client: await getTtsClient() };
        }
        state.ttsBackend = backend;
        return backend;
      })
      .catch((err) => {
        if (myGeneration === state.generation) state.startingPromise = null;
        throw err;
      });
  }
  return (await state.startingPromise).client;
}

/** Which backend (if any) is currently serving `tts` - "none" before the
 * first synthesize call in this process's lifetime. */
export function getTtsBackendKind(): TtsBackendKind | "starting" | "none" {
  if (state.ttsBackend) return state.ttsBackend.kind;
  if (state.startingPromise) return "starting";
  return "none";
}

/** The TTS backend's own pid, when one is genuinely spawned and running -
 * Fix A2 (docs/dev.md's incident note): index.ts passes this to
 * llmSupervisor.ts's `sweepOrphanEngineProcesses()` so a `bun --hot`
 * reload's own re-run of the boot-time orphan sweep never kills this
 * still-healthy process out from under the fresh module instance that's
 * about to reuse it. */
export function getTtsLivePid(): number | null {
  return state.ttsBackend?.pid ?? null;
}

/** Stops whatever's running (if any) and clears the cache, so the next
 * getTtsClient() call re-resolves from scratch - llmSupervisor.ts's own
 * restartChatBackend() carries the identical shape for the identical
 * reason (a fresh download/setting change should apply without a full
 * process restart). Voice cloning's real trigger: a household saves or
 * removes their `voice.hf_token` AFTER the tts engine already spawned
 * with the old value (or none) - the already-running process never
 * re-reads the setting on its own. */
export async function restartTtsBackend(): Promise<void> {
  cancelEngineRespawn("tts");
  state.generation++;
  state.ttsBackend?.stop();
  state.ttsBackend = null;
  state.startingPromise = null;
}

/** Test-only: stop whatever backend is running and clear the cached
 * client, the same reset-between-test-files shape as
 * __resetLlmSupervisorForTests. */
export function __resetTtsSupervisorForTests(): void {
  cancelEngineRespawn("tts");
  state.generation++;
  state.ttsBackend?.stop();
  state.ttsBackend = null;
  state.startingPromise = null;
}
