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

/** The one production default a test spawn must never resolve to -
 * llmSupervisor.ts's own `MAIPAI_LLAMA_SERVER_PORT ?? 8788`. */
export const PRODUCTION_CHAT_PORT = "8788";

/** Environment variables tests/preload.ts owns. `exact` ones must keep
 * the exact value preload set (a different data dir is a different
 * household's data); the chat port only has to stay isolated - a test
 * may pick its own throwaway port (resourceGovernor.test.ts does), it
 * just can't unset it or point it at the production default. */
const EXACT_KEYS = ["MAIPAI_DATA_DIR", "MAIPAI_BACKUP_DIR", "MAIPAI_KEYSTORE_BACKEND", "MAIPAI_TTS_DISABLE_SPAWN"] as const;
const CHAT_PORT_KEY = "MAIPAI_LLAMA_SERVER_PORT";

export type IsolationSnapshot = Record<string, string | undefined>;

export interface IsolationViolation {
  name: string;
  found: string | undefined;
  restoredTo: string;
}

export function snapshotTestIsolation(env: IsolationSnapshot = process.env): IsolationSnapshot {
  const snapshot: IsolationSnapshot = {};
  for (const key of [...EXACT_KEYS, CHAT_PORT_KEY]) snapshot[key] = env[key];
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
  const wantPort = expected[CHAT_PORT_KEY];
  const port = env[CHAT_PORT_KEY];
  if (wantPort !== undefined && (port === undefined || port === PRODUCTION_CHAT_PORT)) {
    violations.push({ name: CHAT_PORT_KEY, found: port, restoredTo: wantPort });
    env[CHAT_PORT_KEY] = wantPort;
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
        `with the chat port unset, a later test's spawn calls freePort(${PRODUCTION_CHAT_PORT}) and SIGKILLs the real hub's chat engine.`,
    );
  });
}
