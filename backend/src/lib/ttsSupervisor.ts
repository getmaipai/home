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

export type TtsBackendKind = "url" | "spawned" | "stub";

interface TtsBackend {
  client: PocketTtsClient;
  stop: () => void;
  kind: TtsBackendKind;
  startedAt: string;
}

let ttsBackend: TtsBackend | null = null;
let startingPromise: Promise<TtsBackend> | null = null;
// Bumped by restartTtsBackend()/__resetTtsSupervisorForTests(): a code
// review (2026-09-04) found a real race those two functions left open -
// clearing `ttsBackend`/`startingPromise` does nothing to the in-flight
// startTtsBackend() promise a concurrent getTtsClient() call is still
// awaiting, so that spawn's own `.then()` later re-installs the stale
// (pre-restart) backend into `ttsBackend`, clobbering the fresh state a
// restart exists to produce. Each spawn attempt captures the generation
// it started under; if a restart bumped it before the spawn resolves,
// the stale backend stops itself instead of being cached.
let generation = 0;

/** `proc` is checked on every poll: a code review (2026-09-04) found the
 * original version had no visibility into whether the spawn had already
 * died (missing package, broken venv, the port already taken) and kept
 * polling `client.health()` for the full, generous 180s timeout either
 * way - a broken install failed slow instead of fast, wedging the first
 * synthesize call (and getTtsClient()'s shared startingPromise) for three
 * minutes on every restart until fixed. Bun's `Subprocess.exitCode` is
 * `null` while still running and a real number the instant it exits, no
 * extra event wiring needed. */
// Exported for a real test (a real child process that really exits, not
// a mock of Subprocess) - the same "prove the real mechanism" standard
// llmSupervisor.ts's freePort() tests already hold to.
export async function waitForHealth(client: PocketTtsClient, timeoutMs: number, proc: Bun.Subprocess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.health()) return;
    if (proc.exitCode !== null) {
      throw new Error(`pocket-tts exited early (code ${proc.exitCode}) before becoming healthy`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`pocket-tts did not become healthy within ${timeoutMs}ms`);
}

async function commandExists(bin: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === "win32" ? "where" : "which", [bin], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

async function spawnPocketTts(): Promise<TtsBackend> {
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
  const proc = Bun.spawn(["uvx", "pocket-tts", "serve", "--port", String(port), "--host", "127.0.0.1"], {
    stdout: "inherit",
    stderr: "inherit",
    env,
  });
  const client = new PocketTtsClient(`http://127.0.0.1:${port}`);
  try {
    // Generous: a cold `uv` tool cache or a first-run HF weight fetch (a
    // few hundred MB, already resident on Jesse's dev Mac from this
    // session's live listening tests) can take longer than a warm spawn.
    await waitForHealth(client, 180_000, proc);
  } catch (err) {
    proc.kill();
    throw err;
  }
  return { client, stop: () => proc.kill(), kind: "spawned", startedAt: new Date().toISOString() };
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
  if (ttsBackend) return ttsBackend.client;
  if (!startingPromise) {
    const myGeneration = generation;
    startingPromise = startTtsBackend()
      .then((backend) => {
        if (myGeneration !== generation) {
          // A restart landed while this spawn was still starting; the
          // restart already owns the cache, so this spawn is an orphan -
          // stop it rather than let it clobber whatever comes next.
          backend.stop();
          return backend;
        }
        ttsBackend = backend;
        return backend;
      })
      .catch((err) => {
        if (myGeneration === generation) startingPromise = null;
        throw err;
      });
  }
  return (await startingPromise).client;
}

/** Which backend (if any) is currently serving `tts` - "none" before the
 * first synthesize call in this process's lifetime. */
export function getTtsBackendKind(): TtsBackendKind | "starting" | "none" {
  if (ttsBackend) return ttsBackend.kind;
  if (startingPromise) return "starting";
  return "none";
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
  generation++;
  ttsBackend?.stop();
  ttsBackend = null;
  startingPromise = null;
}

/** Test-only: stop whatever backend is running and clear the cached
 * client, the same reset-between-test-files shape as
 * __resetLlmSupervisorForTests. */
export function __resetTtsSupervisorForTests(): void {
  generation++;
  ttsBackend?.stop();
  ttsBackend = null;
  startingPromise = null;
}
