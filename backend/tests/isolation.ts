// The "tests never touch real state" guarantee, enforced instead of
// remembered. tests/preload.ts sets a handful of environment variables
// before any test file loads (a throwaway MAIPAI_DATA_DIR, a test-only
// chat engine port, no real TTS spawn); every test in the suite then
// relies on them without ever saying so. Found live 2026-09-07 (docs/
// dev.md, "What was actually killing the chat engine"): one test file's
// afterEach did `delete process.env.MAIPAI_LLAMA_SERVER_PORT` to tidy up
// after itself, bun runs every file in one process in a non-alphabetical
// order, and a LATER file's deliberately-failing spawn then called
// freePort() on the production default port 8788 - SIGKILLing the real
// dev hub's chat engine on this same Mac, silently, on every `bun test`
// and every scripts/check.sh run, for days. This guard runs after every
// test in every file: a test that leaves the isolation broken fails by
// name, and the values are put back before the next test can act on
// them.
import { afterEach } from "bun:test";

/** The production defaults a test spawn must never resolve to -
 * llmSupervisor.ts's own `MAIPAI_LLAMA_SERVER_PORT ?? 8788`, and
 * ENGINE-PORT-01's own two siblings (backgroundSupervisor.ts's
 * `MAIPAI_BACKGROUND_PORT ?? 8789`, embedSupervisor.ts's
 * `MAIPAI_EMBED_PORT ?? 8794`) - the identical gap for both, found live
 * only once Fable traced a real household outage to it (dev.md
 * 2026-09-23), because nothing had exercised getBackgroundClient()/
 * getEmbedClient() in a test that also happened to be missing the
 * override. `PRODUCTION_CHAT_PORT` stays its own export (existing
 * tests read it by name); the other two are exported the same way for
 * the same reason. */
export const PRODUCTION_CHAT_PORT = "8788";
export const PRODUCTION_BACKGROUND_PORT = "8789";
export const PRODUCTION_EMBED_PORT = "8794";

/** Environment variables tests/preload.ts owns. `exact` ones must keep
 * the exact value preload set (a different data dir is a different
 * household's data); a port key only has to stay isolated - a test may
 * pick its own throwaway port (resourceGovernor.test.ts does), it just
 * can't unset it or point it at the production default. */
const EXACT_KEYS = ["MAIPAI_DATA_DIR", "MAIPAI_BACKUP_DIR", "MAIPAI_KEYSTORE_BACKEND", "MAIPAI_TTS_DISABLE_SPAWN"] as const;
const PORT_KEYS: readonly { key: string; productionDefault: string }[] = [
  { key: "MAIPAI_LLAMA_SERVER_PORT", productionDefault: PRODUCTION_CHAT_PORT },
  { key: "MAIPAI_BACKGROUND_PORT", productionDefault: PRODUCTION_BACKGROUND_PORT },
  { key: "MAIPAI_EMBED_PORT", productionDefault: PRODUCTION_EMBED_PORT },
];

export type IsolationSnapshot = Record<string, string | undefined>;

export interface IsolationViolation {
  name: string;
  found: string | undefined;
  restoredTo: string;
}

export function snapshotTestIsolation(env: IsolationSnapshot = process.env): IsolationSnapshot {
  const snapshot: IsolationSnapshot = {};
  for (const key of [...EXACT_KEYS, ...PORT_KEYS.map((p) => p.key)]) snapshot[key] = env[key];
  return snapshot;
}

/** Compares `env` against `expected`, restores every broken value in
 * place, and returns what was broken (empty when nothing was). Restoring
 * AND reporting, not one or the other: reporting alone would leave the
 * next test to spawn against the real engine anyway (a failed afterEach
 * doesn't stop the suite), restoring alone would hide a test that is
 * quietly wrong. */
export function checkTestIsolation(env: IsolationSnapshot, expected: IsolationSnapshot): IsolationViolation[] {
  const violations: IsolationViolation[] = [];
  for (const key of EXACT_KEYS) {
    const want = expected[key];
    if (want === undefined) continue;
    if (env[key] !== want) {
      violations.push({ name: key, found: env[key], restoredTo: want });
      env[key] = want;
    }
  }
  for (const { key, productionDefault } of PORT_KEYS) {
    const wantPort = expected[key];
    const port = env[key];
    if (wantPort !== undefined && (port === undefined || port === productionDefault)) {
      violations.push({ name: key, found: port, restoredTo: wantPort });
      env[key] = wantPort;
    }
  }
  return violations;
}

/** Snapshots the isolation preload just established and registers the
 * suite-wide afterEach that enforces it. Called from tests/preload.ts,
 * after the env is set (an `import` would hoist above those
 * assignments, so this is a function call on purpose). */
export function installTestIsolationGuard(): void {
  const expected = snapshotTestIsolation();
  afterEach(() => {
    const violations = checkTestIsolation(process.env, expected);
    if (violations.length === 0) return;
    const list = violations.map((v) => `${v.name} was ${v.found === undefined ? "unset" : JSON.stringify(v.found)} (restored to ${JSON.stringify(v.restoredTo)})`).join("; ");
    throw new Error(
      `this test broke the suite's isolation from real state: ${list}. ` +
        `Restore tests/preload.ts's value in your own afterEach instead of deleting it - ` +
        `with a port unset or pointed at its production default (chat ${PRODUCTION_CHAT_PORT}, background ${PRODUCTION_BACKGROUND_PORT}, embed ${PRODUCTION_EMBED_PORT}), a later test's spawn calls freePort() against the real hub's own engine.`,
    );
  });
}
